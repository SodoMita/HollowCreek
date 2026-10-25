// Browser-API contract test: no microphone or real browsers required. Asserts
// actual gain/pan graph setup, both WebRTC negotiation directions, voice mixer,
// attenuation changes, mic mute, early ICE and teardown.
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({ entryPoints: ["src/game/voice.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { VoiceChat } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let captures = 0, tracksStopped = 0;
const tracks = [{ enabled: true, stop() { tracksStopped++; } }];
const stream = { getAudioTracks: () => tracks, getTracks: () => tracks };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { async getUserMedia(constraints) {
  assert.equal(constraints.audio.echoCancellation, true);
  assert.equal(constraints.video, false);
  captures++;
  return stream;
} } } });
class Parameter {
  constructor(value = 0) { this.value = value; }
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  disconnected = false;
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
}
class Gain extends Node { constructor() { super(); this.gain = new Parameter(); } }
class Panner extends Node { constructor() { super(); this.pan = new Parameter(); } }
const contexts = [];
class AudioContextFake {
  constructor() { this.currentTime = 0; this.state = "running"; this.destination = new Node(); contexts.push(this); }
  createGain() { return new Gain(); }
  createStereoPanner() { return new Panner(); }
  createMediaStreamSource(inbound) { assert.equal(inbound, stream); return new Node(); }
  createScriptProcessor() {
    const proc = new Node();
    proc.onaudioprocess = null;
    return proc;
  }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      connect(node) { return node; },
      start() {},
      stop() {},
    };
  }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}
globalThis.window = { AudioContext: AudioContextFake };
const sessions = new Map();
globalThis.sessionStorage = { getItem: (key) => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, value) };
const connections = [];
class PeerFake {
  constructor(configuration) {
    assert.ok(configuration.iceServers.some((server) => server.urls === "turn:relay.example"), "optional TURN reaches WebRTC");
    this.localDescription = null; this.remoteDescription = null;
    this.connectionState = "new"; this.signalingState = "stable"; this.candidates = [];
    connections.push(this);
  }
  addTrack(track, source) { assert.equal(track, tracks[0]); assert.equal(source, stream); this.hasTrack = true; }
  async createOffer() { assert.equal(this.hasTrack, true, "media attached before offer"); return { type: "offer", sdp: "v=0 offer" }; }
  async createAnswer() { return { type: "answer", sdp: "v=0 answer" }; }
  async setLocalDescription(description) {
    this.localDescription = { ...description, toJSON() { return description; } };
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = "stable"; }
  async addIceCandidate(candidate) { this.candidates.push(candidate); }
  close() { this.connectionState = "closed"; }
}
globalThis.RTCPeerConnection = PeerFake;
let gain = 0.2, pan = 0.4, otherGain = 0;
let pendingSignals = [];
globalThis.fetch = async (url, init) => {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : null;
  if (method === "GET" && String(url).includes("config=1")) return {
    ok: true, status: 200, async json() { return { ok: true, iceServers: [
      { urls: "stun:stun.example" }, { urls: "turn:relay.example", username: "ephemeral", credential: "ephemeral" },
    ] }; },
  };
  if (method === "POST") {
    if (body.action === "join") return { ok: true, status: 200, async json() { return { ok: true, session: "private-session" }; } };
    if (body.action === "signal") { assert.equal(body.session, "private-session"); return { ok: true, status: 200, async json() { return { ok: true }; } }; }
    if (body.action === "leave") return { ok: true, status: 200, async json() { return { ok: true }; } };
  }
  assert.ok(String(url).includes("session=private-session"));
  return { ok: true, status: 200, async json() {
    const signals = pendingSignals; pendingSignals = [];
    return { ok: true, peers: [
      ...(gain ? [{ id: "p2", name: "Other", gain, pan }] : []),
      ...(otherGain ? [{ id: "p0", name: "Caller", gain: otherGain, pan: -0.3 }] : []),
    ], signals };
  } };
};
const settings = { audio: { master: 0.85, voice: 0.8, muted: false } };
let status;
const voice = new VoiceChat({ baseUrl: () => "https://town.example", roomCode: () => "ABCD", playerId: () => "p1",
  getSettings: () => settings, onStatus: (next) => { status = next; } });
assert.equal(captures, 0, "microphone starts off");
await voice.start();
await sleep(80);
assert.equal(captures, 1, "start asks for microphone");
assert.equal(status.active, true);
assert.equal(status.nearby, 1);
assert.equal(connections.length, 1, "nearby voice creates one peer");
const first = voice.peers.get("p2");
assert.equal(first.gain.gain.value, 0.2, "inbound audio starts at server gain, not full volume");
assert.equal(first.pan.pan.value, 0.4, "inbound audio starts on correct side");
assert.equal(connections[0].localDescription.type, "offer");
connections[0].ontrack({ streams: [stream], track: tracks[0] });
assert.ok(first.source, "incoming audio is connected to Web Audio output");
assert.equal(contexts[0].state, "running");
voice.setMuted(true);
assert.equal(tracks[0].enabled, false, "mic mute disables the captured track");
voice.setMuted(false);
assert.equal(tracks[0].enabled, true);
settings.audio.voice = 0.25;
voice.applyMix();
assert.ok(Math.abs(voice.voiceBus.gain.value - 0.85 * 0.25 * 0.25) < 0.001, "saved voice slider controls mixer");
settings.audio.muted = true;
voice.applyMix();
assert.equal(voice.voiceBus.gain.value, 0, "settings master mute silences voice output");
settings.audio.muted = false;
voice.applyMix();
pendingSignals = [{ from: "p2", type: "candidate", data: { candidate: "early" } },
  { from: "p2", type: "answer", data: { type: "answer", sdp: "v=0 answer" } }];
await voice.poll();
assert.equal(connections[0].remoteDescription.type, "answer");
assert.equal(connections[0].candidates.length, 1, "ICE before answer queued and flushed");
gain = 0.7; pan = -0.5;
await voice.poll();
assert.equal(first.gain.gain.value, 0.7, "server distance change smoothly targets new volume");
assert.equal(first.pan.pan.value, -0.5, "moving across listener reverses stereo side");
gain = 0;
await voice.poll();
assert.equal(connections[0].connectionState, "closed", "out-of-range peer disconnected");
assert.equal(first.source.disconnected, true, "disconnected voice stops Web Audio source");
otherGain = 0.4;
pendingSignals = [{ from: "p0", type: "candidate", data: { candidate: "early-ice" } },
  { from: "p0", type: "offer", data: { type: "offer", sdp: "v=0 incoming" } }];
await voice.poll();
assert.equal(connections.length, 2, "incoming offer creates answerer without glare");
assert.equal(connections[1].localDescription.type, "answer");
assert.equal(connections[1].candidates.length, 1, "ICE before offer flushed on answerer");
const second = voice.peers.get("p0");
assert.equal(second.gain.gain.value, 0.4);
assert.equal(second.pan.pan.value, -0.3);

// Test Server Audio Relay routing when WebRTC is not connected
const testPcm = new Int16Array([50, 150, -250, 350, 1000]);
const testB64 = Buffer.from(testPcm.buffer).toString("base64");
voice.playRelayChunk(second, { chunk: testB64, rate: 12000 });
assert.ok(second.nextPlayTime > 0, "server audio chunk scheduled and routed through Web Audio nodes");

voice.stop();
assert.equal(tracksStopped, 1, "voice off releases the microphone");
assert.equal(contexts[0].state, "closed", "voice off closes output context");
assert.equal(status.active, false);
voice.destroy();
console.log("VOICE CLIENT PASSED: mic permission, TURN, stereo gain/pan, mixer, ICE, mute, cleanup");
