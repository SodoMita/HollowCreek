// Live multiplayer regression for all five recovered ward games. The solver
// uses the same visible state a client receives; the server still owns every
// move, location, role, cooldown and completion.
// Usage: node scripts/smoke-wards.mjs [baseUrl]
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/game/wards.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const rules = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
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
    if (Math.abs(x - target) < 35) { await input(id, { dir: 0, interactHeld: false, cartHeld: false }); return; }
    await input(id, { dir: x < target ? 1 : -1, interactHeld: false, cartHeld: false });
    await sleep(220);
  }
  throw new Error(`Could not walk to ${target}`);
};
try {
  ok((await input(ids[3], { action: "start" })).body.ok, "a four-player night begins");
  const snapshots = await Promise.all(ids.map(state));
  const crew = ids.find((id, i) => snapshots[i].self.role === "crew");
  const stranger = ids.find((id) => id !== crew);
  ok(!!crew, "a living crew seat can repair wards");
  const move = async (station, tile) => {
    let r = await input(crew, { action: "ward_move", wardId: station, move: tile });
    if (!r.body.ok && /vigor/i.test(r.body.error ?? "")) {
      await sleep(5200);
      r = await input(crew, { action: "ward_move", wardId: station, move: tile });
    }
    if (!r.body.ok) throw new Error(`${station} move ${tile} failed: ${r.body.error}`);
  };
  const tasks = [
    ["well", 680], ["scarecrow", 1060], ["lantern", 1450],
    ["chapel", 1720], ["pumpkins", 280],
  ];
  for (const [station, x] of tasks) {
    await walk(crew, (await state(crew)).cartX);
    ok((await input(crew, { action: "interact" })).body.ok, `${station}: kit taken`);
    await walk(crew, x);
    ok((await input(crew, { action: "interact", interactHeld: true })).body.ok, `${station}: kit delivered`);
    let snap = await state(crew);
    if (!snap.minigame && snap.self.exhausted) {
      await sleep(5200);
      await input(crew, { action: "interact" });
      snap = await state(crew);
    }
    let board = snap.minigame;
    ok(board?.stationId === station && board.kind === station, `${station}: physical workbench opens on delivery`);
    ok((await input(stranger, { action: "ward_move", wardId: station, move: 0 })).status === 400,
      `${station}: player without a board cannot forge a repair`);
    ok((await input(crew, { action: "ward_move", wardId: station, move: 99 })).status === 400,
      `${station}: invalid physical action rejected`);

    if (station === "well") {
      await move(station, 0);
      const before = (await state(crew)).minigame;
      await input(crew, { action: "ward_cancel" });
      ok((await state(crew)).minigame === null, "Long Draw: leaving closes only the panel");
      await input(crew, { action: "interact" });
      board = (await state(crew)).minigame;
      ok(board?.moves === before.moves && board.values[0] === before.values[0], "Long Draw: bucket position persists");
      for (let turn = 0; turn < 85; turn++) {
        board = (await state(crew)).minigame;
        if (!board) break;
        const [pos, tension] = board.values, band = board.targets[board.step];
        await move(station, pos < band ? tension >= 4 ? 1 : 0 : tension > 2 ? 1 : 2);
      }
    } else if (station === "scarecrow") {
      ok(board.revealMs > 0, "Crow Call: crows show the first phrase");
      ok((await input(crew, { action: "ward_move", wardId: station, move: board.targets[0] })).status === 400,
        "Crow Call: input during the preview is rejected by the server");
      for (let round = 0; round < 4; round++) {
        board = (await state(crew)).minigame;
        ok(board.values[0] === round, `Crow Call: growing round ${round + 1}`);
        if (board.revealMs > 0) await sleep(board.revealMs + 200);
        board = (await state(crew)).minigame;
        for (const rune of board.targets.slice(0, 3 + round)) await move(station, rune);
      }
    } else if (station === "lantern") {
      const seen = new Set([board.values.join(",")]);
      const queue = [{ game: board, moves: [] }];
      let solution = null;
      for (let head = 0; head < queue.length && !solution; head++) {
        const { game, moves } = queue[head];
        if (rules.wardSolved(game)) { solution = moves; break; }
        for (let i = 0; i < 6; i++) {
          const next = rules.applyWardMove(game, i), key = next.values.join(",");
          if (!seen.has(key)) { seen.add(key); queue.push({ game: next, moves: [...moves, i] }); }
        }
      }
      ok(solution?.length >= 4, "Lantern Rites: meshed eight-face bands need multiple turns");
      for (const turn of solution) await move(station, turn);
    } else if (station === "chapel") {
      ok(board.extra[0] >= 3, "Nine Candles: at least three cross-neighbour taps required");
      let solution = null;
      for (let mask = 0; mask < 512 && !solution; mask++) {
        let candidate = board, taps = [];
        for (let i = 0; i < 9; i++) if (mask & (1 << i)) { candidate = rules.applyWardMove(candidate, i); taps.push(i); }
        if (rules.wardSolved(candidate)) solution = taps;
      }
      ok(!!solution, "Nine Candles: generated board solvable");
      for (const tap of solution) await move(station, tap);
    } else {
      const t = board.targets, v = board.values;
      let choice = null;
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
        if ([a, b, c].includes(t[7])) continue;
        if (t[a] + t[b] + t[c] === t[6]) choice = [a, b, c];
      }
      ok(!!choice, "Roof Truss: sound beams span the shed");
      for (const beam of choice) await move(station, beam);
      await move(station, 6);
      board = (await state(crew)).minigame;
      ok(board?.step === 1 && !(await state(crew)).tasks.find((task) => task.id === station).done,
        "Roof Truss: shed is still unfinished until The Furrow is cut");
      for (const cell of board.targets.slice(8)) await move(station, 7 + cell);
    }
    const result = await state(crew);
    ok(result.tasks.find((task) => task.id === station).done && result.minigame === null,
      `${station}: only completed work restores the structure`);
  }
  ok((await state(crew)).taskBar.done === 5, "five recovered repairs share the town's progress");
  const hollow = ids.find((id, i) => snapshots[i].self.role === "hollow");
  await walk(hollow, 280);
  ok((await input(hollow, { action: "sabotage" })).body.ok, "Hollow can ruin a recovered two-stage repair");
  const ruined = await state(crew);
  const harvest = ruined.tasks.find((task) => task.id === "pumpkins");
  ok(!harvest.done && !harvest.delivered && harvest.progress === 0 && ruined.taskBar.done === 4,
    "sabotage resets both stages and needs a new kit");
  ok((await api(`/api/game/log?code=${code}`)).status === 403, "roles and ward chronicle stay sealed mid-match");
  console.log(`\n${checks} RECOVERED WARD LIVE CHECKS PASSED`);
} catch (error) {
  console.error("RECOVERED WARD LIVE CHECK FAILED", error);
  process.exitCode = 1;
}
