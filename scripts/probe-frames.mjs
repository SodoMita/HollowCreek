// On-screen motion probe: opens /play in headless Chromium as a real soul, walks
// a neighbour with bot inputs, and records every rendered frame's position for
// every soul. Reports how many rendered frames carried no new position for a
// moving soul (the stutter you can see) and the delta histogram.
// Usage: BASE=http://127.0.0.1:3100 SECONDS=8 node scripts/probe-frames.mjs
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";

const B = process.env.BASE ?? "http://127.0.0.1:3100";
const SECONDS = Number(process.env.SECONDS ?? 8);
const VIEW = { width: Number(process.env.VIEW_W ?? 1280), height: 800 };
const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const headers = { "content-type": "application/json", "x-forwarded-for": ip };
const post = async (p, b) => {
  const r = await fetch(`${B}${p}`, { method: "POST", headers, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 300 || j.ok === false) console.log(`  ! ${p} ${r.status} ${JSON.stringify(j)}`);
  return j;
};

// bundle main.ts so the page loads the same file a real player loads
await build({ entryPoints: ["static-src/main.ts"], bundle: true, outfile: "/tmp/probe-game.js", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });

const hostId = randomUUID();
const { code } = await post("/api/game/create", { playerId: hostId, name: "Probe" });
const ids = [];
for (let i = 0; i < 3; i++) { const id = randomUUID(); ids.push(id); await post("/api/game/join", { code, playerId: id, name: `Bot${i}` }); }
const viewer = randomUUID();
await post("/api/game/join", { code, playerId: viewer, name: "Viewer" });
// The last joiner holds the lantern (SYNC.md #1), so the match starts from the viewer.

let running = true;
const walker = ids[0];
const bot = async () => { let k = 0; while (running) { k++; await post("/api/game/input", { code, playerId: walker, dir: Math.floor(k / 150) % 2 === 0 ? 1 : -1 }); await new Promise((r) => setTimeout(r, 100)); } };
const others = ids.slice(1).map(async (id) => { let k = 0; while (running) { k++; await post("/api/game/input", { code, playerId: id, dir: Math.floor(k / 150) % 2 === 0 ? 1 : -1 }); await new Promise((r) => setTimeout(r, 100)); } });
const botTask = bot();

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: VIEW });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem("hc_name", "Viewer"); } catch {} });
await page.goto(`${B}/play/?room=${code}&server=${B}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.evaluate(() => { const b = document.querySelector('[data-code]'); if (b) b.click(); });
await page.waitForTimeout(2500);
// The viewer is the last joiner, so it holds the lantern and starts the night.
const started = await page.evaluate(async () => {
  const hc = window.__hc; const s = hc?.snap?.();
  const pid = s?.self?.id;
  if (!pid) return "no-soul";
  const r = await fetch(`/api/game/input`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: s.code, playerId: pid, action: "start" }) });
  return `${r.status} ${JSON.stringify(await r.json().catch(() => ({})))}`;
});
console.log("start:", started);
await page.waitForTimeout(1200);
// instrument: sample snap.players x each rAF frame
await page.evaluate(() => {
  window.__frames = [];
  const sample = () => { const hc = window.__hc; const s = hc?.snap?.(); if (s && s.phase) window.__frames.push({ t: performance.now(), xs: s.players.map((p) => [p.id.slice(0, 6), p.x, p.moving]) }); requestAnimationFrame(sample); };
  requestAnimationFrame(sample);
});
await page.waitForTimeout(SECONDS * 1000);
console.log("phase now:", (await (await fetch(`${B}/api/game/state?code=${code}&playerId=${viewer}`)).json()).phase, "host:", (await (await fetch(`${B}/api/game/state?code=${code}&playerId=${viewer}`)).json()).hostId === viewer);
const frames = await page.evaluate(() => window.__frames ?? []);
running = false; await botTask; await Promise.allSettled(others);
await browser.close();

// analyse
const byId = new Map();
for (const f of frames) for (const [id, x, moving] of f.xs) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push({ t: f.t, x, moving }); }
console.log(`frames captured: ${frames.length} (${(frames.length / SECONDS).toFixed(1)} fps render sampling)`);
const report = [];
for (const [id, pts] of byId) {
  if (pts.filter((p) => p.moving).length < 10) { console.log(`soul ${id}: never in motion (${pts.length} samples)`); continue; }
  let stall = 0, worstRun = 0, run = 0, steps = [], flips = 0, prevSign = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!pts[i].moving) { run = 0; continue; }
    const d = pts[i].x - pts[i - 1].x;
    const sign = Math.sign(d);
    if (sign && prevSign && sign !== prevSign) flips++;
    if (sign) prevSign = sign;
    if (d === 0) { stall++; run++; worstRun = Math.max(worstRun, run); } else { run = 0; steps.push(Math.abs(d)); }
  }
  steps.sort((a, b) => a - b);
  const q = (f) => steps.length ? steps[Math.min(steps.length - 1, Math.floor(f * steps.length))] : 0;
  // `flips` are the bot's own direction changes, not a glitch; the number to
  // watch is `stall` (rendered frames with a still soul) and `worstRun`.
  console.log(`soul ${id}: sampled ${(pts.length / SECONDS).toFixed(1)} fps · still frames while moving ${stall} (${(100 * stall / pts.length).toFixed(1)}%) · longest still run ${worstRun} · step px p50 ${q(0.5)} p95 ${q(0.95)} max ${q(1)} · reversals ${flips}`);
}
console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
process.exit(0);
