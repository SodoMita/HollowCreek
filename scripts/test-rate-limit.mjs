// Rate-limit fairness. Several players behind one address (NAT, household,
// proxy with no forwarded IP) must not throttle each other, while one soul
// flooding the server is still stopped. No browser, network or database.
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({ entryPoints: ["src/server/rate-limit.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { admit, allow } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const req = (ip) => new Request("http://local/api/game/state", { headers: ip ? { "x-forwarded-for": ip } : {} });
const run = (n, fn) => { let ok = 0; for (let i = 0; i < n; i++) if (fn()) ok++; return ok; };

// 1. A single soul is capped at its own budget.
const a = req("203.0.113.1");
assert.equal(run(700, () => admit(a, "input", "ROOM:a", 600, 6000)), 600, "one soul gets exactly its per-soul budget");

// 2. Souls sharing one address do not starve each other (the old per-IP bug).
const shared = req("198.51.100.7");
let served = 0;
for (let p = 0; p < 6; p++) served += run(300, () => admit(shared, "state", `ROOM:p${p}`, 1800, 12000));
assert.equal(served, 1800, "six souls at 300 each behind one IP are all served (per-IP cap is 12000)");

// 3. A flood spread across many fake souls still hits the per-IP backstop.
const flood = req("192.0.2.9");
const floodOk = run(13000, (() => { let i = 0; return () => admit(flood, "state", `ROOM:fake${i++}`, 1800, 12000); })());
assert.equal(floodOk, 12000, "per-IP backstop bounds souls spoofed from one address");

// 4. Requests without a forwarded address share a roomy bucket: a whole town fits.
const noProxy = req(null);
assert.equal(run(60005, () => admit(noProxy, "input", "", 600, 6000)), 60000, "unknown address gets ten times the per-IP budget");

// 5. Scopes are independent: exhausting input does not block state.
assert.equal(run(700, () => admit(a, "input", "ROOM:a", 600, 6000)), 0, "input budget for the soul is exhausted");
assert.equal(admit(a, "state", "ROOM:a", 1800, 12000), true, "state budget for the same soul is untouched");

// 6. The primitive still refills on its window.
assert.equal(allow("unit:refill", 1, 10), true);
assert.equal(allow("unit:refill", 1, 10), false);
await new Promise((r) => setTimeout(r, 25));
assert.equal(allow("unit:refill", 1, 10), true, "bucket refills after its window");

console.log("RATE_LIMIT_OK: per-soul budgets, shared-address fairness, spoof backstop, refill");
