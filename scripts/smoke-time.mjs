// Live authoritative time-travel regression. Usage: node scripts/smoke-time.mjs [baseUrl]
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const request = async (path, body) => {
  const response = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  return { status: response.status, data: await response.json() };
};
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log(`PASS ${message}`); }
async function room(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const created = await request("/api/game/create", { playerId: ids[0], name: `${prefix}A` });
  const code = created.data.code;
  for (let i = 1; i < 4; i++) assert.ok((await request("/api/game/join", { code, playerId: ids[i], name: `${prefix}${i}` })).data.ok);
  const send = (id, intent) => request("/api/game/input", { code, playerId: id, ...intent });
  const state = async (id) => (await request(`/api/game/state?code=${code}&playerId=${id}`)).data;
  assert.ok((await send(ids[3], { action: "start" })).data.ok);
  const initial = await Promise.all(ids.map((id) => state(id)));
  const people = ids.map((id, i) => ({ id, role: initial[i].self.role, x: initial[i].players.find((p) => p.id === id).x }));
  return { code, ids, send, state, people, began: Date.now() };
}
async function walk(game, id, target, tolerance = 18, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await game.state(id), p = s.players.find((item) => item.id === id);
    if (!p) throw new Error("traveler absent from own snapshot");
    if (Math.abs(p.x - target) <= tolerance) { await game.send(id, { dir: 0 }); return s; }
    await game.send(id, { dir: p.x < target ? 1 : -1 });
    await sleep(120);
  }
  throw new Error(`Could not reach ${target}`);
}
async function takeTimepiece(game, id) {
  await walk(game, id, 1260);
  ok((await game.send(id, { action: "interact" })).data.ok, "timepiece can be picked up");
  const s = await game.state(id);
  ok(s.self.hasTimepiece && s.time.mode === "present", "holder sees the available history");
  return s.time;
}
async function travel(game, id, target) {
  const result = await game.send(id, { action: "time_travel", targetAt: target });
  ok(result.data.ok, `travel accepted${result.data.error ? `: ${result.data.error}` : ""}`);
  const s = await game.state(id);
  ok(s.time.mode === "past" && !s.self.hasTimepiece, "item consumed and traveler enters the past");
  ok(s.time.endsAt - s.now <= 60000 && s.time.endsAt - s.now > 55000, "visit has a one-minute server deadline");
  ok(s.players.every((p) => p.id === id || p.echo), "other visible people are historical echoes");
  ok(!s.players.some((p) => "role" in p), "echo snapshots do not expose roles");
  return s;
}
const games = [];
try {
  // A key picked up in the original future is taken earlier by the traveler.
  const a = await room("TimeK"); games.push(a);
  const traveler = a.people.filter((p) => p.role === "crew").sort((x, y) => Math.abs(x.x - 1260) - Math.abs(y.x - 1260))[0].id;
  const guest = a.people.find((p) => p.id !== traveler).id;
  const voicePeer = a.people.find((p) => p.id !== traveler && p.id !== guest).id;
  await Promise.all([walk(a, traveler, 1260), walk(a, guest, -190), walk(a, voicePeer, 1260)]);
  const window = await takeTimepiece(a, traveler);
  const invalid = await a.send(traveler, { action: "time_travel", targetAt: Date.now() + 60000 });
  ok(invalid.status === 400 && (await a.state(traveler)).self.hasTimepiece, "invalid time cannot consume the item");
  await sleep(Math.max(0, 10500 - (Date.now() - a.began)));
  const voiceA = (await request("/api/game/voice", { code: a.code, playerId: traveler, action: "join" })).data;
  const voiceB = (await request("/api/game/voice", { code: a.code, playerId: voicePeer, action: "join" })).data;
  const voiceState = async (id, session) => (await request(`/api/game/voice?code=${a.code}&playerId=${id}&session=${session}`)).data;
  ok((await voiceState(traveler, voiceA.session)).peers.some((peer) => peer.id === voicePeer), "nearby players can hear each other before travel");
  await travel(a, traveler, window.earliest);
  ok(!(await voiceState(traveler, voiceA.session)).peers.some((peer) => peer.id === voicePeer) && !(await voiceState(voicePeer, voiceB.session)).peers.some((peer) => peer.id === traveler), "past and present voice are isolated");
  ok((await a.send(guest, { action: "interact" })).data.ok, "another player takes the key in the present");
  ok((await a.state(guest)).self.doorKeys.includes("tollhouse"), "present player initially owns the key");
  await walk(a, traveler, -190);
  ok((await a.send(traveler, { action: "interact" })).data.ok, "traveler takes the key at the earlier moment");
  ok(!(await a.state(guest)).self.doorKeys.includes("tollhouse"), "later holder loses the stolen unique key");
  ok((await a.state(traveler)).self.doorKeys.includes("tollhouse"), "traveler holds the historical key");
  ok((await a.send(traveler, { action: "time_return" })).data.ok, "traveler can return early");
  const returned = await a.state(traveler);
  ok(returned.time.mode === "present" && returned.self.doorKeys.includes("tollhouse") && !returned.self.hasTimepiece, "key returns to present and the timepiece remains consumed");
  ok((await a.send(traveler, { action: "time_travel", targetAt: window.earliest })).status === 400, "timepiece cannot be reused");
  ok((await a.state(voicePeer)).timepieceX !== null, "a second single-use timepiece appears after the first visit");
  ok((await a.send(voicePeer, { action: "interact" })).data.ok && (await a.state(voicePeer)).self.hasTimepiece, "another player can take the second timepiece");
  await walk(a, voicePeer, 900);
  const secondRange = (await a.state(voicePeer)).time;
  await travel(a, voicePeer, secondRange.earliest);
  await walk(a, voicePeer, -190);
  ok((await a.send(voicePeer, { action: "interact" })).data.ok, "the later traveler takes the key earlier in history");
  ok(!(await a.state(traveler)).self.doorKeys.includes("tollhouse"), "the previous traveler in the present loses the key after replay");
  ok((await a.state(voicePeer)).self.doorKeys.includes("tollhouse"), "the later traveler has the unique key");
  await a.send(voicePeer, { action: "time_return" });

  // A townsperson completes a past task; the present shared pool changes immediately.
  const b = await room("TimeR"); games.push(b);
  const worker = b.people.filter((p) => p.role === "crew").sort((x, y) => Math.abs(x.x - 1260) - Math.abs(y.x - 1260))[0].id;
  const observer = b.people.find((p) => p.id !== worker).id;
  const range = await takeTimepiece(b, worker);
  await travel(b, worker, range.earliest);
  await walk(b, worker, 900);
  ok((await b.send(worker, { action: "interact" })).data.ok && (await b.state(worker)).self.hasSupply, "traveler can take a repair kit from the past cart");
  await walk(b, worker, 680);
  ok((await b.send(worker, { action: "interact" })).data.ok, "past kit can be delivered to a ward");
  let board = (await b.state(worker)).minigame;
  ok(board?.stationId === "well", "past repair board opens");
  for (let i = 0; i < 90 && board; i++) {
    const [position, tension] = board.values, band = board.targets[board.step];
    const move = position < band ? (tension >= 4 ? 1 : 0) : tension > 2 ? 1 : 2;
    const result = await b.send(worker, { action: "ward_move", wardId: "well", move });
    if (!result.data.ok) throw new Error(result.data.error);
    board = (await b.state(worker)).minigame;
  }
  ok((await b.state(observer)).tasks.find((t) => t.id === "well").done, "past repair is visible in the present shared town");
  await b.send(worker, { action: "time_return" });

  // A Hollow can ruin a house ward and kill a recorded living soul.
  const c = await room("TimeH"); games.push(c);
  const hollow = c.people.find((p) => p.role === "hollow").id;
  const victim = c.people.filter((p) => p.role === "crew").sort((x, y) => x.x - y.x)[0];
  const hRange = await takeTimepiece(c, hollow);
  await travel(c, hollow, hRange.earliest);
  await walk(c, hollow, -190);
  ok((await c.send(hollow, { action: "interact" })).data.ok, "Hollow can take a house key in the past");
  await walk(c, hollow, -300);
  ok((await c.send(hollow, { action: "interact" })).data.ok, "Hollow opens the historical house");
  await walk(c, hollow, -490);
  ok((await c.send(hollow, { action: "interact" })).data.ok, "Hollow can open a real past repair");
  let hearth = (await c.state(hollow)).minigame;
  ok(hearth?.kind === "hearth", "Hollow receives the past workbench");
  for (let i = 0; i < 3; i++) {
    while (hearth.values[i] !== hearth.targets[i]) {
      const result = await c.send(hollow, { action: "ward_move", wardId: "tollhouse-hearth", move: i });
      if (!result.data.ok) throw new Error(result.data.error);
      hearth = (await c.state(hollow)).minigame;
    }
  }
  ok((await c.send(hollow, { action: "ward_move", wardId: "tollhouse-hearth", move: 3 })).data.ok, "Hollow can complete a past task");
  ok((await c.state(victim.id)).tasks.find((t) => t.id === "tollhouse-hearth").done, "Hollow's past repair reaches the present");
  ok((await c.send(hollow, { action: "sabotage" })).data.ok, "Hollow can sabotage a past ward");
  ok((await c.state(victim.id)).tasks.find((t) => t.id === "tollhouse-hearth").sabotaged, "past sabotage affects the present");
  await walk(c, hollow, victim.x);
  let hs = await c.state(hollow);
  ok(hs.players.some((player) => player.id === `echo:${victim.id}` && player.echo), "a recorded person appears when within lantern range");
  while (hs.self.killCooldownMs > 0) { await sleep(500); hs = await c.state(hollow); }
  ok((await c.send(hollow, { action: "ability" })).data.ok, "Hollow can strike a nearby past echo");
  ok(!(await c.state(victim.id)).self.alive, "past kill changes the victim's present state");
  await c.send(hollow, { action: "time_return" });
  console.log(`\n${checks} TIME TRAVEL CHECKS PASSED`);
} catch (error) {
  console.error("TIME TRAVEL SMOKE FAILED", error);
  process.exitCode = 1;
} finally {
  for (const game of games) await Promise.all(game.ids.map((id) => game.send(id, { dir: 0 }).catch(() => {})));
}
