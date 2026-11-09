// Network latency, jitter & transport benchmark for Hollow Creek.
// Runs a local FIFO TCP latency/jitter proxy in front of a live server,
// drives an 8-player room with headless Chromium, and measures:
//   - input-to-first-move latency (keydown -> first server movement frame)
//   - hold-release stop latency
//   - quick-tap preservation (35ms taps under RTT + jitter)
//   - SSE / long-poll arrival cadence, bandwidth, rAF fps, zero-move frames, reversals
//
// Usage:
//   BASE=http://127.0.0.1:3100 ONE_WAY_MS=50 JITTER_MS=20 node scripts/bench-net-latency.mjs
//   BLOCK_SSE=1 ONE_WAY_MS=50 JITTER_MS=20 node scripts/bench-net-latency.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const DIRECT = (process.env.BASE ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const targetUrl = new URL(DIRECT);
const ONE_WAY_MS = Number(process.env.ONE_WAY_MS ?? 50);
const JITTER_MS = Number(process.env.JITTER_MS ?? 20);
const BLOCK_SSE = process.env.BLOCK_SSE === "1";

function makeFifoSender(writeFn, endFn) {
  let lastDeliverAt = 0;
  let pending = 0;
  let ended = false;
  return {
    send(chunk, baseDelay) {
      pending++;
      const now = performance.now();
      const target = Math.max(lastDeliverAt, now + Math.max(1, baseDelay + (Math.random() * 2 - 1) * JITTER_MS));
      lastDeliverAt = target;
      const wait = Math.max(1, target - now);
      setTimeout(() => {
        pending--;
        writeFn(chunk);
        if (ended && pending === 0) endFn();
      }, wait);
    },
    end() { ended = true; if (pending === 0) endFn(); },
  };
}

const proxy = http.createServer((req, res) => {
  if (BLOCK_SSE && req.url?.includes("/api/game/state/stream")) {
    res.writeHead(502).end("SSE blocked");
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const upDelay = req.url?.includes("/api/game/") ? Math.max(1, ONE_WAY_MS + (Math.random() * 2 - 1) * JITTER_MS) : 2;
    setTimeout(() => {
      const pReq = http.request({
        hostname: targetUrl.hostname,
        port: Number(targetUrl.port || 80),
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.host },
      }, (pRes) => {
        const isSse = (pRes.headers["content-type"] || "").includes("text/event-stream");
        if (isSse) {
          res.writeHead(pRes.statusCode ?? 200, pRes.headers);
          const link = makeFifoSender(
            (chunk) => { if (!res.writableEnded) res.write(chunk); },
            () => { if (!res.writableEnded) res.end(); },
          );
          pRes.on("data", (chunk) => link.send(chunk, ONE_WAY_MS));
          pRes.on("end", () => link.end());
        } else {
          const rChunks = [];
          pRes.on("data", (c) => rChunks.push(c));
          pRes.on("end", () => {
            const d = req.url?.includes("/api/game/") ? Math.max(1, ONE_WAY_MS + (Math.random() * 2 - 1) * JITTER_MS) : 2;
            setTimeout(() => {
              if (!res.writableEnded) {
                res.writeHead(pRes.statusCode ?? 200, pRes.headers);
                res.end(Buffer.concat(rChunks));
              }
            }, d);
          });
        }
      });
      pReq.on("error", () => { if (!res.writableEnded) res.writeHead(502).end(); });
      req.on("close", () => pReq.destroy());
      if (body.length) pReq.write(body);
      pReq.end();
    }, upDelay);
  });
});

await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const addr = proxy.address();
const PROXY = `http://127.0.0.1:${addr.port}`;

const post = async (url, p, b) => (await fetch(`${url}${p}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.94" },
  body: JSON.stringify(b),
})).json();

const ids = Array.from({ length: 8 }, () => randomUUID());
const { code } = await post(DIRECT, "/api/game/create", { playerId: ids[0], name: "LatHost" });
for (let i = 1; i < 8; i++) await post(DIRECT, "/api/game/join", { code, playerId: ids[i], name: `Bot${i}` });
await post(DIRECT, "/api/game/input", { code, playerId: ids[7], action: "start" });

let running = true;
const botControllers = [];
for (const bid of ids.slice(1, 7)) {
  const c = new AbortController();
  botControllers.push(c);
  void fetch(`${DIRECT}/api/game/state/stream?code=${code}&playerId=${bid}`, { signal: c.signal })
    .then(async (r) => {
      const reader = r.body.getReader();
      while (running) { const { done } = await reader.read(); if (done) break; }
    }).catch(() => {});
}
const botWalk = (async () => {
  let step = 0;
  while (running) {
    step++;
    const dir = Math.floor(step / 12) % 2 ? 1 : -1;
    await Promise.all(ids.slice(1, 7).map((id) => post(DIRECT, "/api/game/input", { code, playerId: id, dir }).catch(() => {})));
    await new Promise((r) => setTimeout(r, 120));
  }
})();

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(([pid]) => {
    localStorage.setItem("hc_pid", pid);
    localStorage.setItem("hc_name", "LatHost");
    localStorage.setItem("hc_server", location.origin);
    window.__m = { sseDts: [], sseLast: 0, sseBytes: 0, rafDx: [], rafDt: [], startLat: [], stopLat: [], tapMoved: [] };
    let latestX = null, lastRafX = null, lastRafT = 0, selfIdx = -1;
    let waitStartAt = 0, startBaseX = 0;
    let waitStopAt = 0, lastMoveX = 0, stillCount = 0;

    function onData(d, len) {
      const now = performance.now();
      if (window.__m.sseLast) window.__m.sseDts.push(now - window.__m.sseLast);
      window.__m.sseLast = now;
      window.__m.sseBytes += len;
      if (d.snap) { selfIdx = d.snap.players.findIndex((p) => p.id === pid); latestX = d.snap.players[selfIdx]?.x ?? latestX; }
      else if (d.delta?.players) { selfIdx = d.delta.players.findIndex((p) => p.id === pid); latestX = d.delta.players[selfIdx]?.x ?? latestX; }
      else if (d.patch?.players) {
        const p = d.patch.players.find((x) => x.i === selfIdx || x.id === pid);
        if (p && p.x !== undefined) latestX = p.x;
      }
      if (waitStartAt && latestX !== null && latestX !== startBaseX) {
        window.__m.startLat.push(now - waitStartAt);
        waitStartAt = 0;
      }
    }
    const OrigES = window.EventSource;
    window.EventSource = class extends OrigES {
      constructor(url) {
        super(url);
        this.addEventListener("message", (ev) => onData(JSON.parse(ev.data), ev.data.length));
      }
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      if (typeof args[0] === "string" && args[0].includes("/api/game/state?") && res.status === 200) {
        const clone = res.clone();
        clone.text().then((t) => { try { onData(JSON.parse(t), t.length); } catch {} });
      }
      return res;
    };
    window.__beginHold = () => { waitStartAt = performance.now(); startBaseX = latestX ?? 0; };
    window.__endHold = () => { waitStopAt = performance.now(); lastMoveX = latestX ?? 0; stillCount = 0; };
    window.__x = () => latestX;
    const origRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => origRAF((t) => {
      const r = cb(t);
      if (lastRafT) window.__m.rafDt.push(t - lastRafT);
      lastRafT = t;
      if (latestX !== null) {
        if (lastRafX !== null) window.__m.rafDx.push(latestX - lastRafX);
        if (waitStopAt) {
          if (latestX === lastMoveX) {
            if (++stillCount >= 2) { window.__m.stopLat.push(performance.now() - waitStopAt); waitStopAt = 0; }
          } else { lastMoveX = latestX; stillCount = 0; }
        }
        lastRafX = latestX;
      }
      return r;
    });
  }, [ids[0]]);

  await page.goto(`${PROXY}/play/?room=${code}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("game")?.style.display === "block");
  await page.waitForTimeout(1000);

  for (let c = 0; c < 3; c++) {
    await page.evaluate(() => window.__beginHold());
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(450);
    await page.evaluate(() => window.__endHold());
    await page.keyboard.up("KeyD");
    await page.waitForTimeout(350);
  }
  for (let c = 0; c < 3; c++) {
    const x0 = await page.evaluate(() => window.__x());
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(35);
    await page.keyboard.up("KeyD");
    await page.waitForTimeout(350);
    const x1 = await page.evaluate(() => window.__x());
    await page.evaluate((d) => window.__m.tapMoved.push(d), x1 - x0);
  }
  await page.evaluate(() => { window.__m.sseDts.length = 0; window.__m.sseLast = 0; window.__m.sseBytes = 0; window.__m.rafDx.length = 0; window.__m.rafDt.length = 0; });
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(2000);
  await page.keyboard.up("KeyA");

  const m = await page.evaluate(() => window.__m);
  const pct = (arr, p) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1) : 0;
  };
  const skipWarm = Math.max(10, Math.ceil((ONE_WAY_MS * 2 + JITTER_MS) / 16) + 4);
  const activeDx = m.rafDx.slice(skipWarm, -5);
  console.log(JSON.stringify({
    mode: BLOCK_SSE ? "long-poll" : "SSE",
    rttMs: ONE_WAY_MS * 2, jitterMs: JITTER_MS,
    holdStartLatencyMs: m.startLat.map((x) => +x.toFixed(1)),
    holdStopLatencyMs: m.stopLat.map((x) => +x.toFixed(1)),
    quick35msTapPx: m.tapMoved,
    framesIn2s: m.sseDts.length,
    KBps: +((m.sseBytes / 1024) / 2).toFixed(2),
    arrivalGapMs: { p50: pct(m.sseDts, 0.5), p95: pct(m.sseDts, 0.95), max: pct(m.sseDts, 1) },
    rafFps: +(m.rafDt.length / 2).toFixed(1),
    rafZeroMoveFrames: activeDx.filter((x) => x === 0).length,
    rafReversals: activeDx.filter((x) => x > 0).length,
  }, null, 2));
  assert.ok(m.tapMoved.every((d) => d > 0), `all 35ms quick taps moved: ${m.tapMoved}`);
  assert.equal(activeDx.filter((x) => x > 0).length, 0, "zero reversals");
} finally {
  running = false;
  botControllers.forEach((c) => c.abort());
  await botWalk;
  await browser.close();
  for (const id of ids) await post(DIRECT, "/api/game/leave", { code, playerId: id }).catch(() => {});
  proxy.closeAllConnections?.();
  proxy.close();
}
process.exit(0);
