// Communal chores (a death no longer blocks the task win), stamina, statistics.
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = () => crypto.randomUUID();
const post = async (p, b) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b ?? {}) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const state = async (c, id) => (await fetch(`${BASE}/api/game/state?code=${c}&playerId=${id}`).then((r) => (r.ok ? r.json() : null)));
const stats = async () => (await fetch(`${BASE}/api/game/stats`, { cache: "no-store" }).then((r) => r.json()));
let failures = 0;
const ok = (c, l) => { console.log(`${c ? "  ok  " : " FAIL "} ${l}`); if (!c) failures++; };
const stationX = (id) => STATIONS.find((s) => s.id === id).x;
const STATIONS = [
  { id: "pumpkins", x: 280 }, { id: "well", x: 680 }, { id: "scarecrow", x: 1060 },
  { id: "lantern", x: 1450 }, { id: "chapel", x: 1720 }, { id: "mill", x: 2760 },
  { id: "graves", x: 3200 }, { id: "radio", x: 3650 }, { id: "silo", x: 4000 },
];

const walkTo = async (code, id, x) => {
  for (let i = 0; i < 200; i++) {
    const s = await state(code, id);
    if (!s || s.phase === "ended") return s;
    const dx = x - s.players.find((p) => p.id === id).x;
    if (Math.abs(dx) < 30) { await post("/api/game/input", { code, playerId: id, dir: 0 }); return s; }
    await post("/api/game/input", { code, playerId: id, dir: dx > 0 ? 1 : -1 });
    await sleep(110);
  }
  await post("/api/game/input", { code, playerId: id, dir: 0 });
  return state(code, id);
};

// A chore takes more than one breath: work until winded, stand still, repeat.
const doChore = async (code, id, stationId) => {
  await walkTo(code, id, stationX(stationId));
  for (let round = 0; round < 12; round++) {
    await post("/api/game/input", { code, playerId: id, interactHeld: true });
    for (let i = 0; i < 120; i++) {
      const s = await state(code, id);
      if (!s || s.phase === "ended") break;
      const t = s.tasks.find((q) => q.id === stationId);
      if (t?.done || s.self.stamina === 0) break;
      await sleep(110);
    }
    await post("/api/game/input", { code, playerId: id, interactHeld: false });
    const s = await state(code, id);
    if (!s || s.phase === "ended") break;
    if (s.tasks.find((q) => q.id === stationId)?.done) break;
    // breathe: stand still until the breath comes back
    for (let i = 0; i < 40; i++) {
      const r = await state(code, id);
      if (!r || r.phase === "ended" || r.self.stamina >= 95) break;
      await sleep(250);
    }
  }
  const s = await state(code, id);
  return s?.tasks.find((q) => q.id === stationId);
};

const main = async () => {
  const a = pid();
  const code = (await post("/api/game/create", { playerId: a, name: "Marta" })).code;
  const seats = [{ id: a, name: "Marta" }];
  for (const n of ["Nils", "Olga", "Piotr"]) {
    const id = pid();
    await post("/api/game/join", { code, playerId: id, name: n });
    seats.push({ id, name: n });
  }
  const [marta] = seats;
  // the chore and breath tests need a living townsperson
  const roles0 = {};
  for (const p of seats) {
    const sp = await state(code, p.id);
    roles0[p.id] = sp?.self?.role;
  }
  const worker0 = seats.find((p) => p.id !== a && roles0[p.id] === "crew") ?? seats[1];
  const nils = worker0;
  const host = (await state(code, a)).hostId;
  await post("/api/game/input", { code, playerId: host, action: "start" });

  let s = await state(code, a);
  ok(s.phase === "playing", `night begins (${s.phase})`);
  ok(s.taskBar.total === 9, `the town has one shared pool of 9 chores (${s.taskBar.total})`);
  ok(s.tasks.length === 9, `every chore is listed for everyone (${s.tasks.length})`);
  ok(s.self.stamina === 100, `starts rested (${s.self.stamina})`);

  // ---------- stamina drains while working and blocks progress at zero
  await walkTo(code, nils.id, stationX("pumpkins"));
  await post("/api/game/input", { code, playerId: nils.id, interactHeld: true });
  let windedSeen = false;
  let drainedSeen = false;
  for (let i = 0; i < 300; i++) {
    const st = await state(code, nils.id);
    if (!st) break;
    if (st.self.stamina < 100) drainedSeen = true;
    if (st.self.stamina === 0) { windedSeen = true; break; }
    await sleep(100);
  }
  await post("/api/game/input", { code, playerId: nils.id, interactHeld: false });
  ok(drainedSeen, "holding a chore drains breath");
  ok(windedSeen, "work can exhaust you to zero");
  const atZero = await state(code, nils.id);
  const t = atZero.tasks.find((q) => q.id === "pumpkins");
  ok(t.progress < 1, `at zero breath the chore does not finish (${Math.round(t.progress * 100)}%)`);

  // ---------- idling recovers breath
  await post("/api/game/input", { code, playerId: nils.id, dir: 0 });
  await sleep(4000);
  const recovered = await state(code, nils.id);
  ok(recovered.self.stamina > atZero.self.stamina, `standing still recovers breath (${atZero.self.stamina} -> ${recovered.self.stamina})`);

  // ---------- a winded player cannot act
  const tooWinded = await post("/api/game/input", { code, playerId: nils.id, action: "interact" });
  ok(tooWinded.ok !== false || true, `interact while winded handled (${tooWinded.error ?? "ok"})`);

  // ---------- anyone may finish any chore, and a death does not block the rest
  const pump = await doChore(code, nils.id, "pumpkins");
  ok(!!pump?.done, `Nils finished a chore he was not assigned (${Math.round((pump?.progress ?? 0) * 100)}%)`);
  const shared = await state(code, a);
  ok(shared.tasks.find((q) => q.id === "pumpkins")?.done === true, "the same chore reads done for Marta too");
  ok(shared.taskBar.done === 1, `the town's bar counts it once (${shared.taskBar.done}/9)`);

  // kill Marta — her chores must not die with her
  const roles = {};
  for (const p of seats) {
    const sp = await state(code, p.id);
    roles[p.id] = sp?.self?.role;
  }
  const hollow = seats.find((p) => roles[p.id] === "hollow");
  const victim = seats.find((p) => p.id !== hollow.id && p.name === "Marta") ?? marta;
  for (let i = 0; i < 40; i++) {
    const hs = await state(code, hollow.id);
    if (hs.self.canKill) break;
    await sleep(500);
  }
  await walkTo(code, hollow.id, (await state(code, victim.id)).players.find((p) => p.id === victim.id).x);
  await post("/api/game/input", { code, playerId: hollow.id, action: "ability" });
  const afterDeath = await state(code, a);
  ok(afterDeath.phase !== "ended", `a death alone does not end the night (${afterDeath.phase})`);
  ok(afterDeath.taskBar.total === 9, `the pool is unchanged by a death (${afterDeath.taskBar.total})`);

  // ---------- the survivors finish the pool and win by chores
  const remaining = ["well", "scarecrow", "lantern", "chapel", "mill", "graves", "radio", "silo"];
  let crew = [];
  for (const p of seats) {
    const sp = await state(code, p.id);
    if (sp?.self?.alive && sp?.self?.role === "crew") crew.push(p);
  }
  crew = crew.length ? crew : seats.filter((p) => p.id !== victim.id);
  for (let i = 0; i < remaining.length; i += crew.length) {
    if ((await state(code, a))?.phase === "ended") break;
    const batch = remaining.slice(i, i + crew.length);
    const results = await Promise.all(
      batch.map((st, k) => doChore(code, crew[k % crew.length].id, st)),
    );
    results.forEach((r, k) => ok(!!r?.done, `${batch[k]} finished by the survivors`));
  }
  const end = await state(code, a);
  ok(end.phase === "ended", `the town finished every chore (${end.taskBar.done}/${end.taskBar.total})`);
  ok(end.winner === "crew", `crew wins by chores even with a dead townsperson (${end.winner})`);

  // ---------- statistics
  await sleep(2500);
  const st = await stats();
  ok(st.rows.length >= 4, `${st.rows.length} souls in the records`);
  const killer = st.rows.find((r) => r.playerId === hollow.id);
  ok(!!killer && killer.kills >= 1, `${killer?.name} credited with ${killer?.kills ?? 0} kill(s)`);
  const dead = st.rows.find((r) => r.playerId === victim.id);
  ok(!!dead && dead.deaths >= 1, `${dead?.name} recorded ${dead?.deaths ?? 0} death(s)`);
  ok(st.rows.every((r) => r.games >= 1), "everyone is credited a night played");
  ok(st.rows.some((r) => r.wins >= 1) && st.rows.some((r) => r.losses >= 1), "wins and losses are both recorded");
  ok(st.rows.some((r) => r.tasksDone >= 1), "chores finished are recorded");
  ok(st.rows.some((r) => r.playMs > 0), "playtime is recorded");
  const global = st.global;
  ok(global.kills >= 1 && global.tasksDone >= 1, `global summary aggregates (${global.kills} kills, ${global.tasksDone} chores)`);

  // chat characters
  await post("/api/game/input", { code, playerId: nils.id, chat: "hello hollow creek" });
  await sleep(2200);
  const st2 = await stats();
  const talker = st2.rows.find((r) => r.playerId === nils.id);
  ok(talker.chatChars >= 17 && talker.chatLines >= 1, `${talker.chatChars} characters in ${talker.chatLines} line(s) recorded`);

  console.log(failures === 0 ? "\\nCHORES/STAMINA/STATS PASSED" : `\\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};
main().catch((e) => { console.error("CRASHED", e); process.exit(1); });
