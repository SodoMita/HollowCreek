// Measures what the real renderer DRAWS. No fake movement, interpolation or delay buffer.
// BASE=http://127.0.0.1:3100 ONE_WAY_MS=50 JITTER_MS=20 LABEL=before node scripts/bench-motion.mjs
// PLAYWRIGHT_BROWSERS_PATH=.cache/pw makes installed browsers portable in the sandbox.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { latencyProxy } from "./lib/latency-proxy.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const ONE_WAY_MS = Number(process.env.ONE_WAY_MS ?? 0);
const JITTER_MS = Number(process.env.JITTER_MS ?? 0);
const LABEL = process.env.LABEL ?? "current";
const SECONDS = Number(process.env.SECONDS ?? 4);
const PLAYERS = Number(process.env.PLAYERS ?? 8);
const proxy = await latencyProxy(BASE, { delayMs: ONE_WAY_MS, jitterMs: JITTER_MS, seed: 731, disconnectAfterMs: Number(process.env.DISCONNECT_MS ?? 0), bytesPerSec: Number(process.env.BYTES_PER_SEC ?? Infinity), blockSse: process.env.BLOCK_SSE === "1" });
const post = async (path, body) => {
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const data = await res.json();
  assert.ok(res.ok, `${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
};
const ids = Array.from({ length: PLAYERS }, () => randomUUID());
let code, browser;
const controllers = [];
const errors = [];
const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? Number(a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(3)) : null; };
try {
  ({ code } = await post("/api/game/create", { playerId: ids[0], name: "MotionProbe" }));
  for (let i = 1; i < ids.length; i++) await post("/api/game/join", { code, playerId: ids[i], name: `Probe${i}` });
  await post("/api/game/input", { code, playerId: ids.at(-1), action: "start" });
  for (const playerId of ids.slice(1)) {
    const ctl = new AbortController(); controllers.push(ctl);
    void fetch(`${BASE}/api/game/state/stream?code=${code}&playerId=${playerId}`, { signal: ctl.signal }).then(async (r) => {
      const reader = r.body.getReader();
      while (!ctl.signal.aborted) { if ((await reader.read()).done) break; }
    }).catch(() => {});
    await post("/api/game/input", { code, playerId, dir: 1 });
  }
  // Wrap the exact Renderer class used by main.ts. Coordinates are observed AFTER drawing.
  const renderPath = JSON.stringify(resolve("src/game/render/index.ts"));
  const mainPath = JSON.stringify(resolve("static-src/main.ts"));
  const artPath = JSON.stringify(resolve("src/game/svg-assets.ts"));
  const bundle = await build({ stdin: { contents: `
    import { Renderer } from ${renderPath};
    import { artReady } from ${artPath};
    import ${mainPath};
    const original = Renderer.prototype.render;
    Renderer.prototype.render = function(ctx,w,h,snap,display,t,dt) {
      const before = performance.now();
      const result = original.call(this,ctx,w,h,snap,display,t,dt);
      const probe = window.__motionProbe;
      if (probe) probe.ready = artReady();
      if (probe?.capture && artReady()) {
        const p = snap.players.find(p=>p.id===snap.self.id);
        if (p) probe.rows.push({t:performance.now(),server:snap.now,x:display.get(p.id)??p.x,expected:p.drawX??p.x,grid:p.x,pose:p.walkFrame??null,moving:p.moving,cam:this.cameraX,ms:performance.now()-before});
      }
      return result;
    };
  `, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife", target: "es2022", logLevel: "silent" });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.route("**/play/game.js", (route) => route.fulfill({ contentType: "application/javascript", body: bundle.outputFiles[0].text }));
  await page.addInitScript(({ pid }) => {
    localStorage.setItem("hc_pid", pid); localStorage.setItem("hc_name", "MotionProbe"); localStorage.setItem("hc_server", location.origin);
    window.__motionProbe = { capture: false, rows: [], arrivals: [], bytes: 0, keys: [] };
    const NativeES = window.EventSource;
    window.EventSource = class extends NativeES {
      constructor(url) {
        super(url);
        this.addEventListener("message", (e) => { const p = window.__motionProbe; if (p.capture) { p.arrivals.push(performance.now()); p.bytes += e.data.length; } });
      }
    };
    window.addEventListener("keydown", (e) => { if (e.code === "KeyD") window.__motionProbe.keys.push({ kind: "press", t: performance.now() }); }, true);
    window.addEventListener("keyup", (e) => { if (e.code === "KeyD") window.__motionProbe.keys.push({ kind: "release", t: performance.now() }); }, true);
  }, { pid: ids[0] });
  await page.goto(`${proxy.url}/play/?room=${code}&net=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("game")?.style.display === "block");
  await page.waitForFunction(() => window.__motionProbe?.ready === true);
  await page.waitForTimeout(1200 + ONE_WAY_MS * 2);
  const initialApiBytes = proxy.stats.apiBytes;
  await page.evaluate(() => { const p=window.__motionProbe; p.capture=true; p.rows=[]; });
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(SECONDS * 1000);
  await page.keyboard.up("KeyD");
  await page.waitForTimeout(ONE_WAY_MS * 2 + JITTER_MS * 2 + 500);
  const beforeReload = await page.evaluate(() => window.__motionProbe);
  const measuredApiBytes = proxy.stats.apiBytes - initialApiBytes;
  const modeText = await page.evaluate(() => document.getElementById("hc-net-debug")?.textContent ?? "");
  const state = await (await fetch(`${BASE}/api/game/state?code=${code}&playerId=${ids[0]}`)).json();
  const lastSeq = state.self.steerSeq;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.getElementById("game")?.style.display === "block");
  await page.waitForTimeout(500 + ONE_WAY_MS * 2);
  await page.evaluate(() => { window.__motionProbe.capture=true; });
  await page.keyboard.down("KeyD"); await page.waitForTimeout(650 + ONE_WAY_MS * 2); await page.keyboard.up("KeyD");
  await page.waitForTimeout(ONE_WAY_MS * 2 + 300);
  const reloaded = await page.evaluate(() => window.__motionProbe);
  const pressed = beforeReload.keys.find(k=>k.kind==="press").t;
  const released = beforeReload.keys.find(k=>k.kind==="release").t;
  const firstMoved = beforeReload.rows.find((r,i,a)=>r.t>=pressed && i>0 && r.x!==a[i-1].x);
  const firstStopped = beforeReload.rows.find(r=>r.t>=released && !r.moving);
  const steady = beforeReload.rows.filter(r=>r.t>pressed+Math.max(700,ONE_WAY_MS*3) && r.t<released-100 && r.moving);
  const dx = [], gaps = [], residuals = [];
  let frozenRun = 0, longestFrozenRunMs = 0;
  const changedPoses = steady.filter((r,i,a)=>i>0 && r.pose !== a[i-1].pose).length;
  for(let i=1;i<steady.length;i++) {
    const dt=steady[i].t-steady[i-1].t, step=steady[i].x-steady[i-1].x;
    dx.push(step); gaps.push(dt); residuals.push(step-190*dt/1000);
    frozenRun = step === 0 ? frozenRun + dt : 0; longestFrozenRunMs = Math.max(longestFrozenRunMs, frozenRun);
  }
  const arrivalGaps=beforeReload.arrivals.slice(1).map((t,i)=>t-beforeReload.arrivals[i]);
  const reloadXs = reloaded.rows.map(r=>r.x);
  const result = {
    label: LABEL, transport: modeText.split(" · ")[0], players: PLAYERS, rttMs: ONE_WAY_MS*2, jitterMs: JITTER_MS,
    drawnFrames: steady.length, gaitPoseChanges: changedPoses, inputToDrawMs: firstMoved ? +(firstMoved.t-pressed).toFixed(2):null,
    releaseToStoppedDrawMs: firstStopped ? +(firstStopped.t-released).toFixed(2):null,
    stepPx: {p05:pct(dx,.05),p50:pct(dx,.5),p95:pct(dx,.95)},
    speedErrorRmsPx: residuals.length ? +Math.sqrt(residuals.reduce((s,v)=>s+v*v,0)/residuals.length).toFixed(3):null,
    frozenDrawFrames: dx.filter(v=>v===0).length, longestFrozenRunMs: +longestFrozenRunMs.toFixed(2), backwardsDrawFrames: dx.filter(v=>v<0).length,
    renderGapMs:{p50:pct(gaps,.5),p95:pct(gaps,.95),max:pct(gaps,1)},
    drawCostMs:{p50:pct(steady.map(r=>r.ms),.5),p95:pct(steady.map(r=>r.ms),.95)},
    arrivalGapMs:{p50:pct(arrivalGaps,.5),p95:pct(arrivalGaps,.95),max:pct(arrivalGaps,1)},
    wireKBps:+(measuredApiBytes/1024/((beforeReload.rows.at(-1).t-beforeReload.rows[0].t)/1000)).toFixed(2),
    inventedCoordinates:beforeReload.rows.filter(r=>r.x!==r.expected).length,
    reloadMovePx:reloadXs.length ? +(Math.max(...reloadXs)-Math.min(...reloadXs)).toFixed(3):0,
    lastSeqBeforeReload:lastSeq??null, errors,
  };
  mkdirSync(".cache/motion",{recursive:true});
  writeFileSync(`.cache/motion/${LABEL}-${ONE_WAY_MS}-${JITTER_MS}.json`,JSON.stringify({result,rows:beforeReload.rows},null,2));
  console.log(JSON.stringify(result,null,2));
  assert.equal(result.inventedCoordinates,0,"every drawn coordinate must be server supplied");
  assert.deepEqual(errors,[],"no browser errors");
  if(process.env.REQUIRE_RELOAD==="1") assert.ok(result.reloadMovePx>25,"movement must work immediately after reload");
} finally {
  controllers.forEach(c=>c.abort());
  await browser?.close();
  if(code) for(const playerId of ids) await post("/api/game/leave",{code,playerId}).catch(()=>{});
  await proxy.close();
}
