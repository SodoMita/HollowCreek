// Client performance bench for the standalone (React-free) game.
// Creates a town over the real API, fills it with bots that walk at 10 Hz,
// opens /play in headless Chromium as one more soul, and reports:
//   - frame pacing (rAF intervals: fps, p50/p95/p99, long frames > 50 ms)
//   - CPU profile hotspots (self time per function, from the unminified bundle)
//   - Chromium task/script/layout/style time and JS heap
//   - network bytes per second for the browser soul
// BASE=http://127.0.0.1:3100 SECONDS=12 BOTS=5 node scripts/bench-client.mjs
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const SECONDS = Number(process.env.SECONDS ?? 12);
const BOTS = Number(process.env.BOTS ?? 5);
const VIEW = { width: Number(process.env.VIEW_W ?? 1280), height: Number(process.env.VIEW_H ?? 800) };
const JSON_OUT = process.env.JSON_OUT ?? "";

const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const headers = { "content-type": "application/json", "x-forwarded-for": ip };
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// ---- town -------------------------------------------------------------------
const hostId = randomUUID();
const created = await post("/api/game/create", { playerId: hostId, name: "Bench" });
if (!created.data.code) throw new Error(`create failed ${created.status}`);
const code = created.data.code;
const bots = [];
for (let i = 0; i < BOTS; i++) {
  const id = randomUUID();
  const r = await post("/api/game/join", { code, playerId: id, name: `Bot${i}` });
  if (r.status >= 300) throw new Error(`join bot ${i} failed ${r.status}`);
  bots.push(id);
}
// Browser soul joins as the host's guest so it is in the same town.
const browserId = randomUUID();
{
  const r = await post("/api/game/join", { code, playerId: browserId, name: "Browser" });
  if (r.status >= 300) throw new Error(`join browser failed ${r.status}`);
}
await post("/api/game/input", { code, playerId: hostId, action: "start" });

let botsRunning = true;
const botLoop = async (id, offset) => {
  let tick = offset;
  while (botsRunning) {
    tick++;
    const dir = Math.floor(tick / 15) % 2 === 0 ? 1 : -1;
    await post("/api/game/input", { code, playerId: id, dir }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
  }
};
const botTasks = [hostId, ...bots].map((id, i) => botLoop(id, i));

// ---- unminified bundle so profile frames carry real names --------------------
mkdirSync("/tmp/bench", { recursive: true });
await build({
  entryPoints: [process.env.ENTRY ?? "static-src/main.ts"], bundle: true, minify: false, format: "iife", target: "es2020",
  outfile: "/tmp/bench/game.js", logLevel: "silent",
});
const dev = readFileSync("/tmp/bench/game.js", "utf8");

// ---- browser -----------------------------------------------------------------
const browser = await chromium.launch({ headless: true, args: ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
const page = await context.newPage();
let bytes = 0, requests = 0;
page.on("requestfinished", async (req) => {
  if (!req.url().includes("/api/game/")) return;
  try {
    const s = await req.sizes();
    bytes += s.responseBodySize + s.responseHeadersSize;
    requests++;
  } catch { /* aborted long-poll */ }
});
const useDev = process.env.MINIFIED !== "1";
if (useDev) await page.route("**/play/game.js", (route) => route.fulfill({ body: dev, contentType: "application/javascript" }));
const GRAPHICS = process.env.GRAPHICS ? JSON.parse(process.env.GRAPHICS) : null; // e.g. {"quality":"low"}
await page.addInitScript(([pid, name, graphics]) => {
  localStorage.setItem("hc_pid", pid);
  localStorage.setItem("hc_name", name);
  localStorage.setItem("hc_server", location.origin);
  if (graphics) localStorage.setItem("hc_settings_v1", JSON.stringify({ graphics }));
}, [browserId, "Browser", GRAPHICS]);

if (process.env.OPS === "1") await page.addInitScript(() => {
  // Count canvas 2D calls and state writes so the bench can show ops per frame.
  const counts = (window.__ops = {});
  const proto = CanvasRenderingContext2D.prototype;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof d.value === "function" && name !== "constructor") {
      const orig = d.value;
      proto[name] = function (...args) { counts[name] = (counts[name] ?? 0) + 1; return orig.apply(this, args); };
    } else if (d.set) {
      const set = d.set;
      Object.defineProperty(proto, name, { configurable: true, get: d.get, set(v) { counts["set:" + name] = (counts["set:" + name] ?? 0) + 1; set.call(this, v); } });
    }
  }
  const origGrad = CanvasRenderingContext2D.prototype.createLinearGradient;
});
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });

if (process.env.INJECT_CSS) await page.addInitScript((css) => { document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); }); }, process.env.INJECT_CSS);
await page.goto(`${BASE}/play/?room=${code}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const g = document.getElementById("game");
  return g && getComputedStyle(g).display !== "none";
}, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(6000); // art preload + first snapshots

// Warm-up done; measure.
if (process.env.PROF === "1") await page.evaluate(() => { const p = window.__prof; if (p) { p.acc = {}; p.on = true; } });
const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
await cdp.send("Profiler.start");
if (process.env.OPS === "1") await page.evaluate(() => { for (const k of Object.keys(window.__ops)) delete window.__ops[k]; });
const sample = await page.evaluate((secs) => new Promise((resolve) => {
  const stamps = [];
  const start = performance.now();
  const tick = (t) => {
    stamps.push(t);
    if (t - start < secs * 1000) requestAnimationFrame(tick);
    else resolve(stamps);
  };
  requestAnimationFrame(tick);
}), SECONDS);
const { profile } = await cdp.send("Profiler.stop");
const stages = process.env.PROF === "1" ? await page.evaluate(() => { const p = window.__prof; if (!p) return null; p.on = false; return p.acc; }) : null;
const opsCounts = process.env.OPS === "1" ? await page.evaluate(() => window.__ops) : null;
const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
if (process.env.SHOT) { try { await page.screenshot({ path: process.env.SHOT, timeout: 8000 }); } catch { console.log("screenshot skipped (headless capture unsupported on this GPU path)"); } }
const canvasPx = await page.evaluate(() => { const c = document.getElementById("cv"); return c ? [c.width, c.height] : null; });
const heap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);

botsRunning = false;
await Promise.allSettled(botTasks);
await browser.close();

// ---- analysis ----------------------------------------------------------------
const intervals = [];
for (let i = 1; i < sample.length; i++) intervals.push(sample[i] - sample[i - 1]);
intervals.sort((a, b) => a - b);
const pct = (p) => intervals.length ? intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))] : 0;
const span = (sample.at(-1) ?? 0) - (sample[0] ?? 0);

// self time per function from the CPU profile
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const node = byId.get(profile.samples[i]);
  const cf = node.callFrame;
  const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
}
const totalSelf = [...self.values()].reduce((a, b) => a + b, 0) || 1;
const hot = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  .map(([name, us]) => ({ name, ms: Math.round(us / 1000), pct: Number((us / totalSelf * 100).toFixed(1)) }));

const delta = (k) => (m1[k] ?? 0) - (m0[k] ?? 0);
const result = {
  code, graphics: GRAPHICS ?? "default", bots: BOTS + 1, seconds: Number(span.toFixed(1)), viewport: VIEW, bundle: useDev ? "unminified" : "minified",
  frames: sample.length,
  fps: Number((sample.length / (span / 1000)).toFixed(1)),
  frameMs: { p50: Number(pct(0.5).toFixed(1)), p95: Number(pct(0.95).toFixed(1)), p99: Number(pct(0.99).toFixed(1)), worst: Number((intervals.at(-1) ?? 0).toFixed(1)) },
  longFrames50ms: intervals.filter((x) => x > 50).length,
  cpuPctScript: Number((delta("ScriptDuration") / (span / 1000) * 100).toFixed(1)),
  cpuPctLayout: Number((delta("LayoutDuration") / (span / 1000) * 100).toFixed(1)),
  cpuPctStyle: Number((delta("RecalcStyleDuration") / (span / 1000) * 100).toFixed(1)),
  cpuPctTask: Number((delta("TaskDuration") / (span / 1000) * 100).toFixed(1)),
  netKBps: Number((bytes / 1024 / (span / 1000)).toFixed(2)),
  apiRequests: requests,
  heapMB: Number((heap / 1048576).toFixed(1)),
  canvasPx,
  hot,
};
if (stages) {
  const frames = Math.max(1, sample.length);
  result.stageMsPerFrame = Object.fromEntries(Object.entries(stages).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Number((v / frames).toFixed(2))]));
}
if (opsCounts) {
  const frames = Math.max(1, sample.length);
  result.opsPerFrame = Object.fromEntries(Object.entries(opsCounts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, Number((v / frames).toFixed(1))]));
}
console.log(JSON.stringify(result, null, 1));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 1));
