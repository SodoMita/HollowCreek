// Opt-in proximity voice for both clients. Audio goes directly over encrypted
// WebRTC; only SDP/ICE and a server-calculated distance gain use the game API.
// Microphone capture NEVER begins until start() is called from a user click.
import type { GameSettings } from "./settings";

export interface VoiceStatus {
  active: boolean;
  starting: boolean;
  muted: boolean;
  nearby: number;
  connected: number;
  error: string | null;
}
type PeerInfo = { id: string; name: string; gain: number; pan: number };
type VoiceSignal = { from: string; type: "offer" | "answer" | "candidate"; data: RTCSessionDescriptionInit | RTCIceCandidateInit };
type Peer = {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode;
  pan: StereoPannerNode;
};
type Options = {
  baseUrl: () => string;
  roomCode: () => string;
  playerId: () => string;
  getSettings: () => GameSettings;
  onStatus: (status: VoiceStatus) => void;
};
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];
const INITIAL: VoiceStatus = { active: false, starting: false, muted: false, nearby: 0, connected: 0, error: null };

export class VoiceChat {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private voiceBus: GainNode | null = null;
  private session = "";
  private iceServers: RTCIceServer[] = ICE_SERVERS;
  private peers = new Map<string, Peer>();
  private earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  private levels = new Map<string, { gain: number; pan: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private generation = 0;
  private destroyed = false;
  private status: VoiceStatus = { ...INITIAL };
  constructor(private options: Options) {}
  get current(): VoiceStatus { return { ...this.status }; }
  private emit(patch: Partial<VoiceStatus>) {
    this.status = { ...this.status, ...patch };
    if (!this.destroyed) this.options.onStatus({ ...this.status });
  }
  private url(path = "") { return this.options.baseUrl().replace(/\/$/, "") + "/api/game/voice" + path; }
  private storageKey() { return `hc_voice_${this.options.roomCode()}_${this.options.playerId()}`; }
  private async post(action: string, more: Record<string, unknown> = {}, keepalive = false) {
    const res = await fetch(this.url(), {
      method: "POST", headers: { "content-type": "application/json" }, keepalive,
      body: JSON.stringify({ code: this.options.roomCode(), playerId: this.options.playerId(),
        session: this.session, action, ...more }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Town voice is not answering.");
    return data;
  }

  async start() {
    if (this.stream || this.status.starting || this.destroyed) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      this.emit({ error: "Voice needs a secure browser with microphone and WebRTC support." });
      return;
    }
    const generation = ++this.generation;
    this.emit({ starting: true, error: null });
    let captured: MediaStream | null = null;
    try {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable in this browser.");
      this.ctx = new AudioContextClass();
      this.voiceBus = this.ctx.createGain();
      this.voiceBus.connect(this.ctx.destination);
      this.applyMix();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      captured = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (generation !== this.generation || this.destroyed) { captured.getTracks().forEach((t) => t.stop()); return; }
      this.stream = captured;
      try { this.session = sessionStorage.getItem(this.storageKey()) ?? ""; } catch { /* private mode */ }
      const joined = await this.post("join");
      if (generation !== this.generation || this.destroyed) { this.stop(); return; }
      this.session = joined.session;
      try { sessionStorage.setItem(this.storageKey(), this.session); } catch { /* private mode */ }
      await this.loadIceServers();
      if (generation !== this.generation || this.destroyed) { this.stop(); return; }
      this.emit({ active: true, starting: false, muted: false, error: null });
      this.timer = setInterval(() => void this.poll(), 1000);
      void this.poll();
    } catch (err) {
      captured?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.session = "";
      if (this.ctx) void this.ctx.close().catch(() => { /* already closed */ });
      this.ctx = null;
      this.voiceBus = null;
      if (generation !== this.generation) return;
      const message = err instanceof Error ? err.message : "Could not open the microphone.";
      this.emit({ starting: false, active: false, error: /permission|denied|notallowed/i.test(message)
        ? "Microphone denied. Allow it for this HTTPS page (or its embedding site)." : message });
    }
  }

  async resumePlayback() {
    if (!this.ctx) return;
    try { await this.ctx.resume(); this.emit({ error: null }); }
    catch { this.emit({ error: "Browser blocked voice playback. Tap Enable sound." }); }
  }
  private async loadIceServers() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const query = new URLSearchParams({ code: this.options.roomCode(), playerId: this.options.playerId(), session: this.session, config: "1" });
      const response = await fetch(this.url("?" + query), { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.iceServers) && data.iceServers.every((entry: RTCIceServer) =>
        entry && typeof entry.urls === "string" && /^(stun|turn|turns):/.test(entry.urls))) {
        this.iceServers = data.iceServers;
      }
    } catch { /* STUN remains available if configuration cannot load */ }
    finally { clearTimeout(timeout); }
  }
  /** Shared master mute and the separate, saved voice-volume slider. */
  applyMix() {
    if (!this.ctx || !this.voiceBus) return;
    const a = this.options.getSettings().audio;
    const t = this.ctx.currentTime;
    this.voiceBus.gain.cancelScheduledValues(t);
    this.voiceBus.gain.setTargetAtTime(a.muted ? 0 : a.master * a.voice * a.voice, t, 0.05);
  }
  setMuted(muted: boolean) {
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    this.emit({ muted });
  }
  stop() {
    ++this.generation;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasSession = this.session;
    if (wasSession) void this.post("leave", {}, true).catch(() => { /* presence expires server-side */ });
    this.session = "";
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.earlyCandidates.clear();
    this.levels.clear();
    if (this.ctx) void this.ctx.close().catch(() => { /* already closed */ });
    this.ctx = null;
    this.voiceBus = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.emit({ ...INITIAL });
  }
  destroy() { this.stop(); this.destroyed = true; }

  private async poll() {
    if (!this.stream || !this.session || this.polling || this.destroyed) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const query = new URLSearchParams({ code: this.options.roomCode(), playerId: this.options.playerId(), session: this.session });
      const res = await fetch(this.url("?" + query), { cache: "no-store" });
      if (generation !== this.generation) return;
      if (!res.ok) {
        if (res.status === 403) {
          const joined = await this.post("join");
          this.session = joined.session;
          try { sessionStorage.setItem(this.storageKey(), this.session); } catch { /* no storage */ }
          return;
        }
        throw new Error("Voice connection lost. Retrying…");
      }
      const state = await res.json() as { peers: PeerInfo[]; signals: VoiceSignal[] };
      if (generation !== this.generation) return;
      const nearby = new Map(state.peers.map((peer) => [peer.id, peer]));
      this.levels = new Map(state.peers.map((peer) => [peer.id, { gain: peer.gain, pan: peer.pan }]));
      for (const [id] of this.peers) if (!nearby.has(id)) this.closePeer(id);
      for (const signal of state.signals) if (nearby.has(signal.from)) await this.receive(signal);
      for (const peer of state.peers) {
        const existing = this.peers.get(peer.id);
        if (existing) this.updatePeerLevels(existing, peer);
        else if (this.options.playerId() < peer.id) void this.offer(peer);
      }
      this.emit({ nearby: state.peers.length, connected: [...this.peers.values()].filter((peer) => peer.pc.connectionState === "connected").length,
        error: null });
    } catch (error) {
      if (generation === this.generation) this.emit({ error: error instanceof Error ? error.message : "Voice is reconnecting." });
    } finally { this.polling = false; }
  }

  private makePeer(id: string, level: { gain: number; pan: number }): Peer {
    const ctx = this.ctx;
    const bus = this.voiceBus;
    if (!ctx || !bus) throw new Error("Voice output is not ready.");
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, level.gain));
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, level.pan));
    gain.connect(pan);
    pan.connect(bus);
    const peer: Peer = { pc, gain, pan, source: null, pending: this.earlyCandidates.get(id) ?? [] };
    this.earlyCandidates.delete(id);
    this.peers.set(id, peer);
    this.stream?.getAudioTracks().forEach((track) => pc.addTrack(track, this.stream!));
    pc.ontrack = (event) => {
      if (!this.ctx || this.peers.get(id)?.pc !== pc) return;
      try {
        peer.source?.disconnect();
        const inbound = event.streams[0] ?? new MediaStream([event.track]);
        peer.source = this.ctx.createMediaStreamSource(inbound);
        peer.source.connect(gain);
        if (this.ctx.state === "suspended") void this.ctx.resume().catch(() =>
          this.emit({ error: "Browser blocked voice playback. Tap Enable sound." }));
      } catch { this.emit({ error: "Voice playback failed on this device." }); }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && this.peers.get(id)?.pc === pc)
        void this.signal(id, "candidate", event.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.closePeer(id);
      this.emit({ connected: [...this.peers.values()].filter((entry) => entry.pc.connectionState === "connected").length });
    };
    return peer;
  }
  private updatePeerLevels(peer: Peer, requested: { gain: number; pan: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    peer.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, requested.gain)), t, 0.12);
    peer.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, requested.pan)), t, 0.12);
  }
  private closePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    try {
      peer.source?.disconnect();
      peer.gain.disconnect();
      peer.pan.disconnect();
      peer.pc.close();
    } catch { /* already disconnected */ }
  }
  private async signal(to: string, type: VoiceSignal["type"], data: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    try { await this.post("signal", { to, type, data }); }
    catch { /* peer has moved away or left; next poll closes it */ }
  }
  private async offer(info: PeerInfo) {
    if (this.peers.has(info.id) || !this.stream) return;
    try {
      const peer = this.makePeer(info.id, { gain: info.gain, pan: info.pan });
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      if (peer.pc.localDescription) await this.signal(info.id, "offer", peer.pc.localDescription.toJSON());
    } catch { this.closePeer(info.id); }
  }
  private async flushCandidates(peer: Peer) {
    for (const candidate of peer.pending.splice(0)) {
      try { await peer.pc.addIceCandidate(candidate); } catch { /* stale ICE candidate */ }
    }
  }
  private async receive(signal: VoiceSignal) {
    const info = signal.from;
    if (signal.type === "candidate") {
      const candidate = signal.data as RTCIceCandidateInit;
      const peer = this.peers.get(info);
      if (!peer) {
        const queue = this.earlyCandidates.get(info) ?? [];
        queue.push(candidate);
        this.earlyCandidates.set(info, queue.slice(-40));
      } else if (!peer.pc.remoteDescription) peer.pending.push(candidate);
      else try { await peer.pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
      return;
    }
    if (signal.type === "offer") {
      if (!this.stream) return;
      // Only one side normally offers (lexicographic seat ID). A stale offer can
      // still arrive after a reconnect, so start a fresh peer rather than glare.
      this.closePeer(info);
      try {
        const peer = this.makePeer(info, this.levels.get(info) ?? { gain: 0, pan: 0 });
        await peer.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        await this.flushCandidates(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        if (peer.pc.localDescription) await this.signal(info, "answer", peer.pc.localDescription.toJSON());
      } catch { this.closePeer(info); }
      return;
    }
    const peer = this.peers.get(info);
    if (peer && peer.pc.signalingState === "have-local-offer") {
      try {
        await peer.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        await this.flushCandidates(peer);
      } catch { this.closePeer(info); }
    }
  }
}
