// Deterministic repair-game tests. The five recovered Gloamwing mechanics are
// tested as live structure jobs, including minimum difficulty and both phases
// of the harvest shed. No browser, network or database is needed.
import assert from "node:assert/strict";
import { build } from "esbuild";
const load = async (file) => {
  const out = await build({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const { WARD_JOBS, createWardPuzzle, applyWardMove, wardSolved, wardProgress, validWardMove, wardKindFor } = await load("src/game/wards.ts");
const { candlePar, lanternPar } = await load("src/game/recovered-wards.ts");
const kinds = ["pumpkins", "well", "scarecrow", "lantern", "chapel", "mill", "graves", "radio", "silo"];
const play = (game, move) => {
  assert.ok(validWardMove(game, move), `${game.kind}: expected legal input ${move}`);
  return applyWardMove(game, move);
};
function searchSolution(start, size) {
  const seen = new Set([start.values.join(",")]);
  const queue = [{ game: start, moves: [] }];
  for (let head = 0; head < queue.length; head++) {
    const { game, moves } = queue[head];
    if (wardSolved(game)) return moves;
    for (let i = 0; i < size; i++) {
      const next = play(game, i), key = next.values.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ game: next, moves: [...moves, i] });
    }
  }
  throw new Error(`${start.kind} produced an unreachable state`);
}
function candleSolution(start) {
  for (let mask = 0; mask < 512; mask++) {
    let game = start;
    const moves = [];
    for (let i = 0; i < 9; i++) if (mask & (1 << i)) {
      game = play(game, i);
      moves.push(i);
    }
    if (wardSolved(game)) return moves;
  }
  throw new Error("Nine Candles has no solution");
}
function solve(start) {
  let game = start;
  if (game.kind === "pumpkins") {
    let choice = null;
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
      if ([a, b, c].includes(game.targets[7])) continue;
      if (game.targets[a] + game.targets[b] + game.targets[c] === game.targets[6]) choice = [a, b, c];
    }
    assert.ok(choice, "Roof Truss has three sound beams spanning the gap");
    for (const beam of choice) game = play(game, beam);
    game = play(game, 6);
    assert.equal(game.step, 1, "Roof Truss fastened but Furrow still needs work");
    assert.equal(wardSolved(game), false, "a braced roof alone does not finish harvest shed");
    const path = game.targets.slice(8);
    assert.equal(path.length, 7);
    assert.equal(new Set(path).size, 7);
    for (let i = 1; i < path.length; i++) {
      assert.equal(Math.abs(path[i] % 3 - path[i - 1] % 3) + Math.abs(Math.floor(path[i] / 3) - Math.floor(path[i - 1] / 3)), 1);
    }
    const wrong = (path[0] + 1) % 9;
    game = play(game, 7 + wrong);
    assert.equal(game.step, 1, "wrong Furrow turn resets only the drainage path");
    for (const cell of path) game = play(game, 7 + cell);
  } else if (game.kind === "well") {
    for (let turn = 0; turn < 80 && !wardSolved(game); turn++) {
      const band = game.targets[game.step], [pos, tension] = game.values;
      game = play(game, pos < band ? tension >= 4 ? 1 : 0 : tension > 2 ? 1 : 2);
    }
    assert.equal(game.step, 3, "The Long Draw requires three separate catches");
  } else if (game.kind === "scarecrow") {
    game = play(game, 4);
    assert.equal(game.values[0], 0, "replaying a call cannot repair the scarecrow");
    game = play(game, (game.targets[0] + 1) % 4);
    assert.equal(game.mistakes, 1);
    for (let round = 0; round < 4; round++) {
      for (const rune of game.targets.slice(0, 3 + round)) game = play(game, rune);
      assert.equal(game.values[0], round + 1);
    }
    assert.ok(game.moves >= 18, "Crow Call grows to six runes over four rounds");
  } else if (game.kind === "lantern") {
    const moves = searchSolution(game, 6);
    assert.ok(moves.length >= 4, "Lantern Rites cannot be a one-click ring puzzle");
    assert.equal(moves.length, lanternPar(game.values));
    for (const move of moves) game = play(game, move);
  } else if (game.kind === "chapel") {
    const moves = candleSolution(game);
    assert.ok(game.extra[0] >= 3, "Nine Candles always needs genuine work");
    assert.equal(game.extra[0], candlePar(game.values));
    for (const move of moves) game = play(game, move);
  } else if (game.kind === "mill") {
    for (const move of searchSolution(game, 4)) game = play(game, move);
  } else if (game.kind === "graves") {
    for (let plot = 0; plot < 4; plot++) game = play(game, plot * 4 + game.targets[plot]);
  } else if (game.kind === "radio") {
    while (game.values[0] !== game.targets[0]) game = play(game, game.values[0] > game.targets[0] ? 0 : 1);
    while (game.values[1] !== game.targets[1]) game = play(game, game.values[1] > game.targets[1] ? 2 : 3);
    game = play(game, 4);
  } else {
    game = play(game, (game.targets[0] + 1) % 4);
    assert.equal(game.mistakes, 1);
    for (const bar of game.targets) game = play(game, bar);
    game = play(game, 4);
  }
  return game;
}
let total = 0;
for (const kind of kinds) {
  assert.ok(WARD_JOBS[kind]?.title && WARD_JOBS[kind]?.instruction);
  for (let seed = 1; seed <= 80; seed++) {
    const game = createWardPuzzle(kind, seed);
    assert.equal(game.kind, wardKindFor(kind));
    assert.deepEqual(game, createWardPuzzle(kind, seed));
    assert.equal(wardSolved(game), false, `${kind} seed ${seed} must start broken`);
    assert.equal(validWardMove(game, -1), false);
    assert.equal(validWardMove(game, 99), false);
    assert.deepEqual(applyWardMove(game, 99), game);
    const done = solve(game);
    assert.ok(wardSolved(done), `${kind} seed ${seed} completed by legal work`);
    assert.equal(wardProgress(done), 1);
    total++;
  }
}
console.log(`RECOVERED WARD GAMES PASSED: ${total} seeded jobs across ${kinds.length} structures`);
