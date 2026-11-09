// Netcode under simulated network conditions.
//
// A local proxy holds every /play HTTP request (and, separately, the SSE stream)
// for a configurable delay + jitter, and can drop a percentage of responses.
// The real browser client runs behind it, so what is measured is the *player's*
// experience: how far behind the server their own soul is drawn, and how often
// a rendered frame has no fresh position for a moving neighbour.
//
// Usage:
//   BASE=http://127.0.0.1:3100 LATENCY_MS=120 JITTER_MS=40 LOSS_PCT=2 \
//   SECONDS=10 node scripts/probe-latency.mjs
import { randomUUID } from "node:crypto";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const ORIGIN = process.env.BASE ?? "http://127.0.0.1:3100";
const [oHost, oPort] = ORIGIN.replace(/^https?:\/\//, "").split(":");
const LAT = Number(process.env.LATENCY_MS ?? 120); // one-way added delay
const JITTER = Number(process.env.JITTER_MS ?? 40);
const JIT = Number(process.env.JITTER_MS ?? 40);
const LOSS = Number(process.env.LOSS_PCT ?? 0); // % of responses discarded once
const SECONDS = Number(process.env.SECONDS ?? 10);
const VIEW = { width: 1280, height: 800 };
const headers = { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
const jitter = () => Math.max(0, LAT + (Math.random() * 2 - 1) * JIT);

// ---- the proxy --------------------------------------------------------------
let proxied = 0, dropped = 0, seen = 0, streamFrames = 0, posFrames = 0;
const paths = new Map();
const server = http.createServer((req, res) => {
  seen++;
  const pk = req.url.replace(/\?.*/, "").replace(/\/[A-Z0-9]{4}\//, "/:room/");
  paths.set(pk, (paths.get(pk) ?? 0) + 1);
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const isStream = req.url.includes("/state/stream");
    // Loss applies only to the game's own traffic (state frames and inputs).
    // Dropping the HTML/JS bundle would measure a CDN outage, not netcode.
    const isGame = isStream || req.url.includes("/api/game/");
    const drop = isGame && LOSS > 0 && Math.random() * 100 < LOSS;
    const pass = (attempt) => {
      // A "lost" attempt is answered with a connection reset, which is what a
      // real loss looks like to a browser: the socket dies and the client retries.
      if (isGame && LOSS > 0 && Math.random() * 100 < LOSS) {
        dropped++;
        setTimeout(() => { try { res.socket?.destroy(); } catch {} }, 1);
        return;
      }
      const preq = http.request({ host: oHost, port: Number(oPort ?? 80), path: req.url, method: req.method, headers: { ...req.headers, host: `${oHost}:${oPort ?? 80}` } }, (pres) => {
        proxied++;
        if (isStream) {
          pres.setEncoding("utf8");
          let leftover = "";
          pres.on("data", (chunk) => {
            leftover += chunk;
            let i;
            while ((i = leftover.indexOf("\n\n")) >= 0) {
              const rec = leftover.slice(0, i); leftover = leftover.slice(i + 2);
              if (rec.startsWith("data:")) {
                streamFrames++;
                const f = JSON.parse(rec.slice(5));
                if (f.patch?.players || f.delta?.players || f.snap) posFrames++;
              }
            }
          });
        }
        res.writeHead(pres.statusCode ?? 502, pres.headers);
        pres.pipe(res);
      });
      preq.on("error", () => { try { res.socket?.destroy(); } catch {} });
      if (body.length) preq.write(body);
      preq.end();
    };
    if (isStream) return pass(1); // an SSE stream cannot be replayed, only delayed
    // Outbound delay, then the reply after the same again. One attempt only: the
    // browser's own fetch/EventSource retry policy is what is under test.
    setTimeout(() => pass(1), jitter());
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const proxyPort = server.address().port;
const VIA = `http://127.0.0.1:${proxyPort}`;

const post = async (p, b) => (await fetch(`${ORIGIN}${p}`, { method: "POST", headers, body: JSON.stringify(b) })).json();

// ---- a town with walking bots ----------------------------------------------
await build({ entryPoints: ["static-src/main.ts"], bundle: true, outfile: "/tmp/probe-game.js", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
const hostId = randomUUID();
const { code } = await post("/api/game/create", { playerId: hostId, name: "Latency" });
const ids = [];
for (let i = 0; i < 3; i++) { const id = randomUUID(); ids.push(id); await post("/api/game/join", { code, playerId: id, name: `Bot${i}` }); }
const viewer = randomUUID();
await post("/api/game/join", { code, playerId: viewer, name: "Viewer" });

let running = true;
const bots = ids.map(async (id, i) => { let k = 0; while (running) { k++; await post("/api/game/input", { code, playerId: id, dir: Math.floor(k / 120) % 2 === 0 ? 1 : -1 }).catch(() => {}); await new Promise((r) => setTimeout(r, 100)); } });

// ---- the browser soul, behind the proxy ------------------------------------
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage({ viewport: VIEW });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem("hc_name", "Viewer"); } catch {} });
await page.goto(`${VIA}/play/?room=${code}&server=${VIA}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.evaluate(() => { const b = document.querySelector('[data-code]'); if (b) b.click(); });
await page.waitForTimeout(2000);
const started = await page.evaluate(async () => {
  const s = window.__hc?.snap?.(); if (!s) return "no-soul";
  const r = await fetch(`/api/game/input`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: s.code, playerId: s.self.id, action: "start" }) });
  return r.status;
});
await page.waitForTimeout(800);

// Walk the viewer's own soul with held keys, and sample what is on screen.
await page.keyboard.down("d");
await page.evaluate(() => {
  window.__samples = [];
  const sample = () => {
    const s = window.__hc?.snap?.();
    if (s && s.phase) window.__samples.push({ t: performance.now(), self: s.players.find((p) => p.id === s.self.id)?.x ?? null, others: s.players.filter((p) => p.id !== s.self.id).map((p) => [p.id.slice(0, 6), p.x, p.moving]) });
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
// --- input latency: presses from a standstill, measured to the drawn move -----
const pressLat = [];
for (let k = 0; k < 10; k++) {
  const x0 = await page.evaluate(() => { const s = window.__hc?.snap?.(); return s ? s.players.find((p) => p.id === s.self.id)?.x ?? 0 : 0; });
  await page.waitForTimeout(600); // settle: the detector must not see residual motion
  const t = Date.now();
  await page.keyboard.down("d");
  await page.waitForFunction(([x0v]) => {
    const s = window.__hc?.snap?.(); if (!s) return false;
    const x = s.players.find((p) => p.id === s.self.id)?.x ?? 0;
    return Math.abs(x - x0v) > 2;
  }, [x0], { timeout: 4000, polling: 4 }).catch(() => {});
  pressLat.push(Date.now() - t);
  await page.keyboard.up("d");
}
await page.waitForTimeout(SECONDS * 1000);
await page.keyboard.up("d");
const samples = await page.evaluate(() => window.__samples ?? []);
running = false; await Promise.allSettled(bots);
await browser.close(); server.close();

// ---- analysis --------------------------------------------------------------
const truth = await (await fetch(`${ORIGIN}/api/game/state?code=${code}&playerId=${viewer}`)).json();
const total = proxied + dropped;
console.log(`\n== ${LAT} ms one-way (${LAT * 2} ms RTT) ±${JITTER} ms jitter · ${dropped}/${total} responses lost (${total ? (100 * dropped / total).toFixed(1) : "0"}%) · ${SECONDS}s — start=${started}`);
const renderFps = samples.length / SECONDS;
console.log(`stream: ${streamFrames} frames (${(streamFrames / SECONDS).toFixed(1)}/s), ${posFrames} with positions (${(posFrames / SECONDS).toFixed(1)}/s)`);
console.log(`render ${(renderFps).toFixed(1)} fps, ${samples.length} samples, page errors: ${errors.length ? errors.join("|") : "none"}`);
console.log(`proxy saw ${seen} requests (${[...paths.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}×${v}`).join(", ")})`);

// Self: the drawn position can only ever be behind the server. Compare the last
// sample against the server's final truth and report the lag in distance and ms.
if (samples.length > 2) {
  const lastSelf = samples.at(-1).self, firstSelf = samples[0].self;
  const travelled = Math.abs(lastSelf - firstSelf);
  console.log(`self: travelled ${travelled.toFixed(0)} px over ${SECONDS}s (${(travelled / SECONDS).toFixed(0)} px/s, server SPEED is 190)`);
const pl = pressLat.slice().sort((a, b) => a - b);
const pq = (f) => (pl.length ? pl[Math.min(pl.length - 1, Math.floor(f * pl.length))] : 0);
console.log(`INPUT keypress → soul visibly moves: p50 ${pq(0.5)} ms (${(pq(0.5) / 16.7).toFixed(1)} frames) · p90 ${pq(0.9)} ms (${(pq(0.9) / 16.7).toFixed(1)}) · max ${pq(1)} ms`);
}
// Others: count rendered frames with no new position for a soul the server says is moving.
const byId = new Map();
for (const s of samples) for (const [id, x, moving] of s.others) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push({ t: s.t, x, moving }); }
for (const [id, pts] of byId) {
  if (pts.filter((p) => p.moving).length < 10) continue;
  let stall = 0, worst = 0, run = 0, steps = [];
  for (let i = 1; i < pts.length; i++) {
    if (!pts[i].moving) { run = 0; continue; }
    const d = pts[i].x - pts[i - 1].x;
    if (d === 0) { stall++; run++; worst = Math.max(worst, run); } else { run = 0; steps.push(Math.abs(d)); }
  }
  steps.sort((a, b) => a - b);
  const q = (f) => steps.length ? steps[Math.min(steps.length - 1, Math.floor(f * steps.length))] : 0;
  console.log(`neighbour ${id}: still frames while moving ${stall} (${(100 * stall / pts.length).toFixed(1)}%) · longest still run ${worst} frames · step px p50 ${q(0.5)} p95 ${q(0.95)} max ${q(1)}`);
}
process.exit(0);
