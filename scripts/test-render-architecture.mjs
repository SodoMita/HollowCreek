// Architecture tests for the display-list renderer: camera maths, band order,
// culling, scene composition and code-shape guarantees. No browser required.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const load = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const plan = await load("src/game/render/plan.ts");
const { Scene, BANDS, nodesOf } = await load("src/game/render/scene.ts");
const { WORLD_MIN, WORLD_MAX } = await load("src/game/buildings.ts");

// ------------------------------------------------------------------ camera --
assert.equal(plan.cameraTarget(1000, 800), 600, "camera centres the look-at point");
assert.equal(plan.cameraTarget(WORLD_MIN, 800), WORLD_MIN, "west end clamps");
assert.equal(plan.cameraTarget(WORLD_MAX, 800), WORLD_MAX - 800, "east end clamps");
const wide = WORLD_MAX - WORLD_MIN + 10;
assert.equal(plan.cameraTarget(0, wide), (WORLD_MIN + WORLD_MAX - wide) / 2, "a world narrower than the view is centred");
assert.equal(plan.smoothCamera(0, 100, 1 / 60, false), 100, "no smoothing snaps to the target");
const eased = plan.smoothCamera(0, 100, 1 / 60, true);
assert.ok(eased > 0 && eased < 100, "smoothing eases toward the target");
let settled = 0;
for (let i = 0; i < 600; i++) settled = plan.smoothCamera(settled, 100, 1 / 60, true);
assert.equal(settled, 100, "smoothing settles exactly, so idle frames do not shimmer");
assert.equal(plan.screenX(1200, 200), 1000, "world to screen is a subtraction");
assert.deepEqual(plan.drawOrder([{ id: "a" }, { id: "me" }, { id: "b" }], "me").map((p) => p.id), ["a", "b", "me"], "the viewer paints last");
assert.deepEqual(plan.drawOrder([], "me"), [], "an empty room draws nobody");

// LRU helpers used by the text-layout caches.
const lru = new Map();
plan.lruSet(lru, "a", 1, 2); plan.lruSet(lru, "b", 2, 2);
assert.equal(plan.lruGet(lru, "a"), 1);
plan.lruSet(lru, "c", 3, 2);
assert.equal(lru.has("b"), false, "the least recently used entry is evicted");
assert.equal(lru.has("a"), true, "a read keeps an entry alive");

// ------------------------------------------------------------------- bands --
assert.equal(BANDS[0], "sky", "sky is furthest back");
assert.equal(BANDS.at(-1), "mask", "the lantern mask and grade are painted last");
for (const pair of [["interior", "facade"], ["facade", "outsideActor"], ["cageBack", "cageFront"], ["station", "bell"]]) {
  assert.ok(BANDS.indexOf(pair[0]) < BANDS.indexOf(pair[1]), `${pair[0]} draws before ${pair[1]}`);
}

// ------------------------------------------------------------------- scene --
let drawn = [];
const node = (band, x, span, label, screen = false) => ({ band, x, span, label, screen, draw: () => drawn.push(label) });
const scene = new Scene();
scene.add(node("outsideActor", 5000, 20, "far actor"));
scene.add(node("outsideActor", 100, 20, "near actor"));
scene.add(node("sky", 0, 0, "sky", true));
scene.add(node("facade", 120, 200, "facade"));
scene.add(node("mask", 0, 0, "mask", true));
const visibleAtHome = scene.visible(0, 800);
assert.deepEqual(visibleAtHome.map((n) => n.label), ["sky", "facade", "near actor", "mask"], "culled, then ordered back to front");
for (const n of visibleAtHome) n.draw();
assert.deepEqual(drawn, ["sky", "facade", "near actor", "mask"], "the frame loop is one generic pass");
drawn = [];
const farView = scene.visible(4600, 800);
assert.deepEqual(farView.map((n) => n.label), ["sky", "far actor", "mask"], "walking east reveals a different subset");
const overlap = new Scene();
overlap.add(node("outsideActor", 300, 50, "right"));
overlap.add(node("outsideActor", 100, 50, "left"));
assert.deepEqual(overlap.visible(0, 800).map((n) => n.label), ["left", "right"], "same-band props sort by world x");
const stats = scene.stats(0, 800);
assert.equal(stats.nodes, 5, "the scene reports its size");
assert.equal(stats.visible, 4, "and how many survive culling");
assert.equal(stats.byBand.outsideActor, 2, "counts group by band");
assert.equal(scene.visible(0, 800), scene.visible(0, 800).length ? scene.visible(0, 800) : [], "the visible buffer is reused, not reallocated");
assert.equal(nodesOf("overlay", [{ x: 1, span: 2, draw() {} }, { x: 3, span: 4, draw() {} }]).length, 2, "bulk node helper");
assert.equal(new Scene().visible(0, 800).length, 0, "an empty scene draws nothing");

// The renderer must be a node list, not per-object special cases or baked tiles.
const renderer = readFileSync("src/game/render/index.ts", "utf8");
assert.match(renderer, /for \(const node of this\.scene\.visible/, "one generic draw loop");
assert.match(renderer, /scene\.add\(\{/, "the scene is declared as nodes");
assert.ok(!/createElement\("canvas"\)/.test(renderer), "no offscreen tile baking");
assert.ok(!/paintLayer|tileKey|TileStore/.test(renderer), "no layer-specific caching path");
assert.ok(!/BANDS\.indexOf|band === "sky"/.test(renderer), "the compositor never branches on object type");
assert.match(renderer, /buildScene\(snap\)/, "the list is rebuilt once per snapshot");
assert.match(renderer, /this\.sceneFor === snap/, "an unchanged snapshot rebuilds nothing");
console.log("RENDERER ARCHITECTURE PASSED: camera, bands, culling, ordering, single draw loop, no baked layers");
