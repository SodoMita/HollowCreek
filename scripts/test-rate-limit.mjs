// Per-player rate limits: people behind one NAT (or one smoke host running
// every test player) must not share a tiny budget, while one address minting
// unlimited identities is still capped.
import assert from "node:assert/strict";
import { build } from "esbuild";
const out = await build({ entryPoints: ["src/server/rate-limit.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { allow, allowPlayer, clientKey } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const req = (ip, header = true) => new Request("http://town.test/api/game/state", header ? { headers: { "x-forwarded-for": ip } } : {});
const scope = `suite-${Date.now()}`;

// 1. clientKey still reads the proxy header and falls back safely.
assert.equal(clientKey(req("203.0.113.9")), "203.0.113.9");
assert.equal(clientKey(req("", false)), "unknown");

// 2. Two players behind one address each get their own strict budget.
for (let i = 0; i < 6; i++) assert.equal(allowPlayer(req("198.51.100.4"), `${scope}-a`, "player-one", 6, 60_000), true, `player one request ${i + 1}`);
assert.equal(allowPlayer(req("198.51.100.4"), `${scope}-a`, "player-one", 6, 60_000), false, "player one is throttled after its own budget");
assert.equal(allowPlayer(req("198.51.100.4"), `${scope}-a`, "player-two", 6, 60_000), true, "a neighbour behind the same NAT is unaffected");
assert.equal(allowPlayer(req("198.51.100.4"), `${scope}-a`, "player-three", 6, 60_000), true, "a third neighbour also starts with a full budget");

// 3. Anonymous traffic falls back to the address bucket.
for (let i = 0; i < 4; i++) allowPlayer(req("198.51.100.77"), `${scope}-b`, undefined, 4, 60_000);
assert.equal(allowPlayer(req("198.51.100.77"), `${scope}-b`, undefined, 4, 60_000), false, "missing playerId still throttles by address");

// 4. The wide address ceiling still stops minted identities.
const capacity = 1, ceiling = Math.max(capacity, 1200) * 4;
for (let i = 0; i < ceiling; i++) assert.equal(allowPlayer(req("203.0.113.200"), `${scope}-c`, `minted-${i}`, capacity, 60_000), true);
assert.equal(allowPlayer(req("203.0.113.200"), `${scope}-c`, "minted-final", capacity, 60_000), false, "the address flood bucket stops unlimited identities");
assert.equal(allowPlayer(req("203.0.113.201"), `${scope}-c`, "fresh-soul", capacity, 60_000), true, "another address is unaffected");

// 5. A different player can never be blocked by another player's exhaustion in
//    a fresh scope (the production case: ten souls polling every 100 ms).
const players = Array.from({ length: 10 }, (_, i) => `soul-${i}`);
let allowed = 0;
for (let poll = 0; poll < 120; poll++) {
  for (const id of players) if (allowPlayer(req("192.0.2.10"), `${scope}-d`, id, 1200, 60_000)) allowed++;
}
assert.equal(allowed, 1200, "ten players behind one address each keep their full 1200/min from a 12-second storm");

// 6. The raw token bucket is unchanged for the non-game routes.
for (let i = 0; i < 3; i++) assert.equal(allow(`${scope}-e`, 3, 60_000), true);
assert.equal(allow(`${scope}-e`, 3, 60_000), false, "raw allow() still exhausts");
console.log("RATE LIMIT PASSED: per-player isolation, address ceiling, anonymous fallback");
