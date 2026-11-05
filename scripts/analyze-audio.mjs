// Offline loudness / harshness analysis of the generative scores.
//
//   node scripts/analyze-audio.mjs                 # the live score, src/game/audio.ts
//   node scripts/analyze-audio.mjs --score musicbox # the shelved src/game/audio-musicbox.ts
//
// Renders the director into an OfflineAudioContext (no speakers needed) and
// prints peak dBFS, RMS, crest factor and a high-frequency energy share for:
//   1. the full mix over 60 s (lobby → calm → danger → blackout → meeting → end)
//   2. every one-shot sound in isolation, so their levels can be compared
//
// Needs `node-web-audio-api` (esbuild comes with the repo). Install it in a
// scratch folder and run with NODE_PATH:
//   mkdir -p /tmp/audiolab && cd /tmp/audiolab && npm i node-web-audio-api
//   NODE_PATH=/tmp/audiolab/node_modules node scripts/analyze-audio.mjs
// Minimal containers lack libasound.so.2: extract Debian's libasound2 .deb
// somewhere and point LD_LIBRARY_PATH at its lib directory.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { OfflineAudioContext, AudioParam } = require("node-web-audio-api");
const { build } = require("esbuild");

// node-web-audio-api quirk (verified with a 1-osc repro): a setTargetAtTime
// scheduled in the future with no earlier event corrupts the param *before*
// its start time (0.1 became 5.23). Browsers hold the current value until the
// event. Anchoring every setTargetAtTime with setValueAtTime(lastValue, start)
// reproduces browser behaviour; "lastValue" assumes the previous target was
// reached, which holds for the score's ≥6 s spacing vs ≤2.2 s time constants.
{
  const last = new WeakMap();
  const original = AudioParam.prototype.setTargetAtTime;
  AudioParam.prototype.setTargetAtTime = function patched(target, start, tc) {
    const from = last.has(this) ? last.get(this) : this.value;
    this.setValueAtTime(from, start);
    last.set(this, target);
    return original.call(this, target, start, tc);
  };
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 48000;
const which = process.argv.includes("--score") ? process.argv[process.argv.indexOf("--score") + 1] : "live";

// ----------------------------------------------------------------- profiles
// Each score has a different internal clock; the profile knows how to drive it
// offline (timers never fire in an OfflineAudioContext) and which sounds exist.
const PROFILES = {
  live: {
    file: "src/game/audio.ts",
    cls: "AudioDirector",
    label: "live score (audio.ts: drone · motif · choir · bell)",
    // schedule() re-arms setTimeout; replace it so start() schedules nothing.
    disarm: (Cls) => { Cls.prototype.schedule = function schedule() {}; },
    // The metric layer is random motifs every 7–16 s plus a bell every 42–112 s.
    drive: (d, ctx, DUR, at) => {
      for (let t = 2.5; t < DUR; t += 9) at(t, () => d.pluckMotif());
      at(12, () => d.toll(1));
      at(54, () => d.toll(1));
    },
    // Continuous layers to silence when soloing a one-shot.
    solo: (d) => { d.n.droneGain.gain.value = 0; d.n.windGain.gain.value = 0; },
    shots: {
      pluck: (d) => d.pluck(0.05, 440, 0.16),
      pluckMotif: (d) => d.pluckMotif(),
      chime: (d) => d.chime(),
      toll: (d) => d.toll(1),
      thud: (d) => d.thud(),
      riseTone: (d) => d.riseTone(),
      whoosh: (d) => d.whoosh(),
      heart: (d) => { d.n.heartGain.gain.value = 0.32; d.heart(0.05); },
      drone: (d) => { d.n.droneGain.gain.value = 0.11; },
      choirFull: (d) => { d.n.choirGain.gain.value = 0.035; },
      wind: (d) => { d.n.windGain.gain.value = 0.16; },
      windBlackout: (d) => { d.n.windGain.gain.value = 0.26; d.n.windFilter.frequency.value = 240; },
    },
  },
  musicbox: {
    file: "src/game/audio-musicbox.ts",
    cls: "MusicBoxScore",
    label: "music box score (audio-musicbox.ts, shelved)",
    disarm: (Cls) => { Cls.prototype.tick = function tick() {}; },
    drive: (d, ctx, DUR, at, timeline) => {
      d.step = 0;
      d.nextStepTime = 0.15;
      let i = 0;
      while (d.nextStepTime < DUR) {
        while (i < timeline.length && timeline[i][0] <= d.nextStepTime) { d.update(timeline[i][1]); i++; }
        d.onStep(d.step, d.nextStepTime);
        d.step++;
        d.nextStepTime += 60 / 144;
      }
      at(12, () => d.toll(1));
      at(36, () => d.owl(36));
      for (let k = 0; k < 8; k++) at(14 + k * 0.36, () => d.footstep(14 + k * 0.36));
      at(50.5, () => d.cadence());
    },
    solo: (d, name) => { if (!name.startsWith("wind")) d.n.windFilter.disconnect(); d.n.cricketGain.gain.value = 0; },
    shots: {
      box: (d) => d.box(0.05, 440, 0.15),
      chime: (d) => d.chime(),
      bass: (d) => d.bass(0.05, 5, 0.13),
      pad: (d) => { d.phase = "playing"; d.pad(0.05, { pad: [17, 20, 24, 29], bass: 5 }); },
      toll: (d) => d.toll(1),
      thud: (d) => d.thud(),
      riseTone: (d) => d.riseTone(),
      whoosh: (d) => d.whoosh(),
      heart: (d) => { d.n.heartGain.gain.value = 0.22; d.heart(0.05); },
      footstep: (d) => d.footstep(0.05),
      clock: (d) => d.clock(0.05, true),
      owl: (d) => d.owl(0.05),
      cadenceWin: (d) => { d.winner = "crew"; d.cadence(); },
      cluster: (d) => { d.n.clusterGain.gain.value = 0.03; },
      windBlackout: (d) => { d.n.windGain.gain.value = 0.26; d.n.rumbleGain.gain.value = 0.22; },
      crickets: (d) => { d.n.cricketGain.gain.value = 0.014; },
    },
  },
};
const profile = PROFILES[which];
if (!profile) { console.error(`unknown --score ${which}; use ${Object.keys(PROFILES).join(" | ")}`); process.exit(2); }

async function load() {
  const out = await build({
    stdin: { contents: `export * from "./${profile.file.replace(/\.ts$/, "")}"; export * from "./src/game/settings";`, resolveDir: repo, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const mod = await load();
const Director = mod[profile.cls];
const { createDefaultSettings } = mod;
profile.disarm(Director);

function makeStore() {
  const value = createDefaultSettings();
  Object.assign(value.audio, { muted: false, adaptiveMusic: true, heartbeat: true });
  return { value, subscribe: () => () => {}, update: (fn) => fn(value) };
}

/** A director whose AudioContext is an offline context of `seconds`. */
function director(seconds) {
  let ctx = null;
  class OfflineAsLive extends OfflineAudioContext {
    constructor() { super(2, Math.ceil(RATE * seconds), RATE); ctx = this; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: OfflineAsLive };
  const d = new Director(makeStore());
  d.start();
  if (d.timer) { clearTimeout(d.timer); d.timer = null; }
  // Pretend the clock reads `t` while fn runs, so automation lands at `t`.
  const at = (t, fn) => {
    Object.defineProperty(ctx, "currentTime", { value: t, configurable: true });
    fn();
    Object.defineProperty(ctx, "currentTime", { value: 0, configurable: true });
  };
  return { d, ctx, at };
}

const FAR = Number.MAX_SAFE_INTEGER / 4; // "blackout until forever" for either clock source
function snap(partial = {}) {
  return {
    now: 1_000_000, phase: "playing", danger: 0, blackoutUntil: 0, bellAt: 0,
    taskBar: { done: 0, total: 9 }, self: { id: "me", alive: true },
    players: [{ id: "me", moving: false }], winner: null, ...partial,
  };
}

const db = (v) => (v <= 1e-9 ? -Infinity : 20 * Math.log10(v));
function analyse(buffer, from = 0, to = buffer.duration) {
  const L = buffer.getChannelData(0), Rc = buffer.getChannelData(1);
  const a = Math.floor(from * RATE), b = Math.min(L.length, Math.floor(to * RATE));
  let peak = 0, sum = 0, hf = 0, prev = 0;
  for (let i = a; i < b; i++) {
    const s = (L[i] + Rc[i]) / 2;
    const m = Math.abs(s);
    if (m > peak) peak = m;
    sum += s * s;
    const h = s - prev * 0.68; // crude 1-pole high-pass (~3 kHz): a harshness proxy
    prev = s;
    hf += h * h;
  }
  const n = Math.max(1, b - a);
  const rms = Math.sqrt(sum / n);
  return { peakDb: db(peak), rmsDb: db(rms), crest: db(peak) - db(rms), hfShare: sum > 0 ? hf / sum : 0 };
}
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1).padStart(6) : "   -inf");

console.log(`### ${profile.label}`);

// ---------------------------------------------------------------- 1. full mix
{
  const DUR = 60;
  const { d, ctx, at } = director(DUR);
  const timeline = [
    [0, snap({ phase: "lobby" })], [8, snap({})], [20, snap({ danger: 0.5 })], [28, snap({ danger: 1 })],
    [34, snap({ danger: 1, blackoutUntil: FAR })], [40, snap({ phase: "meeting" })], [50, snap({ phase: "ended", winner: "crew" })],
  ];
  for (const [t, s] of timeline) at(t, () => d.update(s)); // continuous layers follow immediately
  profile.drive(d, ctx, DUR, at, timeline);
  at(16, () => d.chime());
  at(24, () => d.heart(24)); at(25.1, () => d.heart(25.1)); at(26.1, () => d.heart(26.1));
  at(30, () => d.thud());
  at(34, () => d.whoosh());
  const buffer = await ctx.startRendering();
  const all = analyse(buffer);
  console.log("=== FULL MIX (60 s: lobby 0-8, calm 8-20, danger .5 20-28, danger 1 28-34, blackout 34-40, meeting 40-50, ended 50-60)");
  console.log(`overall  peak ${fmt(all.peakDb)} dBFS   rms ${fmt(all.rmsDb)} dB   crest ${fmt(all.crest)} dB   hf-share ${(all.hfShare * 100).toFixed(1)}%`);
  const ws = [];
  for (let t = 0; t + 2 <= DUR; t += 2) ws.push({ t, ...analyse(buffer, t, t + 2) });
  const rmsVals = ws.map((w) => w.rmsDb).filter(Number.isFinite).sort((a, b) => a - b);
  const median = rmsVals[Math.floor(rmsVals.length / 2)];
  console.log(`2 s windows: rms median ${fmt(median)} dB, min ${fmt(rmsVals[0])}, max ${fmt(rmsVals[rmsVals.length - 1])}, spread ${fmt(rmsVals[rmsVals.length - 1] - rmsVals[0])} dB`);
  for (const w of ws) console.log(`  t=${String(w.t).padStart(2)}s  peak ${fmt(w.peakDb)}  rms ${fmt(w.rmsDb)}  hf ${(w.hfShare * 100).toFixed(0).padStart(3)}%`);
  const problems = [];
  if (all.peakDb > -0.5) problems.push(`clipping risk: peak ${all.peakDb.toFixed(1)} dBFS`);
  if (rmsVals[rmsVals.length - 1] - median > 10) problems.push(`loudest window is ${(rmsVals[rmsVals.length - 1] - median).toFixed(1)} dB over the median`);
  for (const w of ws) if (w.hfShare > 0.35 && w.rmsDb > -30) problems.push(`harsh window at ${w.t}s (hf ${(w.hfShare * 100).toFixed(0)}%)`);
  console.log(problems.length ? `PROBLEMS:\n  - ${problems.join("\n  - ")}` : "OK: no clipping, even loudness, no harsh windows");
}

// ---------------------------------------------------------------- 2. one-shots solo
{
  console.log("\n=== SOUNDS IN ISOLATION (each rendered alone through the same buses + compressor)");
  const rows = [];
  for (const [name, fire] of Object.entries(profile.shots)) {
    const { d, ctx } = director(4);
    profile.solo(d, name);
    fire(d);
    const buffer = await ctx.startRendering();
    rows.push({ name, ...analyse(buffer, 0, 3.5) });
  }
  console.log("name           peak dBFS   rms dB   crest   hf%");
  for (const r of rows) console.log(`${r.name.padEnd(14)} ${fmt(r.peakDb)}     ${fmt(r.rmsDb)}  ${fmt(r.crest)}   ${(r.hfShare * 100).toFixed(0).padStart(3)}`);
  const peaks = rows.map((r) => r.peakDb).filter(Number.isFinite);
  const lo = Math.min(...peaks), hi = Math.max(...peaks);
  console.log(`peak band: ${lo.toFixed(1)} … ${hi.toFixed(1)} dBFS (spread ${(hi - lo).toFixed(1)} dB)`);
  const loud = rows.filter((r) => r.peakDb > -3);
  const harsh = rows.filter((r) => r.hfShare > 0.5 && r.peakDb > -20);
  if (loud.length) console.log(`PROBLEM too hot: ${loud.map((r) => r.name).join(", ")}`);
  if (harsh.length) console.log(`PROBLEM harsh (HF-heavy): ${harsh.map((r) => r.name).join(", ")}`);
  if (!loud.length && !harsh.length) console.log("OK: every sound sits below -3 dBFS and none is HF-dominated");
}
