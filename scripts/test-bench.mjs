// The Repair Bench is an offline page. This guards the contract that makes
// that true: it ships with the client, names every repair, uses the shared
// renderer, and never calls the game API.
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const sourceHtml = readFileSync("static-src/bench.html", "utf8");
const builtHtml = "public/play/bench.html";
assert.ok(existsSync(builtHtml), "bench.html is built into public/play/");
assert.equal(readFileSync(builtHtml, "utf8"), sourceHtml, "the built page matches its source");
assert.match(sourceHtml, /<script src="bench\.js"><\/script>/, "the page loads its own bundle");
assert.match(sourceHtml, /id="jobs"/, "the repair list has a mount point");
assert.match(sourceHtml, /id="stage"/, "the workbench has a mount point");
assert.match(sourceHtml, /aria-live="polite"/, "stage updates are announced");
assert.match(sourceHtml, /href="\.\/"/, "the bench links back to the town menu");

const built = readFileSync("public/play/bench.js", "utf8");
assert.ok(!/\/api\/game\//.test(built), "the bench never calls the game API");
assert.ok(!/\bfetch\s*\(/.test(built), "the bench makes no network requests at all");
assert.ok(!/XMLHttpRequest|EventSource|WebSocket/.test(built), "no streaming or socket transport");
assert.match(built, /hc_bench_best_v1/, "best runs are stored locally");
assert.match(built, /localStorage/, "the bench keeps its own records");
for (const phrase of ["Roof Truss", "The Long Draw", "Crow Call", "Lantern Rites", "Nine Candles", "Gear Train", "Marker Ledger", "Signal Lock", "Crossbar Lock", "The Cold Hearth", "The Preserves Shelf", "The Stopped Clock", "The Cottage Circuit"]) {
  assert.ok(built.includes(phrase), `${phrase} is on the bench`);
}
for (const word of ["Nudge", "New board", "Reset this board", "Copy practice link"]) {
  assert.ok(built.includes(word), `${word} control is present`);
}

const buildScript = readFileSync("scripts/build-static.mjs", "utf8");
assert.match(buildScript, /"bench"/, "build-static bundles the bench page");
assert.ok(readdirSync("public/play").includes("bench.js"), "the bundle exists on disk");
assert.ok(readFileSync("public/play/bench.js", "utf8").length < 60_000, "the offline bundle stays small");

// The live workbench and the bench must agree on the nudge API.
const wardUi = readFileSync("src/game/ward-ui.ts", "utf8");
assert.match(wardUi, /export function installWardStyles/, "the shared stylesheet can be mounted outside the overlay");
assert.match(wardUi, /from "\.\/ward-hints"/, "the in-game panel uses the same hints");
console.log("REPAIR BENCH PASSED: offline bundle, 13 repairs, local records, shared nudges");
