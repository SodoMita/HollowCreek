// Pure repair-game tests: every structure's physical job is solvable for many
// seeds, including the coupled glass and gear boards. No browser or DB needed.
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({ entryPoints: ["src/game/wards.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const data = Buffer.from(output.outputFiles[0].text).toString("base64");
const { WARD_JOBS, createWardPuzzle, applyWardMove, wardSolved, wardProgress, validWardMove, wardKindFor } =
  await import(`data:text/javascript;base64,${data}`);
const kinds = ["pumpkins", "well", "scarecrow", "lantern", "chapel", "mill", "graves", "radio", "silo"];
const play = (game, move) => {
  assert.ok(validWardMove(game, move), `${game.kind}: expected legal input ${move}`);
  return applyWardMove(game, move);
};

function coupledSolution(start) {
  const seen = new Set([start.values.join(",")]);
  const queue = [{ game: start, moves: [] }];
  for (let head = 0; head < queue.length; head++) {
    const { game, moves } = queue[head];
    if (wardSolved(game)) return moves;
    for (let i = 0; i < 4; i++) {
      const next = play(game, i);
      const key = next.values.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ game: next, moves: [...moves, i] });
    }
  }
  throw new Error(`${start.kind}: generated unreachable gear/glass state`);
}

function solve(start) {
  let game = start;
  if (game.kind === "pumpkins") {
    let choice = null;
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
      if ([a, b, c].includes(game.targets[7])) continue;
      if (game.targets[a] + game.targets[b] + game.targets[c] === game.targets[6]) choice = [a, b, c];
    }
    assert.ok(choice, "roof brace has three sound beams spanning its gap");
    for (const i of choice) game = play(game, i);
    game = play(game, 6);
  } else if (game.kind === "well") {
    while (game.values[0] < game.targets[0]) game = play(game, game.values[1] >= 3 ? 1 : 0);
    while (game.values[1] > 2) game = play(game, 1);
    game = play(game, 2);
  } else if (game.kind === "scarecrow") {
    game = play(game, (game.targets[0] + 1) % 16);
    assert.equal(game.mistakes, 1);
    for (const stitch of game.targets) game = play(game, stitch);
  } else if (game.kind === "lantern" || game.kind === "radio") {
    while (game.values[0] !== game.targets[0]) game = play(game, game.values[0] > game.targets[0] ? 0 : 1);
    while (game.values[1] !== game.targets[1]) game = play(game, game.values[1] > game.targets[1] ? 2 : 3);
    game = play(game, 4);
  } else if (game.kind === "chapel" || game.kind === "mill") {
    for (const move of coupledSolution(game)) game = play(game, move);
  } else if (game.kind === "graves") {
    for (let plot = 0; plot < 4; plot++) game = play(game, plot * 4 + game.targets[plot]);
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
  assert.ok(WARD_JOBS[kind]?.title && WARD_JOBS[kind]?.instruction, `${kind} has real repair copy`);
  for (let seed = 1; seed <= 80; seed++) {
    const game = createWardPuzzle(kind, seed);
    assert.equal(game.kind, wardKindFor(kind));
    assert.deepEqual(game, createWardPuzzle(kind, seed), "same seed always makes the same work");
    assert.equal(wardSolved(game), false, `${kind} seed ${seed} starts broken`);
    assert.equal(validWardMove(game, -1), false);
    assert.equal(validWardMove(game, 99), false);
    assert.deepEqual(applyWardMove(game, 99), game, "invalid action cannot modify work");
    const done = solve(game);
    assert.ok(wardSolved(done), `${kind} seed ${seed} solved by permitted physical actions`);
    assert.equal(wardProgress(done), 1);
    assert.ok(done.moves > 0);
    total++;
  }
}
console.log(`STRUCTURE REPAIR GAMES PASSED: ${total} generated jobs across ${kinds.length} wards`);
