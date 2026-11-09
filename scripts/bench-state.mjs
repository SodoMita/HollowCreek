// Server throughput for the state route: a town of N souls, then C concurrent
// viewers hammering non-blocking snapshots (wait=0) for a few seconds.
// Reports requests/sec and latency percentiles — the number that scales badly if
// every request re-hashes and re-encodes the whole snapshot.
//   BASE=http://127.0.0.1:3100 SOULS=8 CLIENTS=8 SECONDS=4 node scripts/bench-state.mjs
import { randomUUID } from "node:crypto";
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const SOULS = Number(process.env.SOULS ?? 8);
const CLIENTS = Number(process.env.CLIENTS ?? 8);
const SECONDS = Number(process.env.SECONDS ?? 4);
const DELTA = process.env.DELTA === "1"; // exercise the delta/fingerprint path the clients use
const ip = `203.0.113.${Math.floor(Math.random() * 100) + 100}`;
const post = async (path, body) => (await fetch(`${BASE}${path}`, {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body),
})).json().catch(() => ({}));

const creator = randomUUID();
const code = (await post("/api/game/create", { playerId: creator, name: "Host" })).code;
const souls = [creator];
for (let i = 1; i < SOULS; i++) souls.push(randomUUID());
for (const id of souls.slice(1)) await post("/api/game/join", { code, playerId: id, name: `S${souls.indexOf(id)}` });
await post("/api/game/input", { code, playerId: souls[souls.length - 1], action: "start" });
await new Promise((r) => setTimeout(r, 300));

const latencies = [];
let ok = 0, failed = 0, bytes = 0;
const deadline = Date.now() + SECONDS * 1000;
async function client(id) {
  while (Date.now() < deadline) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}/api/game/state?code=${code}&playerId=${id}${DELTA ? "&delta=1" : ""}`, { headers: { "x-forwarded-for": ip } });
      const text = await res.text();
      latencies.push(performance.now() - t0);
      bytes += text.length;
      if (res.ok) ok++; else failed++;
    } catch { failed++; }
  }
}
await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(souls[i % souls.length])));
latencies.sort((a, b) => a - b);
const pct = (p) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0);
console.log(JSON.stringify({
  souls: SOULS, clients: CLIENTS, seconds: SECONDS, path: DELTA ? "delta" : "snapshot",
  requests: ok + failed, requestsPerSecond: +((ok + failed) / SECONDS).toFixed(1), failed,
  p50ms: pct(0.5), p95ms: pct(0.95), p99ms: pct(0.99),
  kbPerSecond: +((bytes / 1024) / SECONDS).toFixed(1),
  bytesPerSnapshot: Math.round(bytes / Math.max(1, ok)),
}, null, 1));
