// End-to-end check of the delta protocol (src/game/wire.ts): follow a live SSE
// stream, merge every frame with applyFrame, and assert that the merged state
// fingerprints to the server's etag — i.e. the client holds exactly what a
// full snapshot would give. Also exercises the long-poll delta path.
//   BASE=http://127.0.0.1:3000 node scripts/test-wire.mjs
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const load = async (file) => {
  const out = await build({ entryPoints: [resolve(repo, file)], bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const { applyFrame, snapshotFingerprint } = await load("src/game/wire.ts");
// The server fingerprints the encoded view (not a second JSON pass of the snapshot),
// so the test asks the same encoder what the merged state would hash to.
const etagOf = (snap) => snapshotFingerprint(snap);

const post = (path, body) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const ids = ["w-a", "w-b", "w-c", "w-d"];
const { code } = await post("/api/game/create", { playerId: ids[0], name: "Wire" });
for (const id of ids.slice(1)) await post("/api/game/join", { playerId: id, name: id, code });
assert.equal((await post("/api/game/input", { playerId: ids[3], code, action: "start" })).ok, true, "game starts");

// Everyone walks so every viewer sees at least itself moving; one chats; one works later.
for (const id of ids) await post("/api/game/input", { playerId: id, code, dir: 1 });
setTimeout(() => void post("/api/game/input", { playerId: ids[1], code, chat: "Who rang the bell?" }), 1200);
setTimeout(() => void post("/api/game/input", { playerId: ids[0], code, dir: -1 }), 2000);
setTimeout(() => void post("/api/game/input", { playerId: ids[2], code, dir: 0 }), 2600);

// --- SSE path ---
const ctl = new AbortController();
const res = await fetch(`${BASE}/api/game/state/stream?code=${code}&playerId=${ids[0]}`, { signal: ctl.signal });
assert.equal(res.status, 200);
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "", held = null, frames = 0, bytes = 0, checks = 0, full = 0;
const started = Date.now();
while (Date.now() - started < 4500) {
  const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 300))]);
  if (done) break;
  if (!value) continue;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
    if (!chunk.startsWith("data:")) continue;
    const frame = JSON.parse(chunk.slice(5));
    frames++; bytes += chunk.length;
    if (frame.snap) full++;
    held = applyFrame(held, frame);
    assert.ok(held, "a full frame arrives before any delta");
    if (frame.etag) { assert.equal(etagOf(held), frame.etag, `merged state matches the server etag (frame ${frames})`); checks++; }
  }
}
ctl.abort();
assert.ok(frames >= 20, `walking viewer received a stream of frames (${frames})`);
assert.equal(full, 1, "exactly one full snapshot on the stream");
console.log(`PASS SSE: ${frames} frames, ${bytes} bytes in 4.5 s, ${checks} etag checks all equal (1 full + ${frames - 1} deltas)`);

// --- long-poll delta path ---
let rev = "", lp = null, reqs = 0, lpBytes = 0, lpFull = 0;
const t0 = Date.now();
while (Date.now() - t0 < 3000) {
  const r = await fetch(`${BASE}/api/game/state?code=${code}&playerId=${ids[1]}&delta=1&wait=1${rev ? `&rev=${encodeURIComponent(rev)}` : ""}`);
  reqs++;
  if (r.status === 304) continue;
  assert.equal(r.status, 200);
  const frame = await r.json();
  lpBytes += JSON.stringify(frame).length;
  if (frame.snap) lpFull++;
  lp = applyFrame(lp, frame);
  assert.ok(lp, "long-poll: a full frame arrives first");
  assert.equal(etagOf(lp), frame.etag, "long-poll: merged state matches the server etag");
  rev = frame.etag;
}
assert.equal(lpFull, 1, "long-poll: one full snapshot, then deltas");
console.log(`PASS long-poll: ${reqs} requests, ${lpBytes} bytes in 3 s, state always equal to the server's`);
for (const id of ids) await post("/api/game/leave", { playerId: id, code });
