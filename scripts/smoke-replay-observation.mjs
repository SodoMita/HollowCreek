// Live check that an observer sees who takes a historical item at the right moment.
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = async (path, body) => {
  const response = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: response.status, data: await response.json() };
};
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
let code;
const send = (id, intent) => request("/api/game/input", { code, playerId: id, ...intent });
const state = async (id) => (await request(`/api/game/state?code=${code}&playerId=${id}`)).data;
async function walk(id, target) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    const s = await state(id), x = s.players.find((p) => p.id === id).x;
    if (Math.abs(x - target) < 18) { await send(id, { dir: 0 }); return; }
    await send(id, { dir: x < target ? 1 : -1 }); await sleep(120);
  }
  throw new Error(`could not reach ${target}`);
}
try {
  code = (await request("/api/game/create", { playerId: ids[0], name: "WatchA" })).data.code;
  for (let i = 1; i < 4; i++) assert.ok((await request("/api/game/join", { code, playerId: ids[i], name: `Watch${i}` })).data.ok);
  assert.ok((await send(ids[3], { action: "start" })).data.ok);
  const began = Date.now(), initial = await Promise.all(ids.map((id) => state(id)));
  const people = ids.map((id, i) => ({ id, role: initial[i].self.role, x: initial[i].players.find((p) => p.id === id).x }));
  const watcher = people.filter((p) => p.role === "crew").sort((a, b) => Math.abs(a.x - 1260) - Math.abs(b.x - 1260))[0].id;
  const actor = people.filter((p) => p.id !== watcher).sort((a, b) => Math.abs(a.x + 190) - Math.abs(b.x + 190))[0].id;
  await Promise.all([walk(watcher, 1260), walk(actor, -190)]);
  await sleep(Math.max(0, 12000 - (Date.now() - began)));
  assert.ok((await send(actor, { action: "interact" })).data.ok);
  const pickupAt = Date.now();
  assert.ok((await state(actor)).self.doorKeys.includes("tollhouse"));
  await sleep(650);
  assert.ok((await send(watcher, { action: "interact" })).data.ok);
  const range = (await state(watcher)).time;
  assert.ok((await send(watcher, { action: "time_travel", targetAt: range.earliest })).data.ok);
  await walk(watcher, -190);
  let view = await state(watcher), end = Date.now() + 30000;
  while (view.time?.mode === "past" && view.time.cursor < pickupAt + 150 && Date.now() < end) { await sleep(180); view = await state(watcher); }
  assert.equal(view.time.mode, "past");
  const echo = view.players.find((p) => p.id === `echo:${actor}`);
  assert.ok(echo?.action?.text.includes("took the brass tollhouse key"), "pickup notice is attached to the historical actor");
  assert.ok(echo.doorKeys.includes("tollhouse"), "historical actor visibly carries the key");
  assert.ok(view.feed.some((item) => item.text.includes(`${echo.name} took the brass tollhouse key`)), "historical feed names the actor and item");
  assert.equal(view.doors.find((door) => door.id === "tollhouse").keyX, null);
  console.log("PASS the recorded pickup visibly names the actor, shows the held key, and removes it from the ground");
  await send(watcher, { action: "time_return" });
} finally {
  if (code) await Promise.all(ids.map((id) => send(id, { dir: 0 }).catch(() => {})));
}
