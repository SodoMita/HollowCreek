// Pixi renderer rules. The renderer must not:
//   1. parse SVG or build paths in the frame loop (art is rasterised once at load);
//   2. redraw gradients/shadows/filters per frame (they are baked layers);
//   3. clear or copy the full canvas in the frame loop;
//   4. read pixels back;
//   5. touch the DOM per frame;
//   6. allocate inside the frame loop (no array/object literals in update methods).
// This test reads the render modules and asserts those properties. Pixel-exactness of
// the scene is covered by the browser bench (scripts/bench-client.mjs).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../src/game/render/${name}`, import.meta.url), "utf8");
const files = readdirSync(new URL("../src/game/render/", import.meta.url)).filter((n) => n.endsWith(".ts"));
const source = Object.fromEntries(files.map((f) => [f, read(f)]));

// 1. No SVG parsing or canvas path building in any per-frame update method.
//    Load-time bakes (bakedTexture callbacks) are allowed to draw once.
const methodBody = (text, name) => {
  const start = text.indexOf(name);
  if (start < 0) return "";
  const rest = text.slice(start + name.length);
  const next = rest.search(/\n  (private |)[a-zA-Z]+\([^)]*\): [a-zA-Z]/);
  return next < 0 ? rest : rest.slice(0, next);
};
for (const [file, text] of Object.entries(source)) {
  const frameCode = methodBody(text, "update(v: View") + methodBody(text, "updatePlayer(");
  assert.ok(!/DOMParser|new Path2D|\.beginPath\(|\.arc\(/.test(frameCode), `${file}: no canvas path building in the frame path`);
  assert.ok(!/drawSvg|spriteFor|drawTraveler/.test(frameCode) || file === "textures.ts", `${file}: no direct SVG drawing in the frame path`);
}

// 2. No gradient/shadow creation inside per-frame methods: bakes own them.
for (const file of ["statics.ts", "actors.ts", "fx.ts"]) {
  const frameCode = methodBody(source[file], "update(v: View") + methodBody(source[file], "updatePlayer(")
    + (file === "fx.ts" ? methodBody(source[file], "updateLeaves(") + methodBody(source[file], "updateOverlay(") : "");
  assert.ok(!/createLinearGradient|createRadialGradient|shadowBlur|createPattern/.test(frameCode.replace(/bakeTextureUncached[\s\S]*?\n      \}\);/, "")),
    `${file}: no gradients, patterns or shadows created in the frame path`);
}
assert.ok(/bakeTextureUncached|bakedTexture/.test(source["fx.ts"]), "fx: layers come from baked textures");

// 3/4/5. The frame path must not clear/copy the canvas, read pixels or touch the DOM.
const framePath = source["index.ts"].slice(source["index.ts"].indexOf("  render("));
for (const banned of ["clearRect", "getImageData", "toDataURL", "document.", "querySelector"]) {
  assert.ok(!framePath.includes(banned), `index.ts render(): must not use ${banned}`);
}
assert.ok(/app\.render\(\)/.test(framePath), "index.ts render(): presents through Pixi");
assert.ok(source["index.ts"].includes("off-screen") || source["statics.ts"].includes("visible"), "culling present");

// 6. Steady-state frame code allocates nothing. Rigs are created lazily on first sight
//    (playerRig(), the pools), which is a one-time cost per entity, not per frame.
for (const file of ["statics.ts", "actors.ts", "fx.ts"]) {
  const frameCode = methodBody(source[file], "update(v: View") + methodBody(source[file], "updatePlayer(");
  const offenders = [...frameCode.matchAll(/new [A-Z][A-Za-z]+\(|=\s*\{\s*\}|=\s*\[\s*\]/g)].map((m) => m[0]);
  assert.equal(offenders.length, 0, `${file}: frame path allocates ${JSON.stringify(offenders)}`);
}
assert.ok(/mutated in place|allocat/i.test(source["view.ts"]), "view object is documented as reused");

// Dependency pinning: pixi from npm, pinned exactly in the lockfile, no CDN URL at runtime.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.match(pkg.dependencies["pixi.js"], /^\d+\.\d+\.\d+$/, "pixi.js is pinned to an exact version");
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.equal(lock.packages["node_modules/pixi.js"].version, pkg.dependencies["pixi.js"], "lockfile matches");
for (const [file, text] of Object.entries(source)) {
  assert.ok(!/https?:\/\/[^"' ]*pixi/.test(text), `${file}: no CDN pixi URL`);
}
const indexHtml = readFileSync(new URL("../static-src/index.html", import.meta.url), "utf8");
assert.ok(!/<script[^>]+https?:/.test(indexHtml), "index.html loads no third-party script");

console.log(`RENDERER RULES OK: ${files.length} modules checked (no per-frame SVG, gradients, canvas copies, pixel reads, DOM or allocation; pixi ${pkg.dependencies["pixi.js"]} pinned)`);
