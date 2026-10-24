// Minimal DOM-contract test without a browser dependency. Ensures every ward
// presents an actual, labelled button and that polling does not wipe its board.
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/game/ward-ui.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const data = Buffer.from(bundle.outputFiles[0].text).toString("base64");
const { WardPanel } = await import(`data:text/javascript;base64,${data}`);
const logic = await build({ entryPoints: ["src/game/wards.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const puzzle = await import(`data:text/javascript;base64,${Buffer.from(logic.outputFiles[0].text).toString("base64")}`);

let renderCount = 0;
let root;
const makeElement = (tag) => {
  const listeners = {};
  let html = "";
  const el = {
    tagName: tag.toUpperCase(), listeners, hidden: false,
    dataset: {},
    setAttribute() {}, addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; }, remove() {},
    querySelector(selector) {
      if (selector === "[data-ward-vigor]") return { textContent: "" };
      if (selector.startsWith("[data-ward-move")) return { focus() {} };
      return null;
    },
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; renderCount++; },
  };
  if (tag === "div") root = el;
  return el;
};
globalThis.document = {
  head: { appendChild() {} },
  getElementById() { return null; },
  createElement: makeElement,
  activeElement: null,
};
const parent = { appendChild() {} };
let opens = 0, closes = 0, lastMove = null;
const panel = new WardPanel(parent, {
  opened() { opens++; }, close() { closes++; },
  move(stationId, index) { lastMove = { stationId, index }; },
});
const kinds = ["pumpkins", "well", "scarecrow", "lantern", "chapel", "mill", "graves", "radio", "silo"];
for (const kind of kinds) {
  const game = puzzle.createWardPuzzle(kind, 1138);
  const view = puzzle.wardView(kind, `Repair ${kind}`, game);
  panel.update(view, 1, false);
  assert.equal(panel.isOpen, true, `${kind} panel opens`);
  assert.ok(root.innerHTML.includes(puzzle.WARD_JOBS[kind].title), `${kind} names its actual job`);
  const indices = [...root.innerHTML.matchAll(/data-ward-move="(\d+)"/g)].map((match) => Number(match[1]));
  assert.ok(indices.length >= 3, `${kind} has interactive repair controls`);
  assert.ok(indices.every((index) => puzzle.validWardMove(game, index)), `${kind} controls are legal server actions`);
  assert.equal(root.innerHTML.match(/aria-label=/g)?.length > 2, true, `${kind} controls are labelled`);
  const before = renderCount;
  panel.update(view, 0.76, false);
  assert.equal(renderCount, before, `${kind} repeated 100ms polls do not replace focused buttons`);
  const button = { dataset: { wardMove: String(indices[0]) } };
  root.listeners.click({ target: { closest(selector) { return selector.includes("data-ward-move") ? button : null; } } });
  assert.deepEqual(lastMove, { stationId: kind, index: indices[0] }, `${kind} click sends tile intent`);
  panel.update(null, 1, false);
  assert.equal(panel.isOpen, false, `${kind} closes when server cancels`);
}
assert.equal(opens, kinds.length);
panel.update(puzzle.wardView("well", "Well", puzzle.createWardPuzzle("well", 5)), 1, false);
root.listeners.click({ target: { closest(selector) { return selector.includes("data-ward-close") ? {} : null; } } });
assert.equal(closes, 1, "Leave button calls the cancel action");
panel.destroy();
console.log(`WARD UI PASSED: ${kinds.length} named, clickable, focus-stable workbenches`);
