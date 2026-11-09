// Input transport rules (DB-free): the per-soul budget must accept realistic play.
// A player tap-mashing directions plus actions can reach ~20 inputs/s; the old
// 600/min budget throttled them at 10/s and the client silently dropped the keypress.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../src/app/api/game/input/route.ts", import.meta.url), "utf8");
const match = /admit\(req, "input", soul, (\d+), (\d+)\)/.exec(route);
assert.ok(match, "input route limits through admit()");
const perSoul = Number(match[1]);
const perIp = Number(match[2]);
assert.ok(perSoul >= 1200, `per-soul input budget ≥ 20/s (got ${perSoul}/min)`);
assert.ok(perIp >= perSoul * 2, `per-address backstop above the per-soul budget (${perIp} vs ${perSoul})`);

const client = readFileSync(new URL("../static-src/main.ts", import.meta.url), "utf8");
assert.ok(/inputFlight/.test(client), "client keeps one input request in flight");
assert.ok(/queued/.test(client), "client coalesces steering to the newest state");
assert.ok(/Slow down\." && retry/.test(client), "client retries a throttled steering input");
assert.ok(/inputFlight\.dropped/.test(client), "client counts dropped inputs instead of failing silently");

// The net HUD must exist and must not be driven from the render loop.
assert.ok(/params\.has\("net"\)/.test(client), "?net=1 exposes the live netcode readout");
assert.ok(/setInterval\(netHud, 250\)/.test(client), "net HUD updates on a timer, not per frame");

console.log(`INPUT BUDGET OK: ${perSoul}/min per soul (${(perSoul / 60).toFixed(0)}/s), ${perIp}/min per address; client coalesces, retries and counts drops`);
