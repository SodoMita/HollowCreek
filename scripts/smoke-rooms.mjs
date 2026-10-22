// Persistent rooms + room-selection menu (survives a server restart).
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = () => crypto.randomUUID();
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b ?? {}) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const state = async (c, id) => (await fetch(`${BASE}/api/game/state?code=${c}&playerId=${id}`).then((r) => (r.ok ? r.json() : null)));
const list = async () => (await fetch(`${BASE}/api/game/rooms`, { cache: "no-store" }).then((r) => r.json())).rooms;
let failures = 0;
const ok = (c, l) => { console.log(`${c ? "  ok  " : " FAIL "} ${l}`); if (!c) failures++; };

const main = async () => {
  const a = pid();
  const code = (await post("/api/game/create", { playerId: a, name: "Marta" })).code;
  const seats = [{ id: a, name: "Marta" }];
  for (const name of ["Nils", "Olga", "Piotr"]) {
    const id = pid();
    seats.push({ id, name });
    await post("/api/game/join", { code, playerId: id, name });
  }
  const roster = async () => (await state(code, a)).players.map((p) => p.name).sort().join(",");
  ok((await roster()) === "Marta,Nils,Olga,Piotr", `roster seated (${await roster()})`);

  await sleep(1300); // write-behind flush
  let card = (await list()).find((r) => r.code === code);
  ok(!!card, "town appears in the room menu");
  ok(card.playerCount === 4, `menu shows 4 souls (${card.names.join(",")})`);
  ok(card.names.includes("Olga"), "menu shows who is in town");

  console.log("  ...restarting the server...");
  const { execSync } = await import("node:child_process");
  execSync("pkill -f 'next-serv[e]r'; sleep 1", { shell: "/bin/bash" });
  execSync("npx next start -p 3100 >/tmp/srv-restart.log 2>&1 &", { shell: "/bin/bash", cwd: process.cwd() });
  for (let i = 0; i < 40; i++) {
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)) break;
    await sleep(500);
  }
  ok(await fetch(`${BASE}/api/health`).then((r) => r.ok), "server restarted");

  card = (await list()).find((r) => r.code === code);
  ok(!!card, "town still listed after the restart");
  ok(card.playerCount === 4, `seats survived the restart (${card.names.join(",")})`);

  // Rejoin everyone at once. Before single-flight hydration, concurrent
  // requests could overwrite the restored room and strand successful joins.
  const returning = await Promise.all(
    seats.map(({ id, name }) => post("/api/game/join", { code, playerId: id, name }))
  );
  ok(returning.every((r) => r.ok !== false), "all concurrent returning joins accepted");
  const s1 = await state(code, a);
  ok(s1?.playerCount === 4, `single restored room keeps all 4 souls (${s1?.playerCount ?? "unknown"})`);
  ok(!!s1?.players.some((p) => p.name === "Marta"), "Marta is still Marta");
  for (const seat of seats) {
    const s = await state(code, seat.id);
    ok(!!s?.self, `${seat.name} has a snapshot immediately after concurrent join`);
  }

  await sleep(8300);
  const other = await post("/api/game/join", { code, playerId: pid(), name: "Olga" });
  const s2 = await state(code, a);
  ok(!s2.players.some((p) => /^Olga-\d/.test(p.name)), `no name-2 (${s2.players.map((p) => p.name).join(",")})`);
  ok(s2.playerCount === 4, `roster unchanged (${s2.playerCount})`);
  ok(!!other.playerId, "canonical playerId returned for the menu");

  const after = await state(code, a);
  ok(!!after.hostId, "somebody holds the lantern after the restart");
  const start = await post("/api/game/input", { code, playerId: after.hostId, action: "start" });
  const playing = await state(code, a);
  ok(start.ok !== false || playing.phase === "playing", `another night in the same town (${start.error ?? playing.phase})`);
  ok(playing.playerCount === 4, `same four players (${playing.playerCount})`);
  ok((await list()).some((r) => r.code === code), "town still offered by the menu");

  console.log(failures === 0 ? "\nPERSISTENT ROOMS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};
main().catch((e) => { console.error("CRASHED", e); process.exit(1); });
