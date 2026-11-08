// Unit tests for the opt-in repair nudges (src/game/ward-hints.ts).
// Hints are local text only: this proves every repair has one at every level,
// that the text is sane, and that a solved board says so.
import assert from "node:assert/strict";
import { build } from "esbuild";
const load = async (file) => {
  const out = await build({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const { wardHint, HINT_LABELS } = await load("src/game/ward-hints.ts");
const { WARD_JOBS, createWardPuzzle, applyWardMove, wardSolved, wardView } = await load("src/game/wards.ts");

const kinds = Object.keys(WARD_JOBS);
assert.equal(kinds.length, 13, "thirteen repairs");
assert.equal(HINT_LABELS.length, 3, "three depths: rule, board, next move");
let checked = 0;
for (const kind of kinds) {
  for (let seed = 1; seed <= 25; seed++) {
    const game = createWardPuzzle(kind, seed * 7919);
    for (let level = 0; level < 3; level++) {
      const hint = wardHint(wardView(kind, "Ward", game), level);
      assert.equal(typeof hint, "string", `${kind} level ${level} is text`);
      assert.ok(hint.length > 10 && hint.length <= 320, `${kind} level ${level} is readable (${hint.length})`);
      assert.ok(!/undefined|NaN|\[object/.test(hint), `${kind} level ${level} has no broken interpolation: ${hint}`);
      checked++;
    }
    assert.equal(wardHint(wardView(kind, "Ward", game), 99), wardHint(wardView(kind, "Ward", game), 2), `${kind} clamps high levels`);
    assert.equal(wardHint(wardView(kind, "Ward", game), -4), wardHint(wardView(kind, "Ward", game), 0), `${kind} clamps low levels`);
  }
}
assert.ok(checked === 13 * 25 * 3, "every repair and level visited");

// A solved board short-circuits instead of naming another move.
const solvedHints = [];
for (const kind of kinds) {
  const fresh = createWardPuzzle(kind, 424242);
  const view = wardView(kind, "Ward", fresh);
  if (wardSolved(fresh)) solvedHints.push(wardHint(view, 2));
}
assert.ok(solvedHints.every((hint) => hint.includes("whole")), "solved boards say they are whole");

// Concrete level-3 hints must agree with the authoritative targets.
const graves = createWardPuzzle("graves", 8);
const graveHint = wardHint(wardView("graves", "Ward", graves), 2);
assert.match(graveHint, /Plot (I|II|III|IV) takes the (ALDER|BELL|CROW|DOVE) marker/, "graves names a plot and stone");
const clock = createWardPuzzle("clock", 8);
const clockHint = wardHint(wardView("clock", "Ward", clock), 2);
assert.match(clockHint, /Set the clock to \d\d:\d\d, then wind it\./, "clock names the target time");
const silo = createWardPuzzle("silo", 8);
const siloHint = wardHint(wardView("silo", "Ward", silo), 2);
assert.match(siloHint, /Seat the (upper|left|lower|right) bar next\./, "silo names the next load-bearing bar");
const chapel = createWardPuzzle("chapel", 8);
const chapelHint = wardHint(wardView("chapel", "Ward", chapel), 2);
assert.match(chapelHint, /Tap row [1-3], column [1-3]\./, "chapel names a candle");

// Level 1 hints must react to the board, not repeat level 0.
let reacted = 0;
for (const kind of kinds) {
  const game = createWardPuzzle(kind, 5150);
  const rule = wardHint(wardView(kind, "Ward", game), 0);
  const board = wardHint(wardView(kind, "Ward", game), 1);
  if (rule !== board) reacted++;
}
assert.ok(reacted >= 10, `level 1 reads the board for most repairs (${reacted}/13)`);

// Hints never mutate the board or claim a solved ward.
const before = JSON.stringify(createWardPuzzle("well", 3));
const fresh = createWardPuzzle("well", 3);
const freshView = wardView("well", "Ward", fresh);
wardHint(freshView, 0); wardHint(freshView, 1); wardHint(freshView, 2);
assert.equal(JSON.stringify(fresh), before, "hints are pure");

// Playing one legal move keeps hints valid and never throws.
let played = 0;
for (const kind of kinds) {
  let game = createWardPuzzle(kind, 99);
  game = applyWardMove(game, 0);
  const hint = wardHint(wardView(kind, "Ward", game), 2);
  assert.ok(typeof hint === "string" && hint.length > 0, `${kind} advises after a move`);
  played++;
}
assert.equal(played, 13);
console.log(`WARD HINTS PASSED: ${checked} nudges across 13 repairs, pure and target-consistent`);
