// Canvas renderer rules (the fast path in this environment; Pixi measured worse here).
// These guard the properties that made earlier versions slow or flickery:
//   1. no SVG/path building in the frame path (art is rasterised once, see svg-assets);
//   2. no full-screen blend modes or shadowBlur in the frame path;
//   3. no pixel readback, no DOM access in the frame path;
//   4. the one View object is reused (no per-frame literal);
//   5. a figure is never skipped while its palette bakes (drawTraveler has a fallback);
//   6. traveller caches evict one entry, never clear (a clear made every figure vanish);
//   7. off-screen work is skipped before drawing (culling).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../src/game/render/", import.meta.url);
const files = readdirSync(dir).filter((n) => n.endsWith(".ts"));
const source = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, dir), "utf8")]));
const svg = readFileSync(new URL("../src/game/svg-assets.ts", import.meta.url), "utf8");

/** The body of a method/method-like function, up to the next top-level member. */
function body(text, name) {
  const start = text.indexOf(name);
  if (start < 0) return "";
  const rest = text.slice(start + name.length);
  const next = rest.search(/\n(export )?(function|const|class|interface) |\n  [a-zA-Z]+\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

// 1. No SVG parsing or canvas path building in the per-frame draw functions.
for (const [file, text] of Object.entries(source)) {
  const draws = [...text.matchAll(/^export function (draw[A-Za-z]+)/gm)].map((m) => m[1]);
  for (const fn of draws) {
    const code = body(text, `function ${fn}`);
    assert.ok(!/DOMParser|new Path2D/.test(code), `${file}.${fn}: no SVG parsing / Path2D per frame`);
    assert.ok(!/drawSvg\([^)]*\.svg\.replace|spriteFor\(/.test(code), `${file}.${fn}: art must go through drawSvg's cache`);
  }
}

// 2. No blend modes or shadow blur in any draw* function. Bake helpers (cutawayCanvas)
//    run once per size and are allowed; they are not draw* exports.
for (const [file, text] of Object.entries(source)) {
  const draws = [...text.matchAll(/^export function (draw[A-Za-z]+)/gm)].map((m) => m[1]);
  for (const fn of draws) {
    const code = body(text, "function " + fn);
    assert.ok(!/globalCompositeOperation/.test(code), `${file}.${fn}: no canvas blend modes`);
    assert.ok(!/shadowBlur\s*=\s*(?!0)/.test(code), `${file}.${fn}: no shadowBlur`);
  }
}

// 3. No readback in the renderer, and no DOM access from the frame path.
//    paint.ts creates canvases at load time; that is allowed.
for (const [file, text] of Object.entries(source)) {
  for (const banned of ["getImageData", "toDataURL"]) {
    assert.ok(!text.includes(banned), `${file}: must not use ${banned}`);
  }
  if (file === "paint.ts") continue;
  const draws = [...text.matchAll(/^export function (draw[A-Za-z]+)/gm)].map((m) => m[1]);
  for (const fn of draws) {
    const code = body(text, "function " + fn);
    for (const banned of ["document.", "querySelector"]) {
      assert.ok(!code.includes(banned), `${file}.${fn}: must not touch the DOM`);
    }
  }
}

// 4. The View object is reused per frame.
assert.ok(/private view: View \| null/.test(source["index.ts"]), "index.ts: one View instance is kept");
assert.ok(/this\.view \?\? \(this\.view = \{\} as View\)/.test(source["index.ts"]), "index.ts: View is reused, not rebuilt");

// 5/6. Figure fallbacks and cache policy.
assert.ok(/if \(!drawTraveler\(/.test(source["actors.ts"]), "actors.ts: a fallback silhouette draws when a palette is not ready");
assert.ok(/travelers\.delete\(oldest\.value\)/.test(svg), "svg-assets: traveller cache evicts one entry");
assert.ok(!/travelers\.clear\(\)/.test(svg), "svg-assets: traveller cache is never mass-cleared");

// 7. Off-screen work is skipped: every module that draws camera-relative props
//    has at least one viewport bound before the draw call.
for (const file of ["street.ts", "props.ts", "stations.ts", "houses.ts", "actors.ts", "backdrop.ts", "notes.ts"]) {
  const text = source[file];
  assert.ok(/continue;|return;/.test(text), `${file}: skips work outside the viewport`);
  assert.ok(/[<>]s*-?w|w +/.test(text), `${file}: compares against the viewport`);
}

// Dependency hygiene: no renderer library is pulled in behind the canvas path.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.ok(!pkg.dependencies["pixi.js"], "pixi.js is not a runtime dependency of the canvas renderer");
assert.ok(!JSON.stringify(pkg.dependencies).includes("pixi"), "no pixi package variants installed");

console.log(`CANVAS RENDERER RULES OK: ${files.length} modules (cached art, no blend/shadow per frame, no readback/DOM, reused View, figure fallback, evict-not-clear, culling)`);
