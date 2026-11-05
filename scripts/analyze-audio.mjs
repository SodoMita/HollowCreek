// Offline loudness / harshness analysis of the generative score (src/game/audio.ts).
//
// Renders the AudioDirector into an OfflineAudioContext (no speakers needed) and
// prints peak dBFS, RMS, crest factor and high-frequency energy share for:
//   1. the full "playing" mix over 60 s (calm → danger → blackout → meeting → end)
//   2. every one-shot sound in isolation, so their levels can be matched
//
// Requires `node-web-audio-api` + `esbuild` (devDependencies are not pinned for
// this; install them in a scratch folder and run with NODE_PATH):
//   mkdir -p /tmp/audiolab && cd /tmp/audiolab && npm i esbuild node-web-audio-api
//   NODE_PATH=/tmp/audiolab/node_modules node scripts/analyze-audio.mjs
// On minimal containers libasound.so.2 may be missing; extract Debian's
// libasound2 .deb somewhere and point LD_LIBRARY_PATH at its lib directory.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { OfflineAudioContext } = require("node-web-audio-api");
const { build } = require("esbuild");

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 48000;

async function load() {
  const out = await build({
    stdin: {
      contents: 'export * from "./src/game/audio"; export * from "./src/game/settings";',
      resolveDir: repo,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

const { AudioDirector, createDefaultSettings } = await load();

function makeStore(overrides = {}) {
  const value = createDefaultSettings();
  Object.assign(value.audio, { muted: false, adaptiveMusic: true, heartbeat: true }, overrides);
  return { value, subscribe: () => () => {}, update: (fn) => fn(value) };
}

/** Build a director whose AudioContext is an offline context of `seconds`. */
function director(seconds, overrides) {
  let ctx = null;
  class OfflineAsLive extends OfflineAudioContext {
    constructor() { super(2, Math.ceil(RATE * seconds), RATE); ctx = this; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: OfflineAsLive };
  // We drive the step clock by hand: the live tick() must not schedule anything.
  AudioDirector.prototype.tick = function tick() {};
  const d = new AudioDirector(makeStore(overrides));
  d.start();
  d.step = 0;
  d.nextStepTime = 0.15;
  return { d, ctx };
}

function snap(partial = {}) {
  return {
    now: 1_000_000,
    phase: "playing",
    danger: 0,
    blackoutUntil: 0,
    bellAt: 0,
    taskBar: { done: 0, total: 9 },
    self: { id: "me", alive: true },
    players: [{ id: "me", moving: false }],
    winner: null,
    ...partial,
  };
}

const db = (v) => (v <= 1e-9 ? -Infinity : 20 * Math.log10(v));

function analyse(buffer, from = 0, to = buffer.duration) {
  const L = buffer.getChannelData(0), Rc = buffer.getChannelData(1);
  const a = Math.floor(from * RATE), b = Math.min(L.length, Math.floor(to * RATE));
  let peak = 0, sum = 0, hf = 0, total = 0, prev = 0;
  for (let i = a; i < b; i++) {
    const s = (L[i] + Rc[i]) / 2;
    const m = Math.abs(s);
    if (m > peak) peak = m;
    sum += s * s;
    // crude 1-pole high-pass (~3 kHz) energy share: a harshness proxy
    const h = s - prev * 0.68;
    prev = s;
    hf += h * h;
    total += s * s;
  }
  const n = Math.max(1, b - a);
  const rms = Math.sqrt(sum / n);
  return { peak, peakDb: db(peak), rmsDb: db(rms), crest: db(peak) - db(rms), hfShare: total > 0 ? hf / total : 0 };
}

function windows(buffer, size = 1) {
  const out = [];
  for (let t = 0; t + size <= buffer.duration + 1e-6; t += size) out.push({ t, ...analyse(buffer, t, t + size) });
  return out;
}

const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1).padStart(6) : "   -inf");

// ---------------------------------------------------------------- 1. full mix
{
  const DUR = 60;
  const { d, ctx } = director(DUR);
  // Deterministic walk through the night: calm → danger → blackout → meeting → crew win.
  const timeline = [
    [0, snap({ phase: "lobby" })],
    [8, snap({})],
    [20, snap({ danger: 0.5 })],
    [28, snap({ danger: 1 })],
    [34, snap({ danger: 1, blackoutUntil: 2_000_000 })],
    [40, snap({ phase: "meeting" })],
    [50, snap({ phase: "ended", winner: "crew" })],
  ];
  // Step clock: continue where start() left off.
  let i = 0;
  while (d.nextStepTime < DUR) {
    while (i < timeline.length && timeline[i][0] <= d.nextStepTime) { d.update(timeline[i][1]); i++; }
    d.onStep(d.step, d.nextStepTime);
    d.step++;
    d.nextStepTime += 60 / 144;
  }
  // one-shots and free-running events at known times
  d.chime(); // at 0 — a little loud reference at start
  const at = (t, fn) => { const real = ctx.currentTime; Object.defineProperty(ctx, "currentTime", { value: t, configurable: true }); fn(); Object.defineProperty(ctx, "currentTime", { value: real, configurable: true }); };
  at(12, () => d.toll(1));
  at(16, () => d.chime());
  at(24, () => d.heart(24)); at(25.1, () => d.heart(25.1)); at(26.1, () => d.heart(26.1));
  at(30, () => d.thud());
  at(34, () => d.whoosh());
  at(36, () => d.owl(36));
  for (let k = 0; k < 8; k++) at(14 + k * 0.36, () => d.footstep(14 + k * 0.36));
  at(50.5, () => d.cadence());
  // the continuous layers at full dread for the 28–40 s window
  const buffer = await ctx.startRendering();
  const all = analyse(buffer);
  console.log("=== FULL MIX (60 s: lobby 0-8, calm 8-20, danger .5 20-28, danger 1 28-34, blackout 34-40, meeting 40-50, ended 50-60)");
  console.log(`overall  peak ${fmt(all.peakDb)} dBFS   rms ${fmt(all.rmsDb)} dB   crest ${fmt(all.crest)} dB   hf-share ${(all.hfShare * 100).toFixed(1)}%`);
  const ws = windows(buffer, 2);
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
  console.log("\n=== ONE-SHOTS (each rendered alone through the same buses + compressor)");
  const shots = {
    box: (d) => d.box(0.05, 440, 0.15),
    chime: (d) => d.chime(),
    pluckChord: (d) => d.pluckChord({ pad: [17, 20, 24, 29], bass: 5 }, 0.12),
    bass: (d) => d.bass(0.05, 5, 0.13),
    pad: (d) => { d.phase = "playing"; d.pad(0.05, { pad: [17, 20, 24, 29], bass: 5 }); },
    toll: (d) => d.toll(1),
    tollSoft: (d) => d.toll(1, 0.55),
    thud: (d) => d.thud(),
    riseTone: (d) => d.riseTone(),
    whoosh: (d) => d.whoosh(),
    heart: (d) => { d.n.heartGain.gain.value = 0.3; d.heart(0.05); },
    footstep: (d) => d.footstep(0.05),
    clock: (d) => d.clock(0.05, true),
    owl: (d) => d.owl(0.05),
    cadenceWin: (d) => { d.winner = "crew"; d.cadence(); },
    cadenceLoss: (d) => { d.winner = "hollow"; d.cadence(); },
    cluster: (d) => { d.n.clusterGain.gain.value = 0.03; },
    windBlackout: (d) => { d.n.windGain.gain.value = 0.26; d.n.rumbleGain.gain.value = 0.22; d.n.windFilter.frequency.value = 220; },
    crickets: (d) => { d.n.cricketGain.gain.value = 0.014; },
  };
  const rows = [];
  for (const [name, fire] of Object.entries(shots)) {
    const { d, ctx } = director(4);
    // silence the generators so only the tested sound remains (the wind gain
    // has an additive breath LFO, so it must be disconnected, not zeroed)
    if (!name.startsWith("wind")) d.n.windFilter.disconnect();
    d.n.cricketGain.gain.value = 0;
    fire(d);
    const buffer = await ctx.startRendering();
    const a = analyse(buffer, 0, 3.5);
    rows.push({ name, ...a });
  }
  const finite = rows.filter((r) => Number.isFinite(r.peakDb));
  const shots95 = finite.map((r) => r.peakDb);
  const lo = Math.min(...shots95), hi = Math.max(...shots95);
  console.log("name           peak dBFS   rms dB   crest   hf%");
  for (const r of rows) console.log(`${r.name.padEnd(14)} ${fmt(r.peakDb)}     ${fmt(r.rmsDb)}  ${fmt(r.crest)}   ${(r.hfShare * 100).toFixed(0).padStart(3)}`);
  console.log(`peak band across one-shots: ${lo.toFixed(1)} … ${hi.toFixed(1)} dBFS (spread ${(hi - lo).toFixed(1)} dB)`);
  const loud = rows.filter((r) => r.peakDb > -3);
  const harsh = rows.filter((r) => r.hfShare > 0.5 && r.peakDb > -20);
  if (loud.length) console.log(`PROBLEM too hot: ${loud.map((r) => r.name).join(", ")}`);
  if (harsh.length) console.log(`PROBLEM harsh (HF-heavy): ${harsh.map((r) => r.name).join(", ")}`);
  if (!loud.length && !harsh.length) console.log("OK: every one-shot sits below -3 dBFS and none is HF-dominated");
}
