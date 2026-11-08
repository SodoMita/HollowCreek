// Performance and reliability probe for the authoritative state path.
// Usage: node scripts/perf-state.mjs [baseUrl] [players] [polls]
// Exits non-zero when the state endpoint misses its latency budget, returns
// 429/5xx under a ten-client poll storm, or a player cannot move.
const B = process.argv[2] ?? "http://127.0.0.1:3100";
const PLAYERS = Math.max(4, Math.min(10, Number(process.argv[3] ?? 8)));
const POLLS = Math.max(50, Number(process.argv[4] ?? 240));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = Array.from({ length: PLAYERS }, () => crypto.randomUUID());
const json = async (path, body) => {
  const res = await fetch(B + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const text = await res.text();
  return { status: res.status, bytes: Buffer.byteLength(text), data: text ? JSON.parse(text) : null, headers: res.headers };
};
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { min: Math.round(sorted[0]), p50: Math.round(pct(sorted, 50)), p95: Math.round(pct(sorted, 95)), max: Math.round(sorted[sorted.length - 1]), mean: Math.round(sum / sorted.length) };
};
let failures = 0;
const fail = (message) => { failures++; console.error(`FAIL ${message}`); };

const created = await json("/api/game/create", { playerId: ids[0], name: "Bench-0" });
if (!created.data?.code) { console.error("cannot create a town", created); process.exit(1); }
const code = created.data.code;
for (let i = 1; i < ids.length; i++) {
  const joined = await json("/api/game/join", { code, playerId: ids[i], name: `Bench-${i}` });
  if (!joined.data?.ok) fail(`join ${i} (${joined.status}) ${JSON.stringify(joined.data)}`);
}
const started = await json("/api/game/input", { code, playerId: ids[ids.length - 1], action: "start" });
if (!started.data?.ok) fail(`start (${started.status})`);

const health = await json("/api/health");
console.log(`health ${health.status} · ${health.bytes} B · town ${code} · ${PLAYERS} souls`);

// Sequential warmed polls: latency + payload + conditional-GET behaviour.
const latencies = [], payloads = [];
let notModified = 0, etag = "";
for (let i = 0; i < POLLS; i++) {
  const query = `/api/game/state?code=${code}&playerId=${ids[0]}${i % 3 === 0 && etag ? `&rev=${encodeURIComponent(etag)}` : ""}`;
  const t = performance.now();
  const res = await json(query);
  latencies.push(performance.now() - t);
  if (res.status === 304) { notModified++; continue; }
  if (res.status !== 200) fail(`state ${res.status}`);
  payloads.push(res.bytes);
  etag = res.headers.get("etag") ?? "";
}
const seq = stats(latencies);
const payload = stats(payloads.length ? payloads : [0]);
console.log(`sequential state: ${POLLS} polls · p50 ${seq.p50} ms · p95 ${seq.p95} ms · max ${seq.max} ms`);
console.log(`snapshot payload: mean ${payload.mean} B · max ${payload.max} B · unchanged/304 ${notModified}/${POLLS}`);
if (seq.p95 > 250) fail(`state p95 ${seq.p95} ms over the 250 ms budget`);
if (notModified === 0) fail("conditional GET never answered 304");
if (payload.mean > 48_000) fail(`snapshot payload ${payload.mean} B is too heavy for a 100 ms poll`);

// Ten clients polling at 100 ms for four seconds — the production presence load.
const storm = { requests: 0, errors: 0, throttled: 0, latencies: [] };
const end = Date.now() + 4000;
await Promise.all(ids.map(async (playerId) => {
  while (Date.now() < end) {
    const t = performance.now();
    try {
      const res = await fetch(`${B}/api/game/state?code=${code}&playerId=${playerId}`);
      await res.arrayBuffer();
      storm.requests++;
      storm.latencies.push(performance.now() - t);
      if (res.status === 429) storm.throttled++;
      else if (res.status >= 500) storm.errors++;
    } catch { storm.errors++; }
    await sleep(100);
  }
}));
const load = stats(storm.latencies);
console.log(`poll storm: ${storm.requests} requests in 4 s (${(storm.requests / 4).toFixed(1)}/s) · p50 ${load.p50} ms · p95 ${load.p95} ms · 429 ${storm.throttled} · 5xx ${storm.errors}`);
if (storm.throttled || storm.errors) fail(`poll storm throttled ${storm.throttled} and errored ${storm.errors}`);
if (load.p95 > 400) fail(`poll storm p95 ${load.p95} ms over the 400 ms budget`);

// A whole lobby moving at once: every input must land without a 429.
const inputLatencies = [];
let inputFailures = 0;
for (let round = 0; round < 40; round++) {
  await Promise.all(ids.map(async (playerId, i) => {
    const t = performance.now();
    const res = await fetch(`${B}/api/game/input`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, playerId, dir: round % 2 === 0 ? (i % 2 === 0 ? 1 : -1) : 0 }) });
    await res.arrayBuffer();
    inputLatencies.push(performance.now() - t);
    if (res.status !== 200) inputFailures++;
  }));
}
const input = stats(inputLatencies);
console.log(`input: ${inputLatencies.length} requests · p50 ${input.p50} ms · p95 ${input.p95} ms · non-200 ${inputFailures}`);
if (inputFailures) fail(`${inputFailures} input requests were refused (rate limit or validation)`);
if (input.p95 > 300) fail(`input p95 ${input.p95} ms over the 300 ms budget`);

console.log(failures ? `\n${failures} PERFORMANCE BUDGET MISSED` : "\nPERFORMANCE OK: state, poll storm and input stay inside their budgets");
process.exit(failures ? 1 : 0);
