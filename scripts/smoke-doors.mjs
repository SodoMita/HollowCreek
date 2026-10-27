// Real HTTP multiplayer regression: matching keys, seamless entry/exit and safe drops.
// Usage: node scripts/smoke-doors.mjs [baseUrl]
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
const request = async (path, body) => {
  const response = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: response.status, data: await response.json() };
};
let code;
const send = (id, intent) => request("/api/game/input", { code, playerId: id, ...intent });
const state = async (id) => (await request(`/api/game/state?code=${code}&playerId=${id}`)).data;
const pos = (s, id) => s.players.find((p) => p.id === id);
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log(`PASS ${message}`); }
async function walk(id, target, tolerance = 16, timeout = 45000) {
  const end = Date.now() + timeout;
  let previous;
  while (Date.now() < end) {
    const s = await state(id), p = pos(s, id);
    if (previous !== undefined) assert.ok(Math.abs(p.x - previous) < 80, "movement remains continuous");
    previous = p.x;
    if (Math.abs(p.x - target) <= tolerance) { await send(id, { dir: 0 }); return p; }
    await send(id, { dir: p.x < target ? 1 : -1 });
    await sleep(110);
  }
  throw new Error(`Could not walk to ${target}`);
}
try {
  code = (await request("/api/game/create", { playerId: ids[0], name: "DoorA" })).data.code;
  for (let i = 1; i < ids.length; i++) ok((await request("/api/game/join", { code, playerId: ids[i], name: `Door${i}` })).data.ok, "player joined");
  ok((await send(ids[3], { action: "start" })).data.ok, "night started");
  const initial = await Promise.all(ids.map((id) => state(id)));
  const ordered = ids.map((id, i) => ({ id, x: pos(initial[i], id).x })).sort((a, b) => a.x - b.x);
  const [holder, guest] = ordered.map((item) => item.id);
  // Tollhouse: key at -190, side threshold at -338. Both walk there normally.
  await Promise.all([walk(holder, -190), walk(guest, -300)]);
  ok((await send(guest, { action: "interact" })).status === 400, "a keyless player cannot open the locked door");
  ok((await send(holder, { action: "interact" })).data.ok, "the matching key can be picked up");
  ok((await state(holder)).self.doorKeys.includes("tollhouse"), "inventory identifies the particular house key");
  await walk(holder, -290);
  ok((await send(holder, { action: "interact" })).data.ok, "matching key opens the door");
  ok((await state(holder)).doors.find((d) => d.id === "tollhouse").open, "door is open for other players");
  const enter = await walk(holder, -385);
  ok(enter.inside === "tollhouse", "holder walks into the house without teleporting");
  const guestIn = await walk(guest, -365);
  ok(guestIn.inside === "tollhouse", "another player walks through the same open door");
  const leave = await walk(holder, -300);
  ok(leave.inside === null, "holder walks back outside through the threshold");
  ok((await send(holder, { action: "door_lock" })).data.ok, "owner can lock the door from outside");
  ok((await state(guest)).doors.find((d) => d.id === "tollhouse").locked, "lock state is shared");
  ok((await send(guest, { action: "interact" })).data.ok, "occupant can release the latch to escape");
  ok((await walk(guest, -300)).inside === null, "occupant walks out after opening the door");
  await request("/api/game/leave", { code, playerId: holder });
  const dropped = (await state(guest)).doors.find((d) => d.id === "tollhouse");
  ok(dropped.holder === null && dropped.keyX !== null, "leaving drops the house key for other players");
  console.log(`\n${checks} DOOR CHECKS PASSED`);
} catch (error) {
  console.error("DOOR SMOKE FAILED", error);
  process.exitCode = 1;
} finally {
  if (code) await Promise.all(ids.map((id) => send(id, { dir: 0 }).catch(() => {})));
}
