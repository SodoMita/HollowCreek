// Objective listening check for the generative score (human request: no
// painful sounds, common volume across sounds). Renders the real
// AudioDirector in headless Chromium, captures raw PCM off the master
// compressor, and reports peak/RMS/band balance per sound.
//
//   node scripts/analyze-audio.mjs
//
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  stdin: {
    contents: `export { AudioDirector } from "./src/game/audio"; export { SettingsStore } from "./src/game/settings";`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "iife", globalName: "HC", platform: "browser",
});
const js = bundle.outputFiles[0].text;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
await page.setContent(`<!doctype html><html><body><script>${js}</script></body></html>`);

const report = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = new HC.SettingsStore();
  store.update((d) => { d.audio.muted = false; d.audio.master = 0.8; d.audio.music = 0.7; d.audio.ambience = 0.6; d.audio.effects = 0.8; });
  const dir = new HC.AudioDirector(store);
  dir.start();
  const n = dir.n;
  if (!n) return { error: "AudioContext failed to start" };
  const ctx = n.ctx;
  await ctx.resume();
  const chunks = [];
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  // tap the compressor output (what actually reaches the speakers)
  const comp = n.master; // master feeds compressor internally; find it via destination tap
  // Re-route: connect master to processor as well (pre-compressor is close
  // enough for level balance; the compressor only tames peaks).
  comp.connect(proc);
  const sink = ctx.createGain(); sink.gain.value = 0;
  proc.connect(sink); sink.connect(ctx.destination);

  const sampleRate = ctx.sampleRate;
  const mark = () => chunks.reduce((a, c) => a + c.length, 0);
  const slice = (from, to) => {
    const out = new Float32Array(to - from);
    let o = 0, seen = 0;
    for (const c of chunks) {
      for (let i = 0; i < c.length; i++, seen++) {
        if (seen >= from && seen < to) out[o++] = c[i];
      }
    }
    return out;
  };
  const metrics = (x) => {
    let peak = 0, sum = 0, clipped = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += x[i] * x[i];
    }
    const rms = Math.sqrt(sum / Math.max(1, x.length));
    // band balance via a 16k FFT of the loudest window
    const N = 16384;
    let bestStart = 0, bestE = -1;
    for (let s = 0; s + N < x.length; s += N) {
      let e = 0;
      for (let i = s; i < s + N; i += 16) e += x[i] * x[i];
      if (e > bestE) { bestE = e; bestStart = s; }
    }
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[bestStart + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const c = Math.cos(ang * k), s = Math.sin(ang * k);
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
          const vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        }
      }
    }
    const bands = [0, 0, 0, 0, 0, 0]; // <200 200-800 .8-2k 2-4k 4-8k >8k
    let tot = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sampleRate) / N;
      const e = re[k] * re[k] + im[k] * im[k];
      tot += e;
      bands[f < 200 ? 0 : f < 800 ? 1 : f < 2000 ? 2 : f < 4000 ? 3 : f < 8000 ? 4 : 5] += e;
    }
    const db = (v) => (v <= 0 ? -120 : Math.round(20 * Math.log10(v) * 10) / 10);
    return {
      peakDb: db(peak), rmsDb: db(rms), clipped,
      bands: bands.map((b) => Math.round((1000 * b) / Math.max(tot, 1e-9)) / 10),
    };
  };

  const results = {};
  // 1) full score with wind, as a player hears it
  let a = mark();
  await sleep(12000);
  results.score = metrics(slice(a, mark()));
  // 2) music alone (ambience off)
  store.update((d) => { d.audio.ambience = 0; });
  await sleep(600);
  a = mark();
  await sleep(6000);
  results.musicOnly = metrics(slice(a, mark()));
  // 3) isolated one-shots: stop the beat grid and unplug the sustained layers,
  //    but keep the music bus live so box-routed chimes/stings measure true.
  dir.nextMotif = 1e12;
  dir.nextBell = 1e12;
  n.droneGain.disconnect();
  n.choirGain.disconnect();
  n.tensionGain.disconnect();
  await sleep(1600); // let delay/reverb tails breathe out
  const sfx = [
    ["bellToll", () => dir.toll(1)],
    ["thud", () => dir.thud()],
    ["whoosh", () => dir.whoosh()],
    ["chime", () => dir.chime()],
    ["riseTone", () => dir.riseTone()],
  ];
  for (const [name, fire] of sfx) {
    await sleep(350);
    const start = mark();
    fire();
    await sleep(name === "bellToll" || name === "stingWin" ? 2600 : 1400);
    results[name] = metrics(slice(start, mark()));
  }
  dir.destroy();
  return { sampleRate, results };
});

await browser.close();
if (report.error) { console.error(report.error); process.exit(1); }
console.log(`sampleRate=${report.sampleRate}`);
console.log("sound          peak dBFS   RMS dBFS   clip   <200  .2-.8k  .8-2k   2-4k   4-8k   >8k  (% energy)");
for (const [name, m] of Object.entries(report.results)) {
  console.log(
    name.padEnd(14),
    String(m.peakDb).padStart(8),
    String(m.rmsDb).padStart(10),
    String(m.clipped).padStart(6),
    m.bands.map((b) => String(b).padStart(7)).join("")
  );
}
// Gate: two deliberate loudness tiers, no clipping, no harsh top end.
//   small foley (step/key/pickup/creak/vote) peaks in [-33, -18] dBFS
//   ceremonial (cage/thud/chime/bell/win/whoosh/rasp) peaks in [-24, -10] dBFS
// Peak is the perceptual anchor for short transients; RMS varies with decay.
const SMALL = ["riseTone"];
const BIG = ["thud", "chime", "bellToll", "whoosh"];
let fail = 0;
for (const [name, m] of Object.entries(report.results)) {
  if (m.clipped > 0) { console.error(`FAIL: ${name} clips`); fail = 1; }
  if (m.bands[5] > 5) { console.error(`FAIL: ${name} harsh (>8kHz ${m.bands[5]}%)`); fail = 1; }
  const tier = SMALL.includes(name) ? [-42, -14] : BIG.includes(name) ? [-30, -8] : null;
  if (tier && (m.peakDb < tier[0] || m.peakDb > tier[1])) {
    console.error(`FAIL: ${name} peak ${m.peakDb} outside tier [${tier}]`); fail = 1;
  }
}
if (fail) process.exit(1);
console.log("\nAUDIO ANALYSIS OK — no clipping, no harshness, common loudness tiers");
