// Architecture tests for the rewritten renderer: camera maths, world-tile
// planning, cache keys and the tile store's LRU/byte policy. No browser needed.
import assert from "node:assert/strict";
import { build } from "esbuild";
const load = async (entry) => {
  const out = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};
const plan = await load("src/game/render/plan.ts");
const { TileStore } = await load("src/game/render/tiles.ts");
const { WORLD_MIN, WORLD_MAX } = await load("src/game/buildings.ts");

// ------------------------------------------------------------------ camera --
assert.equal(plan.cameraTarget(1000, 800), 600, "camera centres the look-at point");
assert.equal(plan.cameraTarget(WORLD_MIN, 800), WORLD_MIN, "west end clamps");
assert.equal(plan.cameraTarget(WORLD_MAX, 800), WORLD_MAX - 800, "east end clamps");
assert.equal(plan.cameraTarget(0, WORLD_MAX - WORLD_MIN + 10), (WORLD_MIN + WORLD_MAX - (WORLD_MAX - WORLD_MIN + 10)) / 2, "a world narrower than the view is centred");
assert.equal(plan.smoothCamera(0, 100, 1 / 60, false), 100, "no smoothing snaps to the target");
const eased = plan.smoothCamera(0, 100, 1 / 60, true);
assert.ok(eased > 0 && eased < 100, "smoothing eases toward the target");
let settled = 0;
for (let i = 0; i < 600; i++) settled = plan.smoothCamera(settled, 100, 1 / 60, true);
assert.equal(settled, 100, "smoothing settles exactly, so idle frames do not shimmer");
assert.equal(plan.screenX(1200, 200), 1000, "world to screen is a subtraction");

// -------------------------------------------------------------------- tiles --
const range = plan.tileRange(0, 1920);
assert.ok(range.count >= 4, `a wide screen covers several tiles (${range.count})`);
assert.equal(plan.tileStart(range.first) <= 0 - plan.TILE_W, true, "one tile of slack to the west");
assert.equal(plan.tileStart(range.last) + plan.TILE_W >= 1920 + plan.TILE_W, true, "one tile of slack to the east");
for (let cam = WORLD_MIN; cam < WORLD_MAX; cam += 977) {
  const r = plan.tileRange(cam, 1600);
  const covered = (r.last - r.first + 1) * plan.TILE_W;
  assert.ok(covered >= 1600, `tiles cover the viewport at cam ${cam}`);
  assert.ok(plan.tileStart(r.first) <= cam, `the range starts at or before the camera (${cam})`);
  assert.ok(plan.tileStart(r.last) + plan.TILE_W >= cam + 1600, `the range ends past the viewport (${cam})`);
}
assert.equal(plan.tileRange(0, 0).count <= 3, true, "a zero-width viewport does not enumerate the world");
assert.equal(plan.tileBudget(1920, 900, 1) >= 6, true, "a screen keeps at least six tiles");
assert.equal(plan.tileBudget(3840, 2160, 2) <= 40, true, "a huge retina screen is still bounded");

// --------------------------------------------------------------------- keys --
const facts = { occupied: "tollhouse", stations: "well:2:50:0", doors: "tollhouse:1L" };
const base = { layer: "backdrop", index: 3, h: 900, night: 0.42, quality: "high", scale: 1.5, facts };
const a = plan.tileKey(base);
assert.equal(a, plan.tileKey({ ...base, night: 0.44 }), "night is bucketed, not raw");
assert.notEqual(a, plan.tileKey({ ...base, night: 0.8 }), "a new night bucket rebuilds");
assert.notEqual(a, plan.tileKey({ ...base, facts: { ...facts, occupied: "" } }), "entering a house rebuilds interiors");
assert.notEqual(a, plan.tileKey({ ...base, facts: { ...facts, stations: "well:2:55:0" } }), "ward progress rebuilds stations");
assert.notEqual(a, plan.tileKey({ ...base, facts: { ...facts, doors: "tollhouse:0L" } }), "a door rebuilds facades");
assert.notEqual(a, plan.tileKey({ ...base, quality: "low" }), "detail changes the art");
assert.notEqual(a, plan.tileKey({ ...base, h: 1200 }), "viewport height changes the art");
assert.notEqual(a, plan.tileKey({ ...base, scale: 2 }), "bake scale changes the art");
assert.equal(a, plan.tileKey({ ...base, scale: 1.51 }), "scale is quantised so a pinch does not thrash");
assert.notEqual(a, plan.tileKey({ ...base, index: 4 }), "neighbouring tiles are distinct");
assert.equal(plan.tileKey({ ...base, layer: "facade" }), plan.tileKey({ ...base, layer: "facade", phase: 0.01 }), "facade swing is bucketed");
assert.notEqual(plan.tileKey({ ...base, layer: "facade", phase: 0.2 }), plan.tileKey({ ...base, layer: "facade", phase: 0.6 }), "an opening door rebuilds its facade");

// A still camera on an unchanged scene must reuse every tile.
const stillKeys = Array.from({ length: 60 }, () => plan.tileKey(base));
assert.equal(new Set(stillKeys).size, 1, "a still scene produces one stable key");

// Scene facts are derived from the snapshot, not from players' own hints.
const snapshot = {
  players: [
    { id: "a", inside: "tollhouse", alive: true },
    { id: "b", inside: "orchard", alive: false },
    { id: "me", inside: null, alive: true },
  ],
  tasks: [
    { id: "well", done: false, delivered: true, progress: 0.51, sabotaged: false },
    { id: "hearth", done: true, delivered: false, progress: 1, sabotaged: false },
  ],
  doors: [{ id: "tollhouse", open: true, locked: true }],
};
const derived = plan.sceneFacts(snapshot, [{ id: "tollhouse" }, { id: "orchard" }, { id: "quarry" }]);
assert.equal(derived.occupied, "tollhouse", "a dead soul does not occupy a house");
assert.match(derived.stations, /hearth:1:20:0/, "done stations are encoded");
assert.match(derived.stations, /well:2:10:0/, "progress is bucketed into the station fact");
assert.equal(derived.doors, "tollhouse:1L", "door state and lock are encoded");

// Draw order: the viewer is painted last so they are never hidden by the crowd.
const ordered = plan.drawOrder([{ id: "a" }, { id: "me" }, { id: "b" }], "me");
assert.deepEqual(ordered.map((p) => p.id), ["a", "b", "me"]);
assert.deepEqual(plan.drawOrder([], "me"), [], "an empty room draws nobody");

// ---------------------------------------------------------------- tile store --
let allocations = 0;
const makeSurface = (w, h) => {
  allocations++;
  return { canvas: { width: w, height: h }, ctx: { painted: 0 } };
};
const store = new TileStore({ maxTiles: 4, maxPixels: 10_000_000, create: makeSurface });
let paints = 0;
const paint = () => { paints++; };
const first = store.paint("k1", 100, 100, (surface) => { paint(); surface.ctx.painted++; });
assert.equal(paints, 1, "a miss paints once");
assert.equal(store.paint("k1", 100, 100, () => { paint(); }), first, "a hit returns the same surface");
assert.equal(paints, 1, "a hit does not repaint");
assert.equal(store.stats.hits, 1);
assert.equal(store.stats.misses, 1, "only the uncached lookup counts as a miss");
store.paint("k2", 100, 100, paint);
store.paint("k3", 100, 100, paint);
store.paint("k4", 100, 100, paint);
assert.equal(store.stats.entries, 4, "the entry cap holds");
store.get("k1"); // k1 becomes most recent
store.paint("k5", 100, 100, paint);
assert.equal(store.peek("k1") !== undefined, true, "the recently used tile survives");
assert.equal(store.peek("k2"), undefined, "the least recently used tile is evicted");
assert.ok(store.stats.evictions >= 1);
store.clear();
assert.equal(store.stats.entries, 0, "clear drops everything");
assert.equal(store.stats.pixels, 0, "clear frees the pixel budget");

// Byte budget: a store with a small budget never holds more than it can afford.
const small = new TileStore({ maxTiles: 50, maxPixels: 250_000, create: makeSurface });
for (let i = 0; i < 10; i++) small.paint(`big${i}`, 500, 500, () => {});
assert.ok(small.stats.pixels <= 250_000, "the pixel budget is respected");
assert.ok(small.stats.entries <= 1, "a big tile evicts its predecessors");
const before = allocations;
const huge = new TileStore({ maxTiles: 2, maxPixels: 10_000, create: makeSurface });
huge.paint("giant", 2000, 2000, () => {});
assert.equal(allocations, before + 1, "an over-budget tile is drawn on a scratch surface");
assert.equal(huge.stats.entries, 0, "an over-budget tile is never cached");

// Limits follow the viewport.
const resizable = new TileStore({ maxTiles: 20, maxPixels: 50_000_000, create: makeSurface });
for (let i = 0; i < 8; i++) resizable.paint(`r${i}`, 50, 50, () => {});
resizable.updateLimits(3);
assert.ok(resizable.stats.entries <= 3, "lowering the limit evicts down to it");

// Invalidate by prefix: the renderer drops a whole layer when the viewport moves.
for (let i = 0; i < 3; i++) resizable.paint(`b${i}`, 50, 50, () => {});
for (let i = 0; i < 3; i++) resizable.paint(`f${i}`, 50, 50, () => {});
resizable.updateLimits(40);
resizable.invalidate((key) => key.startsWith("b"));
assert.equal(resizable.stats.entries, 3, "only the invalidated prefix is dropped");

// The renderer source must bake the static layers, not redraw them per frame.
const { readFileSync } = await import("node:fs");
const renderer = readFileSync("src/game/render/index.ts", "utf8");
assert.match(renderer, /this\.paintLayer\("backdrop"/, "backdrop comes from baked tiles");
assert.match(renderer, /this\.paintLayer\("facade"/, "facades come from baked tiles");
const backdropStart = renderer.indexOf('this.paintLayer("backdrop"');
const backdropCall = renderer.slice(backdropStart, renderer.indexOf("});", backdropStart));
assert.ok(/drawGroundProps/.test(backdropCall) && /drawHouseInteriors/.test(backdropCall), "the backdrop tile paints the static world");
assert.ok(!/drawPlayer|drawBody|drawLeaves|drawCartAndKits|drawPinnedNotes/.test(backdropCall), "actors and live props are never baked into a tile");
assert.match(renderer, /const deviceScale = ctx\.getTransform\(\)\.a/, "bake scale follows the device pixel ratio");
console.log("RENDERER ARCHITECTURE PASSED: camera, tile plan, cache keys, LRU/byte budget, bake boundaries");
