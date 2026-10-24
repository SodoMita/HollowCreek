// Pure, server-owned proximity voice math. Usage: node scripts/test-voice.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({ entryPoints: ["src/game/voice-range.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const data = Buffer.from(output.outputFiles[0].text).toString("base64");
const { voiceGainFor, voicePanFor, voiceCanHear, VOICE_EARSHOT } =
  await import(`data:text/javascript;base64,${data}`);
assert.equal(voiceGainFor(0), 1);
assert.equal(voiceGainFor(75), 1);
assert.equal(voiceGainFor(VOICE_EARSHOT), 0);
assert.equal(voiceGainFor(VOICE_EARSHOT + 1), 0);
assert.equal(voiceGainFor(Infinity), 0);
assert.equal(voiceGainFor(200, true, false), Math.round(voiceGainFor(200) * 0.65 * 1000) / 1000, "iron muffles cages");
let prev = 2;
for (let d = 0; d <= VOICE_EARSHOT + 250; d += 5) {
  const gain = voiceGainFor(d);
  assert.ok(gain >= 0 && gain <= 1);
  assert.ok(gain <= prev, `volume must fall with distance at ${d}`);
  prev = gain;
}
assert.equal(voicePanFor(0), 0);
assert.equal(voicePanFor(-700), -1);
assert.equal(voicePanFor(700), 1);
assert.equal(voicePanFor(-5000), -1);
assert.equal(voicePanFor(NaN), 0);
assert.ok(voicePanFor(-350) < 0 && voicePanFor(350) > 0);
assert.equal(voiceCanHear(true, true), true);
assert.equal(voiceCanHear(true, false), false);
assert.equal(voiceCanHear(false, true), false);
assert.equal(voiceCanHear(false, false), true);
console.log("VOICE RANGE PASSED: falloff, pan, iron muffling and separate ghost realm");
