// Deterministic, guaranteed-solvable turn-based repair boards.
// Usage: node scripts/test-wards.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({ entryPoints: ["src/game/wards.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const data = Buffer.from(output.outputFiles[0].text).toString("base64");
const { createWardPuzzle, applyWardMove, flipLights, wardSolved, wardProgress, validWardMove, wardKindFor } =
  await import(`data:text/javascript;base64,${data}`);
const kinds = ["pumpkins", "well", "scarecrow", "lantern", "chapel", "mill", "graves", "radio", "silo"];
let solved = 0;
for (const kind of kinds) {
  for (let seed = 1; seed <= 80; seed++) {
    let game = createWardPuzzle(kind, seed);
    assert.equal(game.kind, wardKindFor(kind));
    assert.deepEqual(game, createWardPuzzle(kind, seed), "same seed makes same puzzle");
    assert.equal(wardSolved(game), false, "puzzles do not begin solved");
    assert.equal(validWardMove(game, -1), false);
    assert.equal(validWardMove(game, 99), false);
    assert.deepEqual(applyWardMove(game, 99), game, "invalid move cannot advance the board");
    if (game.kind === "align") {
      for (let i = 0; i < game.values.length; i++) {
        let turns = 0;
        while (game.values[i] !== game.targets[i] && turns++ < 4) game = applyWardMove(game, i);
        assert.equal(game.values[i], game.targets[i]);
      }
    } else if (game.kind === "sequence") {
      const wrong = (game.targets[0] + 1) % 4;
      game = applyWardMove(game, wrong);
      assert.equal(game.step, 0, "mistake restarts visible sequence");
      assert.equal(game.mistakes, 1);
      for (const rune of game.targets) game = applyWardMove(game, rune);
    } else {
      let moves = null;
      for (let mask = 0; mask < 512; mask++) {
        let board = game.values;
        const trial = [];
        for (let i = 0; i < 9; i++) if (mask & (1 << i)) {
          board = flipLights(board, i);
          trial.push(i);
        }
        if (board.every((lit) => lit === 1)) { moves = trial; break; }
      }
      assert.ok(moves, `light board for ${kind} seed ${seed} must have a solution`);
      for (const tile of moves) game = applyWardMove(game, tile);
    }
    assert.ok(wardSolved(game), `${kind} seed ${seed} solved by legal moves`);
    assert.equal(wardProgress(game), 1);
    solved++;
  }
}
console.log(`WARD PUZZLES PASSED: ${solved} boards across ${kinds.length} stations`);
