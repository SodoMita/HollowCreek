// Load smoke: a town of N souls, all behind ONE forwarded address (a NAT, a
// household or a school), each long-polling state and sending input like a
// real client. Reports status codes, latency percentiles and bytes received.
// Passes only when no soul is throttled (no 429) and every poll is answered.
//   BASE=http://127.0.0.1:3100 PLAYERS=8 SECONDS=15 node scripts/smoke-load.mjs
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const PLAYERS = Number(process.env.PLAYERS ?? 8);
const SECONDS = Number(process.env.SECONDS ?? 15);
const IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`; // one shared address for every soul
const headers = { "content-type": "application/json", "x-forwarded-for": IP };

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

// The client mints its own playerId and the server adopts it (create returns only the code).
const hostId = randomUUID();
const created = await post("/api/game/create", { playerId: hostId, name: "Host" });
if (!created.data.code) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.data)}`);
const code = created.data.code;
const souls = [{ id: hostId, name: "Host" }];
for (let i = 1; i < PLAYERS; i++) {
  const id = randomUUID();
  const joined = await post("/api/game/join", { code, playerId: id, name: `Soul${i}` });
  if (joined.status !== 200 && joined.status !== 201) throw new Error(`join ${i} failed: ${joined.status}`);
  souls.push({ id, name: `Soul${i}` });
}

await post("/api/game/input", { code, playerId: hostId, action: "start" }); // start the match so souls walk and the state churns

const stats = { polls: 0, polls429: 0, polls304: 0, polls5xx: 0, inputs: 0, inputs429: 0, inputs5xx: 0, bytes: 0 };
const latencies = [];
const deadline = Date.now() + SECONDS * 1000;

async function pollLoop(soul) {
  let etag = "";
  while (Date.now() < deadline) {
    const t0 = performance.now();
    const url = `${BASE}/api/game/state?code=${code}&playerId=${encodeURIComponent(soul.id)}&delta=1&wait=1${etag ? `&rev=${encodeURIComponent(etag)}` : ""}`;
    try {
      const res = await fetch(url, { headers: { "x-forwarded-for": IP } });
      const text = await res.text();
      latencies.push(performance.now() - t0);
      stats.polls++;
      stats.bytes += text.length;
      if (res.status === 429) { stats.polls429++; await new Promise((r) => setTimeout(r, 300)); } // back off like the client
      else if (res.status === 304) stats.polls304++;
      else if (res.status >= 500) stats.polls5xx++;
      etag = res.headers.get("etag") || etag;
    } catch {
      stats.polls5xx++;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function inputLoop(soul, offset) {
  let tick = offset;
  while (Date.now() < deadline) {
    tick++;
    const dir = Math.floor(tick / 15) % 2 === 0 ? 1 : -1; // walk one way, then the other
    const res = await post("/api/game/input", { code, playerId: soul.id, dir });
    stats.inputs++;
    if (res.status === 429) { stats.inputs429++; await new Promise((r) => setTimeout(r, 300)); }
    else if (res.status >= 500) stats.inputs5xx++;
    await new Promise((r) => setTimeout(r, 100)); // ~10 Hz, the real client's rate
  }
}

await Promise.all(souls.flatMap((soul, i) => [pollLoop(soul), inputLoop(soul, i)]));
latencies.sort((a, b) => a - b);
const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : 0);
const summary = {
  base: BASE, code, souls: souls.length, seconds: SECONDS, sharedAddress: IP,
  polls: stats.polls, polls304: stats.polls304, polls429: stats.polls429, polls5xx: stats.polls5xx,
  p50ms: Math.round(pct(0.5)), p95ms: Math.round(pct(0.95)), p99ms: Math.round(pct(0.99)),
  inputs: stats.inputs, inputs429: stats.inputs429, inputs5xx: stats.inputs5xx,
  kbPerSoulPerSec: Number((stats.bytes / 1024 / souls.length / SECONDS).toFixed(2)),
};
console.log(JSON.stringify(summary));
const throttled = stats.polls429 + stats.inputs429;
const failed = stats.polls5xx + stats.inputs5xx;
if (throttled || failed) {
  console.error(`LOAD_FAIL: ${throttled} throttled, ${failed} server errors`);
  process.exit(1);
}
console.log(`LOAD_OK: ${souls.length} souls on one address, ${stats.polls} polls + ${stats.inputs} inputs, none throttled`);
