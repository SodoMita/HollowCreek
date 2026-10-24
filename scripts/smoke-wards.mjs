// Live multiplayer repair-board smoke: all three kinds, cancellation, wrong
// inputs, and forged moves. Usage: node scripts/smoke-wards.mjs [baseUrl]
const B = process.argv[2] ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
let checks = 0;
const ok = (yes, text) => {
  console.log(`${yes ? "PASS" : "FAIL"} ${text}`);
  if (!yes) throw new Error(text);
  checks++;
};
const api = async (path, body) => {
  const response = await fetch(`${B}${path}`, body ? {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  return { status: response.status, body: await response.json() };
};
const code = (await api("/api/game/create", { playerId: ids[0], name: "WardsA" })).body.code;
for (let i = 1; i < ids.length; i++) await api("/api/game/join", { code, playerId: ids[i], name: `Wards${i + 1}` });
const input = (id, intent) => api("/api/game/input", { code, playerId: id, ...intent });
const state = async (id) => (await api(`/api/game/state?code=${code}&playerId=${id}`)).body;
const where = (s, id) => s.players.find((p) => p.id === id).x;
const walk = async (id, target) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const x = where(await state(id), id);
    if (Math.abs(x - target) < 35) {
      await input(id, { dir: 0, interactHeld: false, cartHeld: false });
      return;
    }
    await input(id, { dir: x < target ? 1 : -1, interactHeld: false, cartHeld: false });
    await sleep(220);
  }
  throw new Error(`Could not walk to ${target}`);
};
const flip = (lamps, index) => {
  const next = [...lamps];
  for (const at of [index, index - 3, index + 3, index - 1, index + 1]) {
    if (at < 0 || at > 8 || (Math.abs(at - index) === 1 && Math.floor(at / 3) !== Math.floor(index / 3))) continue;
    next[at] = 1 - next[at];
  }
  return next;
};
try {
  ok((await input(ids[3], { action: "start" })).body.ok, "a four-player night begins");
  const snapshots = await Promise.all(ids.map(state));
  const crew = ids.find((id, i) => snapshots[i].self.role === "crew");
  const stranger = ids.find((id) => id !== crew);
  ok(!!crew, "a living crew seat can repair wards");
  const tasks = [
    ["well", 680, "align"],
    ["scarecrow", 1060, "sequence"],
    ["lantern", 1450, "lights"],
  ];
  for (const [station, x, kind] of tasks) {
    await walk(crew, (await state(crew)).cartX);
    ok((await input(crew, { action: "interact" })).body.ok, `${station}: picked up a kit`);
    await walk(crew, x);
    ok((await input(crew, { action: "interact", interactHeld: true })).body.ok, `${station}: delivered kit`);
    let board = (await state(crew)).minigame;
    ok(board?.stationId === station && board.kind === kind, `${station}: ${kind} board visible immediately`);
    const forged = await input(stranger, { action: "ward_move", wardId: station, move: 0 });
    ok(forged.status === 400, `${station}: player without a board cannot forge repair`);
    const invalid = await input(crew, { action: "ward_move", wardId: station, move: 99 });
    ok(invalid.status === 400, `${station}: out-of-range tile rejected`);
    if (kind === "align") {
      const dial = board.values.findIndex((v, i) => v !== board.targets[i]);
      ok((await input(crew, { action: "ward_move", wardId: station, move: dial })).body.ok, "dial turns by one valid input");
      const afterTurn = (await state(crew)).minigame;
      await input(crew, { action: "ward_cancel" });
      ok((await state(crew)).minigame === null, "leaving the board closes only the UI");
      await input(crew, { action: "interact" });
      board = (await state(crew)).minigame;
      ok(board?.moves === afterTurn.moves && board.values[dial] === afterTurn.values[dial], "town-owned dial persists when reopened");
      for (let i = 0; i < 14; i++) {
        board = (await state(crew)).minigame;
        if (!board) break;
        const turn = board.values.findIndex((v, j) => v !== board.targets[j]);
        ok((await input(crew, { action: "ward_move", wardId: station, move: turn })).body.ok, "dial move accepted");
      }
    } else if (kind === "sequence") {
      const wrong = (board.targets[0] + 1) % 4;
      await input(crew, { action: "ward_move", wardId: station, move: wrong });
      board = (await state(crew)).minigame;
      ok(board.step === 0 && board.mistakes === 1, "wrong rune resets only its order");
      for (const rune of board.targets) ok((await input(crew, { action: "ward_move", wardId: station, move: rune })).body.ok, "rune input accepted");
    } else {
      let moves = null;
      for (let mask = 0; mask < 512; mask++) {
        let trial = board.values;
        const indices = [];
        for (let i = 0; i < 9; i++) if (mask & (1 << i)) { trial = flip(trial, i); indices.push(i); }
        if (trial.every((lit) => lit === 1)) { moves = indices; break; }
      }
      ok(!!moves, "server light grid has a legal solution");
      for (const tile of moves) ok((await input(crew, { action: "ward_move", wardId: station, move: tile })).body.ok, "light tile input accepted");
    }
    const result = await state(crew);
    ok(result.tasks.find((t) => t.id === station).done && result.minigame === null, `${station}: only solution completes the ward`);
  }
  ok((await state(crew)).taskBar.done === 3, "three distinct ward repairs share the town's progress");
  const hollow = ids.find((id, i) => snapshots[i].self.role === "hollow");
  await walk(hollow, 1450);
  ok((await input(hollow, { action: "sabotage" })).body.ok, "Hollow can ruin a finished puzzle ward");
  const ruined = await state(crew);
  const lantern = ruined.tasks.find((t) => t.id === "lantern");
  ok(!lantern.done && !lantern.delivered && lantern.progress === 0 && ruined.taskBar.done === 2,
    "sabotage clears solution and requires a fresh kit and puzzle");
  const events = (await api(`/api/game/log?code=${code}`));
  ok(events.status === 403, "roles and repair chronicle stay sealed during the match");
  console.log(`\n${checks} LIVE WARD CHECKS PASSED`);
} catch (error) {
  console.error("LIVE WARD CHECK FAILED", error);
  process.exitCode = 1;
}
