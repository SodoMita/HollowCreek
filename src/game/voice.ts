// Opt-in proximity voice chat with distance attenuation and direction panning.
// WebRTC P2P is attempted using a comprehensive set of global STUN/TURN relays.
// If WebRTC is blocked by restrictive firewalls or fails to connect, audio
// automatically and seamlessly routes through the game server with the exact
// same distance attenuation and stereo panning!
// Microphone capture NEVER begins until start() is called from a user gesture.
import type { GameSettings } from "./settings";
import { EXPANDED_ICE_SERVERS } from "./voice-range";

export interface VoiceStatus {
  active: boolean;
  starting: boolean;
  muted: boolean;
  nearby: number;
  connected: number;
  p2pCount: number;
  relayCount: number;
  mode: "p2p" | "relay" | "hybrid" | "idle";
  speaking: boolean;
  error: string | null;
}

type PeerInfo = { id: string; name: string; gain: number; pan: number };
type VoiceSignal = { from: string; type: "offer" | "answer" | "candidate"; data: RTCSessionDescriptionInit | RTCIceCandidateInit };
type AudioChunk = { id: number; from: string; chunk: string; rate: number };

type Peer = {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode;
  pan: StereoPannerNode;
  nextPlayTime: number;
  webrtcActive: boolean;
};

type Options = {
  baseUrl: () => string;
  roomCode: () => string;
  playerId: () => string;
  getSettings: () => GameSettings;
  onStatus: (status: VoiceStatus) => void;
};

const INITIAL: VoiceStatus = {
  active: false,
  starting: false,
  muted: false,
  nearby: 0,
  connected: 0,
  p2pCount: 0,
  relayCount: 0,
  mode: "idle",
  speaking: false,
  error: null,
};

export function downsample(input: Float32Array, inputRate: number, targetRate = 12000): Int16Array {
  if (inputRate === targetRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / targetRate;
  const newLen = Math.round(input.length / ratio);
  const out = new Int16Array(newLen);
  let outIdx = 0;
  let inOffset = 0;
  while (outIdx < out.length) {
    const nextIn = Math.round((outIdx + 1) * ratio);
    let sum = 0, count = 0;
    for (let i = inOffset; i < nextIn && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    const val = count > 0 ? sum / count : input[Math.min(input.length - 1, Math.floor(inOffset))];
    const s = Math.max(-1, Math.min(1, val));
    out[outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    inOffset = nextIn;
  }
  return out;
}

export function base64ToInt16(b64: string): Int16Array | null {
  try {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  } catch {
    return null;
  }
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, len));
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return btoa(binary);
}

export class VoiceChat {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private voiceBus: GainNode | null = null;
  private session = "";
  private iceServers: RTCIceServer[] = [...EXPANDED_ICE_SERVERS];
  private peers = new Map<string, Peer>();
  private earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
  private levels = new Map<string, { gain: number; pan: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private generation = 0;
  private destroyed = false;
  private status: VoiceStatus = { ...INITIAL };

  // Microphone processor & audio relay buffer
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private micMuteGain: GainNode | null = null;
  private pcmBuffer: Int16Array[] = [];
  private pcmSamples = 0;
  private lastAudioSeq = 0;

  constructor(private options: Options) {}

  get current(): VoiceStatus {
    return { ...this.status };
  }

  private emit(patch: Partial<VoiceStatus>) {
    this.status = { ...this.status, ...patch };
    if (!this.destroyed) this.options.onStatus({ ...this.status });
  }

  private url(path = "") {
    return this.options.baseUrl().replace(/\/$/, "") + "/api/game/voice" + path;
  }

  private storageKey() {
    return `hc_voice_${this.options.roomCode()}_${this.options.playerId()}`;
  }

  private async post(action: string, more: Record<string, unknown> = {}, keepalive = false) {
    const res = await fetch(this.url(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive,
      body: JSON.stringify({
        code: this.options.roomCode(),
        playerId: this.options.playerId(),
        session: this.session,
        action,
        ...more,
      }),
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
      const AudioContextClass =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
      if (generation !== this.generation || this.destroyed) {
        captured.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = captured;

      // Set up local microphone audio processor for server fallback relay
      this.setupMicCapture();

      try {
        this.session = sessionStorage.getItem(this.storageKey()) ?? "";
      } catch {
        /* private mode */
      }
      const joined = await this.post("join");
      if (generation !== this.generation || this.destroyed) {
        this.stop();
        return;
      }
      this.session = joined.session;
      try {
        sessionStorage.setItem(this.storageKey(), this.session);
      } catch {
        /* private mode */
      }
      await this.loadIceServers();
      if (generation !== this.generation || this.destroyed) {
        this.stop();
        return;
      }

      this.emit({ active: true, starting: false, muted: false, error: null });
      // Poll every 300ms so server-routed audio packets play with natural low latency
      this.timer = setInterval(() => void this.poll(), 300);
      void this.poll();
    } catch (err) {
      captured?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.session = "";
      this.teardownAudio();
      if (generation !== this.generation) return;
      const message = err instanceof Error ? err.message : "Could not open the microphone.";
      this.emit({
        starting: false,
        active: false,
        error: /permission|denied|notallowed/i.test(message)
          ? "Microphone denied. Allow it for this HTTPS page (or its embedding site)."
          : message,
      });
    }
  }

  private setupMicCapture() {
    if (!this.ctx || !this.stream) return;
    try {
      this.micSource = this.ctx.createMediaStreamSource(this.stream);
      // 2048 samples @ 48kHz = ~42ms buffer
      this.micProcessor = this.ctx.createScriptProcessor(2048, 1, 1);
      this.micMuteGain = this.ctx.createGain();
      this.micMuteGain.gain.value = 0; // prevent self-monitoring echo

      this.micProcessor.onaudioprocess = (e) => {
        if (!this.stream || this.status.muted || !this.status.active) return;
        const input = e.inputBuffer.getChannelData(0);
        // Voice Activity Detection (RMS energy)
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        const speakingNow = rms >= 0.007;

        if (speakingNow !== this.status.speaking) {
          this.emit({ speaking: speakingNow });
        }
        if (!speakingNow) {
          if (this.pcmSamples > 600) this.flushAudioChunk();
          return;
        }

        // Downsample input to 12kHz mono
        const pcm = downsample(input, this.ctx!.sampleRate, 12000);
        this.pcmBuffer.push(pcm);
        this.pcmSamples += pcm.length;

        // Flush when ~200ms is buffered (2400 samples at 12kHz)
        if (this.pcmSamples >= 2400) {
          this.flushAudioChunk();
        }
      };

      this.micSource.connect(this.micProcessor);
      this.micProcessor.connect(this.micMuteGain);
      this.micMuteGain.connect(this.ctx.destination);
    } catch {
      /* fallback without mic processor */
    }
  }

  private flushAudioChunk() {
    if (!this.pcmSamples || !this.session || !this.status.active) return;
    const total = this.pcmSamples;
    const merged = new Int16Array(total);
    let offset = 0;
    for (const arr of this.pcmBuffer) {
      merged.set(arr, offset);
      offset += arr.length;
    }
    this.pcmBuffer = [];
    this.pcmSamples = 0;

    const b64 = uint8ToBase64(new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength));
    void this.post("audio", { chunk: b64, rate: 12000 }).catch(() => {});
  }

  async resumePlayback() {
    if (!this.ctx) return;
    try {
      await this.ctx.resume();
      this.emit({ error: null });
    } catch {
      this.emit({ error: "Browser blocked voice playback. Tap Enable sound." });
    }
  }

  private async loadIceServers() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const query = new URLSearchParams({
        code: this.options.roomCode(),
        playerId: this.options.playerId(),
        session: this.session,
        config: "1",
      });
      const response = await fetch(this.url("?" + query), { signal: controller.signal, cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (
        Array.isArray(data.iceServers) &&
        data.iceServers.every(
          (entry: RTCIceServer) => entry && typeof entry.urls === "string" && /^(stun|turn|turns):/.test(entry.urls)
        )
      ) {
        this.iceServers = data.iceServers;
      }
    } catch {
      /* STUN remains available if configuration cannot load */
    } finally {
      clearTimeout(timeout);
    }
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
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.emit({ muted, speaking: false });
  }

  private teardownAudio() {
    if (this.micProcessor) {
      try {
        this.micProcessor.onaudioprocess = null;
        this.micProcessor.disconnect();
      } catch {
        /* already disconnected */
      }
      this.micProcessor = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        /* ignore */
      }
      this.micSource = null;
    }
    if (this.micMuteGain) {
      try {
        this.micMuteGain.disconnect();
      } catch {
        /* ignore */
      }
      this.micMuteGain = null;
    }
    this.pcmBuffer = [];
    this.pcmSamples = 0;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.voiceBus = null;
    }
  }

  stop() {
    ++this.generation;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const wasSession = this.session;
    if (wasSession) void this.post("leave", {}, true).catch(() => {});
    this.session = "";
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.earlyCandidates.clear();
    this.levels.clear();
    this.teardownAudio();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.emit({ ...INITIAL });
  }

  destroy() {
    this.stop();
    this.destroyed = true;
  }

  private async poll() {
    if (!this.stream || !this.session || this.polling || this.destroyed) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const query = new URLSearchParams({
        code: this.options.roomCode(),
        playerId: this.options.playerId(),
        session: this.session,
        sinceAudio: String(this.lastAudioSeq),
      });
      const res = await fetch(this.url("?" + query), { cache: "no-store" });
      if (generation !== this.generation) return;
      if (!res.ok) {
        if (res.status === 403) {
          const joined = await this.post("join");
          this.session = joined.session;
          try {
            sessionStorage.setItem(this.storageKey(), this.session);
          } catch {
            /* no storage */
          }
          return;
        }
        throw new Error("Voice connection lost. Retrying…");
      }
      const state = (await res.json()) as {
        peers: PeerInfo[];
        signals: VoiceSignal[];
        audioChunks?: AudioChunk[];
        lastAudioSeq?: number;
      };
      if (generation !== this.generation) return;

      const nearby = new Map(state.peers.map((peer) => [peer.id, peer]));
      this.levels = new Map(state.peers.map((peer) => [peer.id, { gain: peer.gain, pan: peer.pan }]));

      // Clean up peers who walked out of earshot
      for (const [id] of this.peers) {
        if (!nearby.has(id)) this.closePeer(id);
      }

      // Process WebRTC signaling
      for (const signal of state.signals) {
        if (nearby.has(signal.from)) await this.receive(signal);
      }

      // Ensure every nearby peer has a Web Audio gain/pan node ready
      for (const peer of state.peers) {
        const existing = this.ensurePeer(peer.id, { gain: peer.gain, pan: peer.pan });
        this.updatePeerLevels(existing, peer);
        // Initiate WebRTC offer if lower ID and stable
        if (this.options.playerId() < peer.id && existing.pc.signalingState === "stable" && !existing.webrtcActive) {
          void this.offer(peer);
        }
      }

      // Process server audio relay packets for any peer where WebRTC is not active
      if (Array.isArray(state.audioChunks)) {
        for (const chunk of state.audioChunks) {
          if (chunk.id > this.lastAudioSeq) this.lastAudioSeq = chunk.id;
          const peer = this.peers.get(chunk.from);
          if (!peer) continue;
          // If WebRTC is successfully connected and receiving live audio, skip relay to avoid duplicate sound
          if (peer.pc.connectionState === "connected" && peer.webrtcActive) {
            continue;
          }
          // Otherwise play through server audio relay!
          this.playRelayChunk(peer, chunk);
        }
      }
      if (typeof state.lastAudioSeq === "number" && state.lastAudioSeq > this.lastAudioSeq) {
        this.lastAudioSeq = state.lastAudioSeq;
      }

      const p2pCount = [...this.peers.values()].filter(
        (entry) => entry.pc.connectionState === "connected" && entry.webrtcActive
      ).length;
      const relayCount = state.peers.length - p2pCount;
      const mode =
        p2pCount > 0 && relayCount === 0
          ? "p2p"
          : relayCount > 0 && p2pCount === 0
          ? "relay"
          : p2pCount > 0
          ? "hybrid"
          : "idle";

      this.emit({
        nearby: state.peers.length,
        connected: state.peers.length,
        p2pCount,
        relayCount,
        mode,
        error: null,
      });
    } catch (error) {
      if (generation === this.generation) {
        this.emit({ error: error instanceof Error ? error.message : "Voice is reconnecting." });
      }
    } finally {
      this.polling = false;
    }
  }

  private playRelayChunk(peer: Peer, chunk: { chunk: string; rate: number }) {
    if (!this.ctx || !this.voiceBus) return;
    try {
      const pcm = base64ToInt16(chunk.chunk);
      if (!pcm || pcm.length === 0) return;
      const numSamples = pcm.length;
      const rate = chunk.rate || 12000;
      const audioBuffer = this.ctx.createBuffer(1, numSamples, rate);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = pcm[i] / 32768;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(peer.gain);

      const now = this.ctx.currentTime;
      // Schedule playback with a tiny 30ms jitter buffer
      const startTime = Math.max(now + 0.03, peer.nextPlayTime);
      source.start(startTime);
      peer.nextPlayTime = startTime + audioBuffer.duration;
    } catch {
      /* ignore invalid audio chunk */
    }
  }

  private ensurePeer(id: string, level: { gain: number; pan: number }): Peer {
    let peer = this.peers.get(id);
    if (peer) return peer;
    return this.makePeer(id, level);
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

    const peer: Peer = {
      pc,
      gain,
      pan,
      source: null,
      pending: this.earlyCandidates.get(id) ?? [],
      nextPlayTime: 0,
      webrtcActive: false,
    };
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
        peer.webrtcActive = true;
        if (this.ctx.state === "suspended") {
          void this.ctx.resume().catch(() =>
            this.emit({ error: "Browser blocked voice playback. Tap Enable sound." })
          );
        }
      } catch {
        this.emit({ error: "Voice playback failed on this device." });
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.peers.get(id)?.pc === pc) {
        void this.signal(id, "candidate", event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        peer.webrtcActive = true;
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
        peer.webrtcActive = false;
        if (pc.connectionState === "closed") this.closePeer(id);
      }
      this.emit({
        connected: this.peers.size,
      });
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
    } catch {
      /* already disconnected */
    }
  }

  private async signal(to: string, type: VoiceSignal["type"], data: RTCSessionDescriptionInit | RTCIceCandidateInit) {
    try {
      await this.post("signal", { to, type, data });
    } catch {
      /* peer has moved away or left; next poll closes it */
    }
  }

  private async offer(info: PeerInfo) {
    if (!this.stream) return;
    const peer = this.ensurePeer(info.id, { gain: info.gain, pan: info.pan });
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      if (peer.pc.localDescription) await this.signal(info.id, "offer", peer.pc.localDescription.toJSON());
    } catch {
      this.closePeer(info.id);
    }
  }

  private async flushCandidates(peer: Peer) {
    for (const candidate of peer.pending.splice(0)) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch {
        /* stale ICE candidate */
      }
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
      } else if (!peer.pc.remoteDescription) {
        peer.pending.push(candidate);
      } else {
        try {
          await peer.pc.addIceCandidate(candidate);
        } catch {
          /* stale candidate */
        }
      }
      return;
    }
    if (signal.type === "offer") {
      if (!this.stream) return;
      this.closePeer(info);
      try {
        const peer = this.makePeer(info, this.levels.get(info) ?? { gain: 0, pan: 0 });
        await peer.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        await this.flushCandidates(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        if (peer.pc.localDescription) await this.signal(info, "answer", peer.pc.localDescription.toJSON());
      } catch {
        this.closePeer(info);
      }
      return;
    }
    const peer = this.peers.get(info);
    if (peer && peer.pc.signalingState === "have-local-offer") {
      try {
        await peer.pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
        await this.flushCandidates(peer);
      } catch {
        this.closePeer(info);
      }
    }
  }
}
