// Ordering rules for the authoritative self echo carried by input responses.
import assert from "node:assert/strict";
import { build } from "esbuild";
const out = await build({ entryPoints: ["static-src/self-sync.ts"], bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent" });
const { decideSelfEcho, notePushedPosition } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

// 1. A fresh echo advances the held position.
let state = { posAt: 1000 };
let d = decideSelfEcho(state, { at: 1040, x: 10, drawX: 10.4, facing: 1 });
assert.equal(d.takePosition, true, "newer echo applies its position");
assert.equal(d.posAt, 1040, "newest position stamp advances");
state = { posAt: d.posAt };

// 2. An echo older than a push we already drew must not step us backward,
//    but its intent (facing / inside) is still authoritative and applies.
d = decideSelfEcho(state, { at: 1020, x: 9, drawX: 9.9, facing: -1, inside: "tollhouse" });
assert.equal(d.takePosition, false, "older echo never moves the soul backward");
assert.equal(d.takeIntent, true, "facing/inside still apply — they are not positions");
assert.equal(d.posAt, 1040, "stale echo leaves the position clock alone");

// 3. Equal timestamps are accepted (idempotent, same tick).
assert.equal(decideSelfEcho(state, { at: 1040, x: 10 }).takePosition, true, "same-tick echo is idempotent");

// 4. A rejected steering packet applies nothing at all.
const stale = decideSelfEcho(state, { at: 2000, x: 999, stale: true });
assert.equal(stale.takePosition, false); assert.equal(stale.takeIntent, false);

// 5. Push samples advance the clock; malformed values are ignored.
let push = { posAt: 0 };
notePushedPosition(push, 500); assert.equal(push.posAt, 500);
notePushedPosition(push, 400); assert.equal(push.posAt, 500, "pushes never rewind the position clock");
notePushedPosition(push, undefined); notePushedPosition(push, NaN); assert.equal(push.posAt, 500);

// 6. Missing `at` cannot be ordered, so the echo's position is used as-is.
assert.equal(decideSelfEcho({ posAt: 500 }, { x: 1 }).takePosition, true);

console.log("SELF_SYNC_OK: fresh echoes apply, older echoes keep position but refresh intent, stale rejected, push clock monotonic");
