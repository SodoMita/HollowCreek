// Proximity voice chat for Hollow Creek. Microphone audio travels peer to peer
// over WebRTC; the town server only relays the sealed signalling envelopes
// (offer / answer / ICE). Every voice is attenuated by in-game distance and
// panned by direction, mirroring who can see whose speech bubbles: the living
// hear the living nearby, the dead hear everyone nearby.
//
// Framework-free so the React and the static client share it. No DOM or
// browser API is touched at module scope; everything runs inside methods.
import type { GameSettings } from "./settings";

export const VOICE_FULL_RANGE = 300;
export const VOICE_ZERO_RANGE = 1400;
export const VOICE_PAN_RANGE = 700;
const POLL_MS = 350;
const PEER_TIMEOUT_MS = 5000;
const MAX_PEERS = 9;

/** 0..1 loudness for a voice heard from distancePx away. */
export function voiceGainFor(distancePx: number): number {
  if (!Number.isFinite(distancePx) || distancePx <= VOICE_FULL_RANGE) return 1;
  if (distancePx >= VOICE_ZERO_RANGE) return 0;
  return 1 - (distancePx - VOICE_FULL_RANGE) / (VOICE_ZERO_RANGE - VOICE_FULL_RANGE);
}

/** -1..1 stereo placement from a signed horizontal offset. */
export function voicePanFor(dx: number): number {
  if (!Number.isFinite(dx)) return 0;
  return Math.max(-1, Math.min(1, dx / VOICE_PAN_RANGE));
}

/** Who may hear whom — the same privacy as speech bubbles. */
export function isVoiceAudible(selfAlive: boolean, otherAlive: boolean): boolean {
  return selfAlive ? otherAlive : true;
}

export interface VoicePeerView {
  id: string;
  x: number;
  alive: boolean;
}

export interface VoiceStatus {
  enabled: boolean;
  error: string | null;
}

interface SignalMsg {
  id: number;
  from: string;
  to: string;
  kind: "offer" | "answer" | "ice";
  payload: string;
}

interface Peer {
  pc: RTCPeerConnection;
  gain: GainNode;
  pan: StereoPannerNode;
  source: MediaStreamAudioSourceNode | null;
  iceQueue: RTCIceCandidateInit[];
  lastSeen: number;
}

const ICE_CONFIG: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export class VoiceChat {
  private ctx: AudioContext | null = null;
  private voiceBus: GainNode | null = null;
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private code = "";
  private playerId = "";
  private baseUrl = "";
  private lastSignalId = 0;
  private lastPoll = 0;
  private status: VoiceStatus = { enabled: false, error: null };

  constructor(
    private getSettings: () => GameSettings,
    private onStatus: (status: VoiceStatus) => void = () => undefined,
  ) {}

  get enabled() {
    return this.status.enabled;
  }

  private setStatus(patch: Partial<VoiceStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  /** Absolute server origin for portal-hosted clients; "" means same origin. */
  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, "");
  }

  setServer(code: string, playerId: string) {
    if (this.code !== code.toUpperCase() || this.playerId !== playerId) {
      this.code = code.toUpperCase();
      this.playerId = playerId;
      this.lastSignalId = 0;
      for (const id of [...this.peers.keys()]) this.dropPeer(id);
    }
  }

  /** Toggle the microphone. Off by default — the town never listens unasked. */
  async setEnabled(on: boolean) {
    if (on === this.status.enabled) return;
    if (!on) {
      this.teardown();
      this.setStatus({ enabled: false, error: null });
      return;
    }
    if (typeof RTCPeerConnection === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.setStatus({ enabled: false, error: "Voice chat is not supported in this browser." });
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error("no audio");
      this.ctx = new AC();
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);
      this.voiceBus = this.ctx.createGain();
      this.voiceBus.connect(this.ctx.destination);
      this.applyMix();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.setStatus({ enabled: true, error: null });
    } catch {
      this.teardown();
      this.setStatus({ enabled: false, error: "Microphone blocked — allow it to speak." });
    }
  }

  /** Follow the settings mixer (voice slider shares the master mute). */
  applyMix() {
    if (!this.ctx || !this.voiceBus) return;
    const a = this.getSettings().audio;
    const t = this.ctx.currentTime;
    this.voiceBus.gain.cancelScheduledValues(t);
    this.voiceBus.gain.setTargetAtTime(a.muted ? 0 : a.voice * a.voice, t, 0.035);
  }

  /**
   * Drive one step: poll signalling (throttled), sync the peer mesh with the
   * roster, and attenuate every voice by the authoritative positions.
   */
  async tick(self: { id: string; x: number; alive: boolean }, roster: VoicePeerView[]) {
    if (!this.status.enabled || !this.code || !this.playerId) return;
    const now = Date.now();
    this.syncPeers(roster, now);
    this.updateVolumes(self, roster);
    if (now - this.lastPoll < POLL_MS) return;
    this.lastPoll = now;
    let messages: SignalMsg[] = [];
    try {
      const res = await fetch(
        `${this.baseUrl}/api/game/voice?code=${encodeURIComponent(this.code)}&playerId=${encodeURIComponent(this.playerId)}&since=${this.lastSignalId}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      messages = Array.isArray(data.messages) ? data.messages : [];
    } catch {
      return; // a hiccup costs one round of handshakes, nothing more
    }
    for (const msg of messages) {
      if (typeof msg.id === "number" && msg.id > this.lastSignalId) this.lastSignalId = msg.id;
      await this.handleSignal(msg).catch(() => undefined);
    }
  }

  destroy() {
    this.teardown();
    this.setStatus({ enabled: false, error: null });
  }

  // ------------------------------------------------------------- internals

  private teardown() {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.voiceBus = null;
    }
  }

  private dropPeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    try {
      peer.source?.disconnect();
      peer.pc.close();
    } catch { /* already gone */ }
  }

  private ensurePeer(id: string): Peer | null {
    if (!this.ctx || !this.voiceBus || !this.stream) return null;
    let peer = this.peers.get(id);
    if (peer) return peer;
    try {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const pan = this.ctx.createStereoPanner();
      gain.connect(pan).connect(this.voiceBus);
      const entry: Peer = { pc, gain, pan, source: null, iceQueue: [], lastSeen: Date.now() };
      pc.ontrack = (event) => {
        try {
          entry.source?.disconnect();
          entry.source = this.ctx!.createMediaStreamSource(event.streams[0]);
          entry.source.connect(entry.gain);
        } catch { /* a late track is harmless */ }
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) void this.postSignal(id, "ice", JSON.stringify(event.candidate.toJSON()));
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") this.dropPeer(id);
      };
      this.peers.set(id, entry);
      peer = entry;
    } catch {
      return null;
    }
    return peer;
  }

  private syncPeers(roster: VoicePeerView[], now: number) {
    const live = new Set(roster.map((p) => p.id));
    for (const [id, peer] of this.peers) {
      if (!live.has(id)) {
        if (now - peer.lastSeen > PEER_TIMEOUT_MS) this.dropPeer(id);
      } else {
        peer.lastSeen = now;
      }
    }
    if (this.peers.size >= MAX_PEERS) return;
    for (const p of roster) {
      if (p.id === this.playerId || this.peers.has(p.id)) continue;
      const peer = this.ensurePeer(p.id);
      if (!peer) continue;
      peer.lastSeen = now;
      // Lower id calls, so exactly one side of every pair dials.
      if (this.playerId < p.id && peer.pc.signalingState === "stable") {
        void this.offer(p.id, peer);
      }
    }
  }

  private async offer(id: string, peer: Peer) {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      await this.postSignal(id, "offer", JSON.stringify(peer.pc.localDescription));
    } catch {
      this.dropPeer(id);
    }
  }

  private async handleSignal(msg: SignalMsg) {
    if (!msg.from || msg.from === this.playerId || typeof msg.payload !== "string") return;
    const peer = this.ensurePeer(msg.from);
    if (!peer) return;
    peer.lastSeen = Date.now();
    if (msg.kind === "offer") {
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await this.postSignal(msg.from, "answer", JSON.stringify(peer.pc.localDescription));
        await this.flushIce(peer);
      } catch {
        this.dropPeer(msg.from);
      }
    } else if (msg.kind === "answer") {
      try {
        if (peer.pc.signalingState !== "stable") {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.payload)));
          await this.flushIce(peer);
        }
      } catch {
        this.dropPeer(msg.from);
      }
    } else if (msg.kind === "ice") {
      try {
        const candidate = JSON.parse(msg.payload) as RTCIceCandidateInit;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        else peer.iceQueue.push(candidate);
      } catch { /* a stray candidate is harmless */ }
    }
  }

  private async flushIce(peer: Peer) {
    const queued = peer.iceQueue;
    peer.iceQueue = [];
    for (const candidate of queued) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch { /* keep the rest flowing */ }
    }
  }

  private updateVolumes(self: { id: string; x: number; alive: boolean }, roster: VoicePeerView[]) {
    const byId = new Map(roster.map((p) => [p.id, p]));
    for (const [id, peer] of this.peers) {
      const p = byId.get(id);
      let gain = 0;
      let pan = 0;
      if (p && isVoiceAudible(self.alive, p.alive)) {
        const dx = p.x - self.x;
        gain = voiceGainFor(Math.abs(dx));
        pan = voicePanFor(dx);
      }
      const t = this.ctx?.currentTime;
      if (t !== undefined) {
        peer.gain.gain.setTargetAtTime(gain, t, 0.08);
        peer.pan.pan.setTargetAtTime(pan, t, 0.08);
      }
    }
  }

  private async postSignal(to: string, kind: "offer" | "answer" | "ice", payload: string) {
    if (!this.code || !this.playerId) return;
    try {
      await fetch(`${this.baseUrl}/api/game/voice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: this.code, playerId: this.playerId, to, kind, payload }),
      });
    } catch { /* next poll retries the handshake */ }
  }
}
