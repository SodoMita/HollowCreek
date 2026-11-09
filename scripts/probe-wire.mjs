// Wire probe: measure how often a viewer actually receives position updates
// for a walking neighbour, in the playing phase and during the bell/meeting.
// Usage: BASE=http://127.0.0.1:3100 node scripts/probe-wire.mjs
import { randomUUID } from "node:crypto";

const B = process.env.BASE ?? "http://127.0.0.1:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
const headers = { "content-type": "application/json", "x-forwarded-for": ip };
async function request(method, path, data) {
  const res = await fetch(`${B}${path}`, data ? { method, headers, body: JSON.stringify(data) } : { method, headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const ids = Array.from({ length: 4 }, () => randomUUID());
const { body: created } = await request("POST", "/api/game/create", { playerId: ids[0], name: "ProbeA" });
const code = created.code;
for (let i = 1; i < ids.length; i++) await request("POST", "/api/game/join", { code, playerId: ids[i], name: `Probe${i + 1}` });
const send = (id, intent) => request("POST", "/api/game/input", { code, playerId: id, ...intent });
const state = async (id) => (await request("GET", `/api/game/state?code=${code}&playerId=${id}`)).body;
const pos = async (id) => (await state(id)).players.find((p) => p.id === id).x;

await send(ids[3], { action: "start" });
const roles = await Promise.all(ids.map(async (id) => (await state(id)).self.role));
const hollow = ids[roles.indexOf("hollow")];
const crew = ids.filter((id) => id !== hollow);
const viewer = crew[1];
const walker = crew[2];

// ---- SSE listener for the viewer -------------------------------------------
const frames = []; // {t, kind, walkerX?, bytes}
let phaseAt = { meeting: 0 };
let heldPlayers = [];

const ctl = new AbortController();
(async () => {
  const res = await fetch(`${B}/api/game/state/stream?code=${code}&playerId=${viewer}`, { signal: ctl.signal, headers });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      if (!chunk.startsWith("data:")) continue;
      const json = chunk.slice(5).trim();
      const f = JSON.parse(json);
      const t = performance.now();
      // Merge the frame into a local mirror of the players array, then read the
      // walker's position from the slot it occupies. Patches are addressed by
      // roster index (`i`); a full or list frame replaces the array.
      if (f.snap) heldPlayers = f.snap.players.slice();
      else if (f.delta?.players) heldPlayers = f.delta.players.slice();
      else if (f.patch?.players) {
        for (const part of f.patch.players) {
          const at = typeof part.i === "number" ? part.i : heldPlayers.findIndex((p) => p.id === part.id);
          if (at >= 0 && at < heldPlayers.length) heldPlayers[at] = { ...heldPlayers[at], ...part };
        }
      }
      const walkerX = heldPlayers.find((p) => p.id === walker)?.x;
      const phase = f.snap?.phase ?? f.delta?.phase;
      if (phase === "meeting" && !phaseAt.meeting) phaseAt.meeting = t;
      frames.push({ t, kind: f.snap ? "snap" : (f.delta || f.patch) ? "delta" : "tick", walkerX, bytes: json.length, keys: Object.keys(f.delta ?? {}).concat(Object.keys(f.patch ?? {}).map((k) => "patch." + k)) });
    }
  }
})().catch(() => {});

function report(label, from, to) {
  const fs = frames.filter((f) => f.t >= from && f.t < to);
  const pf = fs.filter((f) => f.walkerX !== undefined);
  const dur = (to - from) / 1000;
  const gaps = [];
  for (let i = 1; i < pf.length; i++) gaps.push(pf[i].t - pf[i - 1].t);
  gaps.sort((a, b) => a - b);
  const p = (q) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))].toFixed(0) : "-";
  const bytes = fs.reduce((a, f) => a + f.bytes, 0);
  console.log(`${label}: ${dur.toFixed(1)}s, frames ${fs.length} (${(fs.length / dur).toFixed(1)}/s), walker-pos frames ${pf.length} (${(pf.length / dur).toFixed(1)}/s), gap p50 ${p(0.5)} p90 ${p(0.9)} max ${p(0.999)} ms, ${(bytes / dur).toFixed(0)} B/s`);
  const keyCount = {};
  for (const f of fs) for (const k of f.keys) keyCount[k] = (keyCount[k] ?? 0) + 1;
  console.log("   keys:", JSON.stringify(keyCount));
}

// ---- playing phase: walker walks back and forth near the viewer --------------
await sleep(500);
// Bring everyone to the bell first (needed for the meeting later), measuring on the way.
const t0 = performance.now();
for (const id of ids) await send(id, { dir: (await pos(id)) < 2200 ? 1 : -1 });
const pending = new Set(ids);
const until = Date.now() + 40000;
while (pending.size && Date.now() < until) {
  for (const id of pending) {
    if (Math.abs((await pos(id)) - 2200) < 38) { await send(id, { dir: 0 }); pending.delete(id); }
  }
  await sleep(200);
}
const t1 = performance.now();
report("walk-to-square (playing)", t0, t1);
// Walker paces near the viewer for 4 s.
let dir = 1;
const paceUntil = performance.now() + 4000;
const t2 = performance.now();
while (performance.now() < paceUntil) { await send(walker, { dir }); dir = -dir; await sleep(700); }
await send(walker, { dir: 0 });
report("pacing (playing)", t2, performance.now());

// ---- meeting ----------------------------------------------------------------
const rang = await send(crew[0], { action: "ability" });
console.log("bell:", rang.body);
const t3 = performance.now();
dir = 1;
const meetUntil = performance.now() + 6000;
while (performance.now() < meetUntil) { await send(walker, { dir }); dir = -dir; await sleep(700); }
await send(walker, { dir: 0 });
const t4 = performance.now();
report("pacing (meeting)", t3, t4);
const meetingFrames = frames.filter((f) => f.t >= t3 && f.t < t4);
console.log("first 12 meeting frames:", meetingFrames.slice(0, 12).map((f) => `${(f.t - t3).toFixed(0)}ms ${f.kind} x=${f.walkerX} [${f.keys.join(",")}]`).join("\n  "));
ctl.abort();
process.exit(0);
