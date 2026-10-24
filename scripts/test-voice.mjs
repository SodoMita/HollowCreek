// Proximity voice attenuation math. Usage: node scripts/test-voice.mjs
import assert from "node:assert/strict";
import { build } from "esbuild";
const output = await build({ entryPoints: ["src/game/voice.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const data = Buffer.from(output.outputFiles[0].text).toString("base64");
const { voiceGainFor, voicePanFor, isVoiceAudible, VOICE_FULL_RANGE, VOICE_ZERO_RANGE, VOICE_PAN_RANGE } =
  await import(`data:text/javascript;base64,${data}`);

// full volume up close, silence past earshot, smooth falloff between
assert.equal(voiceGainFor(0), 1);
assert.equal(voiceGainFor(VOICE_FULL_RANGE), 1);
assert.equal(voiceGainFor(VOICE_ZERO_RANGE), 0);
assert.equal(voiceGainFor(VOICE_ZERO_RANGE + 5000), 0);
assert.ok(Math.abs(voiceGainFor((VOICE_FULL_RANGE + VOICE_ZERO_RANGE) / 2) - 0.5) < 1e-9, "midpoint is half volume");
let prev = 2;
for (let d = 0; d <= 3000; d += 25) {
  const g = voiceGainFor(d);
  assert.ok(g >= 0 && g <= 1, `gain in range at ${d}`);
  assert.ok(g <= prev + 1e-12, `gain never rises with distance (at ${d})`);
  prev = g;
}

// stereo placement follows the speaker's side, clamped hard left/right
assert.equal(voicePanFor(0), 0);
assert.equal(voicePanFor(-VOICE_PAN_RANGE), -1);
assert.equal(voicePanFor(VOICE_PAN_RANGE), 1);
assert.equal(voicePanFor(-5000), -1);
assert.equal(voicePanFor(5000), 1);
assert.equal(voicePanFor(NaN), 0);
assert.ok(voicePanFor(-350) < 0 && voicePanFor(350) > 0, "nearby voices lean to their side");

// audibility mirrors speech bubbles: the living hear the living, the dead hear all
assert.equal(isVoiceAudible(true, true), true);
assert.equal(isVoiceAudible(true, false), false);
assert.equal(isVoiceAudible(false, true), true);
assert.equal(isVoiceAudible(false, false), true);
console.log("VOICE MATH PASSED");
