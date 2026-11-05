// Seeded house-puzzle and station-placement regression tests.
import assert from "node:assert/strict";
import { build } from "esbuild";
const load = async (file) => {
  const out = await build({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const { createWardPuzzle, applyWardMove, validWardMove, wardSolved, wardProgress } = await load("src/game/wards.ts");
const { STATIONS } = await load("src/game/types.ts");
const { BUILDINGS, doorX, DOOR_REACH } = await load("src/game/buildings.ts");
const indoor = STATIONS.filter((station) => station.inside);
assert.equal(indoor.length, 4);
for (const station of indoor) {
  const b = BUILDINGS.find((building) => building.id === station.inside);
  assert.ok(b && station.initialSupplied, `${station.id} has a house and local supplies`);
  assert.ok(Math.abs(station.x - b.x) < b.width / 2 - 25, `${station.id} is inside its footprint`);
  assert.ok(Math.abs(station.x - doorX(b)) > DOOR_REACH + 20, `${station.id} does not overlap the door interaction`);
}
const play = (game, move) => {
  assert.ok(validWardMove(game, move));
  return applyWardMove(game, move);
};
function solve(game) {
  if (game.kind === "hearth") {
    for (let i = 0; i < 3; i++) while (game.values[i] !== game.targets[i]) game = play(game, i);
    return play(game, 3);
  }
  if (game.kind === "pantry") {
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < 3; i++) if (game.values[i] > game.values[i + 1]) game = play(game, i);
    return game;
  }
  if (game.kind === "clock") {
    while (game.values[0] !== game.targets[0]) game = play(game, 1);
    while (game.values[1] !== game.targets[1]) game = play(game, 3);
    return play(game, 4);
  }
  const seen = new Set([game.values.join(",")]);
  const queue = [game];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (wardSolved(current)) return current;
    for (let i = 0; i < 4; i++) {
      const next = play(current, i), key = next.values.join(",");
      if (!seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
  throw new Error("Fuse board was not solvable");
}
let total = 0;
for (const kind of ["hearth", "pantry", "clock", "fusebox"]) {
  for (let seed = 1; seed <= 100; seed++) {
    const game = createWardPuzzle(kind, seed);
    assert.equal(wardSolved(game), false, `${kind} begins unfinished`);
    assert.equal(validWardMove(game, -1), false);
    assert.equal(validWardMove(game, 99), false);
    assert.deepEqual(applyWardMove(game, 99), game);
    const done = solve(game);
    assert.ok(wardSolved(done), `${kind} seed ${seed} is solvable`);
    assert.equal(wardProgress(done), 1);
    total++;
  }
}
console.log(`${total} seeded house puzzles and all four indoor placements passed.`);
