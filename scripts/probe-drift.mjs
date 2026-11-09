// Temporal-glitch hunt: watches a live room for minutes and reports anything
// that only shows up over time — clock drift, backward jumps, position
// teleports, stale frames, sequence gaps, and memory growth.
// Usage: BASE=http://127.0.0.1:3100 SECONDS=60 node scripts/probe-drift.mjs
import { randomUUID } from "node:crypto";

const B = process.env.BASE ?? "http://127.0.0.1:3100";
const SECONDS = Number(process.env.SECONDS ?? 60);
const headers = { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 20}` };
const post = async (p, b) => (await fetch(`${B}${p}`, { method: "POST", headers, body: JSON.stringify(b) })).json();

const ids = Array.from({ length: 5 }, () => randomUUID());
const { code } = await post("/api/game/create", { playerId: ids[0], name: "DriftA" });
for (let i = 1; i < 5; i++) await post("/api/game/join", { code, playerId: ids[i], name: `Drift${i}` });
await post("/api/game/input", { code, playerId: ids[4], action: "start" });
const walker = ids[1];
// Each transport gets its own soul: the server keeps ONE viewer state per
// player, so two transports on one player would evict each other and resync.
const sseViewer = ids[0], pollViewer = ids[2];

let running = true;
const bot = (async () => { let k = 0; while (running) { k++; await post("/api/game/input", { code, playerId: walker, dir: Math.floor(k / 100) % 2 ? 1 : -1 }).catch(() => {}); await new Promise((r) => setTimeout(r, 90)); } })();

// Watch both transports at once: SSE for the push path, long-poll for the fallback.
const stats = {
  sse: { frames: 0, pos: 0, backward: 0, teleport: 0, nowOnly: 0, maxGap: 0, lastT: 0, lastX: new Map(), etags: new Set(), staleEtag: 0 },
  poll: { frames: 0, pos: 0, backward: 0, teleport: 0, maxGap: 0, lastT: 0, lastX: new Map(), etags: new Set(), staleEtag: 0 },
};
function watch(kind) {
  return {
    frame(f) {
      const s = stats[kind];
      const t = performance.now();
      if (s.lastT) s.maxGap = Math.max(s.maxGap, t - s.lastT);
      s.lastT = t;
      s.frames++;
      if (f.etag) { if (s.etags.has(f.etag)) s.staleEtag++; else s.etags.add(f.etag); }
      if (!f.patch?.players && !f.delta?.players && !f.snap) { s.nowOnly++; return; }
      const list = f.snap?.players ?? f.delta?.players;
      const next = new Map(s.lastX);
      if (list) for (const p of list) next.set(p.id, p.x);
      if (f.patch?.players) for (const part of f.patch.players) {
        const at = typeof part.i === "number" ? part.i : -1;
        if (at < 0 || at >= list.length) continue;
        if (part.x !== undefined) next.set(list[at].id, part.x);
      }
      const CULLED = -9999;
      for (const [id, x] of next) {
        const prev = s.lastX.get(id);
        if (prev === undefined || x === undefined) continue;
        if (prev === CULLED || x === CULLED) continue; // entering/leaving vision is culling, not motion
        const d = Math.abs(x - prev);
        if (d > 300) s.teleport++;
        else if (x < prev - 2) s.backward++;
      }
      s.lastX = next;
      if (f.patch?.players || f.delta?.players || f.snap) s.pos++;
    },
  };
}
const a = watch("sse"), b = watch("poll");
const ctl = new AbortController();
(async () => {
  const res = await fetch(`${B}/api/game/state/stream?code=${code}&playerId=${sseViewer}`, { signal: ctl.signal, headers });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf("\n\n")) >= 0) { const rec = buf.slice(0, i); buf = buf.slice(i + 2); if (rec.startsWith("data:")) a.frame(JSON.parse(rec.slice(5))); }
  }
})().catch(() => {});
(async () => {
  let rev = "";
  while (running) {
    try {
      const res = await fetch(`${B}/api/game/state?code=${code}&playerId=${pollViewer}&delta=1&wait=1${rev ? `&rev=${encodeURIComponent(rev)}` : ""}`, { headers });
      if (res.status === 304) continue;
      const f = await res.json();
      if (f.etag) rev = f.etag;
      b.frame(f);
    } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
})().catch(() => {});

const rss0 = process.memoryUsage().rss;
await new Promise((r) => setTimeout(r, SECONDS * 1000));
running = false; await bot; ctl.abort();
const rss1 = process.memoryUsage().rss;
for (const kind of ["sse", "poll"]) {
  const s = stats[kind];
  console.log(`${kind.toUpperCase()}: ${s.frames} frames (${(s.frames / SECONDS).toFixed(1)}/s), ${s.pos} with positions (${(s.pos / SECONDS).toFixed(1)}/s)`);
  console.log(`   bare ticks ${s.nowOnly} · max frame gap ${s.maxGap.toFixed(0)} ms · distinct etags ${s.etags.size} · repeated etags ${s.staleEtag}`);
  console.log(`   backward jumps ${s.backward} · teleports >300px ${s.teleport}`);
}
console.log(`probe rss ${(rss1 / 1e6).toFixed(1)} MB (delta ${((rss1 - rss0) / 1e6).toFixed(1)} MB)`);
process.exit(0);
