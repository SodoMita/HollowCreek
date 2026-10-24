// Multiplayer cage, key, and end-only role reveal regression.
// Usage: node scripts/smoke-cages.mjs [baseUrl]
const B = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let checks = 0;
const ok = (condition, label) => {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) throw new Error(label);
  checks++;
};
async function request(method, path, data) {
  const response = await fetch(`${B}${path}`, data ? {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(data),
  } : { method });
  return { status: response.status, body: await response.json() };
}
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
const { body: created } = await request("POST", "/api/game/create", { playerId: ids[0], name: "CageA" });
const code = created.code;
for (let i = 1; i < ids.length; i++) {
  const joined = await request("POST", "/api/game/join", { code, playerId: ids[i], name: `Cage${i + 1}` });
  ok(joined.body.ok, `player ${i + 1} joined`);
}
const send = (id, intent) => request("POST", "/api/game/input", { code, playerId: id, ...intent });
const state = async (id) => (await request("GET", `/api/game/state?code=${code}&playerId=${id}`)).body;
const pos = async (id) => (await state(id)).players.find((p) => p.id === id).x;
async function walkTo(id, target, limitMs = 30000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const x = await pos(id);
    if (Math.abs(x - target) < 30) {
      await send(id, { dir: 0, interactHeld: false, cartHeld: false });
      return;
    }
    await send(id, { dir: x < target ? 1 : -1, interactHeld: false, cartHeld: false });
    await sleep(230);
  }
  throw new Error(`Could not reach ${target}`);
}
try {
  ok((await send(ids[3], { action: "start" })).body.ok, "last joiner starts the night");
  const roles = await Promise.all(ids.map(async (id) => (await state(id)).self.role));
  const hollow = ids[roles.indexOf("hollow")];
  const crew = ids.filter((id) => id !== hollow);
  ok(crew.length === 3, "one Hollow and three townsfolk");
  ok((await state(crew[0])).results === null, "match results sealed while playing");
  ok((await request("GET", `/api/game/log?code=${code}`)).status === 403, "JSON ledger sealed while playing");

  // Everyone must physically walk into the voting square.
  for (const id of ids) await send(id, { dir: (await pos(id)) < 2200 ? 1 : -1 });
  const pending = new Set(ids);
  const until = Date.now() + 27000;
  while (pending.size && Date.now() < until) {
    for (const id of pending) {
      if (Math.abs((await pos(id)) - 2200) < 38) {
        await send(id, { dir: 0 });
        pending.delete(id);
      }
    }
    await sleep(250);
  }
  ok(pending.size === 0, "all voters reached the square");
  ok((await send(crew[0], { action: "ability" })).body.ok, "crew rang the bell");
  for (const id of crew) ok((await send(id, { action: "vote", vote: hollow })).body.ok, "crew voted to cage the Hollow");
  ok((await send(hollow, { action: "vote", vote: "skip" })).body.ok, "verdict resolved");
  let snap = await state(crew[0]);
  ok(snap.phase === "playing" && snap.results === null && snap.taskBar.done === 0, "jailing a Hollow never ends the match");
  ok(snap.players.find((p) => p.id === hollow).caged, "Hollow held in a cage");

  // The key is hidden on one of the outskirts. Follow the street until it is visible.
  const holder = crew[0];
  let found = false;
  for (const edge of [90, 4090]) {
    const untilKey = Date.now() + 32000;
    while (Date.now() < untilKey) {
      snap = await state(holder);
      const x = snap.players.find((p) => p.id === holder).x;
      const key = snap.keyX;
      if (key !== null && Math.abs(x - key) < 35) {
        await send(holder, { dir: 0 });
        const picked = await send(holder, { action: "interact" });
        found = picked.body.ok && (await state(holder)).self.hasKey;
        break;
      }
      if (key === null && Math.abs(x - edge) < 38) break;
      const target = key ?? edge;
      await send(holder, { dir: x < target ? 1 : -1 });
      await sleep(230);
    }
    if (found) break;
  }
  ok(found, "a crew member found the iron key");
  const cageX = (await state(holder)).cages.find((c) => c.occupant === hollow).x;
  await walkTo(holder, cageX + 91);
  ok((await send(holder, { action: "interact" })).body.ok, "key opened the nearby cage");
  snap = await state(holder);
  ok(!snap.players.find((p) => p.id === hollow).caged && snap.phase === "playing", "prisoner free and match continues");
  ok(!snap.self.hasKey && snap.results === null, "key consumed and roles remain sealed");

  // Two server-authoritative kills finish a four-player night.
  for (const victim of [holder, crew.find((id) => id !== holder)]) {
    await walkTo(victim, await pos(hollow), 22000);
    const killUntil = Date.now() + 25000;
    while ((await state(hollow)).self.killCooldownMs > 0 && Date.now() < killUntil) await sleep(600);
    ok((await send(hollow, { action: "ability" })).body.ok, "Hollow killed within range");
  }
  snap = await state(hollow);
  ok(snap.phase === "ended" && snap.results?.players.length === 4, "end reveals all four result rows");
  ok(snap.results.players.filter((p) => p.role === "hollow").length === 1, "roles appear only at match end");
  const killer = snap.results.players.find((p) => p.id === hollow);
  const locksmith = snap.results.players.find((p) => p.id === holder);
  ok(killer.stats.kills === 2 && killer.stats.timesCaged === 1, "match kills and jail time counted");
  ok(locksmith.stats.cagesOpened === 1, "match cage unlock counted");
  ok((await request("GET", `/api/game/log?code=${code}`)).status === 200, "ledger opens after match end");
  ok((await send(snap.hostId, { action: "restart" })).body.ok, "host gathers a rematch");
  const rematch = await state(hollow);
  ok(rematch.phase === "lobby" && rematch.results === null, "rematch hides old roles and match stats");
  ok((await request("GET", `/api/game/log?code=${code}`)).status === 403, "ledger seals again for the new night");
  console.log(`\n${checks} CAGE / RESULTS CHECKS PASSED`);
} catch (error) {
  console.error("CAGE / RESULTS SMOKE FAILED", error);
  process.exitCode = 1;
}
