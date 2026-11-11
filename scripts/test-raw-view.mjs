// Architectural guard: the multiplayer client displays raw authoritative values.
// No anti-jitter smoothing, interpolation, extrapolation or local prediction.
// Development needs network problems to be visible, not cosmetically hidden.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const main = codeOnly(read("static-src/main.ts"));
const renderer = codeOnly(read("src/game/render/index.ts"));
const actors = codeOnly(read("src/game/render/actors.ts"));
const settings = read("src/game/settings.ts");
const transport = codeOnly(read("static-src/input-transport.ts"));

assert.ok(main.includes("displayX.set(p.id, p.drawX ?? p.x)"), "players are drawn at the server-supplied position");
assert.ok(main.includes("p.drawX"), "the client consumes the server's precise position");
for (const banned of ["displayX.set(p.id, cur", "(targetX - cur)", "lastDir * spd", "selfAckX", "setInterval(poll"]) {
  assert.ok(!main.includes(banned), `client must not synthesize motion: found ${banned}`);
}
assert.ok(!/\bSPEED\b/.test(main), "the client must not own a movement speed constant");

assert.ok(renderer.includes("this.cameraX = targetCam"), "camera equals the authoritative target each frame");
assert.ok(!renderer.includes("cameraX +="), "camera must never ease toward the target");
assert.ok(!settings.includes("cameraSmoothing"), "no smoothing option may be exposed or normalized");
assert.ok(!actors.includes("shownX +"), "figures must not advance beyond the supplied x");
assert.ok(!actors.includes("(target - cur)"), "no display easing on figures");
assert.ok(main.includes("netStats.drawnStill"), "raw-view diagnostics count unchanged drawn frames");
assert.ok(main.includes("sample age"), "raw-view diagnostics report newest-sample age");
assert.ok(!transport.includes("keepalive: true"), "steering must not use the beacon keepalive pool");

console.log("RAW_VIEW_OK: no smoothing/interpolation/prediction; raw server positions, snapping camera, visible-jitter diagnostics");
