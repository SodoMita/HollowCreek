// Frame budget + HUD diff: the two client costs that dominate an idle room.
// Pure modules, no browser: this measures how many canvas frames and how many
// DOM writes a 60-second idle stay would cause.
import assert from "node:assert/strict";
import { build } from "esbuild";
const out = await build({ entryPoints: ["src/game/perf.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { FrameBudget, HudMemo, hudTick, tasksKey, feedKey, voteKey } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

// ---------------------------------------------------------------- budget ----
assert.equal(FrameBudget.intervalFor({ quality: "high" }), 0, "high detail draws every rAF");
assert.equal(FrameBudget.intervalFor({ quality: "medium" }), 32, "medium detail targets 30 fps");
assert.equal(FrameBudget.intervalFor({ quality: "low" }), 48, "low detail targets ~20 fps");
assert.equal(FrameBudget.intervalFor({ quality: "low", overlay: true }), 120, "an overlay drops to ~8 fps");
assert.equal(FrameBudget.intervalFor({ quality: "high", hidden: true }), Infinity, "a hidden tab never draws");
assert.equal(FrameBudget.intervalFor({ quality: "high", reducedMotion: true, idle: true }), 500, "static scene + no data = 2 fps");
assert.equal(FrameBudget.intervalFor({ quality: "high", reducedMotion: true, idle: false }), 0, "a new snapshot always draws");

const frames = (budget, ms, input) => {
  let drawn = 0;
  for (let now = 0; now < ms; now += 1000 / 60) if (budget.shouldRender({ now, ...input })) drawn++;
  return drawn;
};
const high = frames(new FrameBudget(), 1000, { quality: "high" });
const medium = frames(new FrameBudget(), 1000, { quality: "medium" });
const low = frames(new FrameBudget(), 1000, { quality: "low" });
const overlay = frames(new FrameBudget(), 1000, { quality: "high", overlay: true });
const reduced = frames(new FrameBudget(), 1000, { quality: "high", reducedMotion: true, idle: true });
const hidden = frames(new FrameBudget(), 1000, { quality: "high", hidden: true });
assert.ok(high >= 58 && high <= 61, `high detail ~60 fps (${high})`);
assert.ok(medium >= 28 && medium <= 32, `medium detail ~30 fps (${medium})`);
assert.ok(low >= 17 && low <= 21, `low detail ~20 fps (${low})`);
assert.ok(overlay >= 6 && overlay <= 9, `overlay ~8 fps (${overlay})`);
assert.ok(reduced >= 1 && reduced <= 3, `reduced motion idle ~2 fps (${reduced})`);
assert.equal(hidden, 0, "hidden tab draws nothing");
console.log(`frame budget: high ${high} · medium ${medium} · low ${low} · overlay ${overlay} · reduced ${reduced} · hidden ${hidden} frames/s`);

// dt compensation: a 30 fps frame must move as far as two 60 fps frames.
const slow = new FrameBudget();
slow.shouldRender({ now: 0, quality: "medium" });
slow.shouldRender({ now: 33, quality: "medium" });
assert.ok(Math.abs(slow.dtSince(33) - 0.033) < 1e-6, "dt follows the last accepted frame, not the skipped ones");
assert.equal(new FrameBudget().dtSince(9999, 0.016), 0.016, "a fresh budget falls back to the caller's dt");
const longGap = new FrameBudget();
longGap.shouldRender({ now: 1000, quality: "low" });
longGap.shouldRender({ now: 5000, quality: "low" });
assert.equal(longGap.dtSince(5000), 0.1, "a long stall is capped so physics cannot jump");

// reset (tab visible again / settings changed) draws immediately.
const resetBudget = new FrameBudget();
resetBudget.shouldRender({ now: 0, quality: "low" });
assert.equal(resetBudget.shouldRender({ now: 1, quality: "low" }), false);
resetBudget.reset();
assert.equal(resetBudget.shouldRender({ now: 2, quality: "low" }), true, "reset lets the next frame through");
const stats = resetBudget.stats;
assert.equal(stats.drawn, 2);
assert.equal(stats.skipped, 1);

// ----------------------------------------------------------------- memo ----
const memo = new HudMemo();
assert.equal(memo.changed("feed", "same"), true, "first write always lands");
assert.equal(memo.changed("feed", "same"), false, "an identical value is skipped");
assert.equal(memo.changed("feed", "other"), true, "a real change lands");
memo.forget("feed");
assert.equal(memo.changed("feed", "other"), true, "forget forces a repaint after a room change");
assert.equal(memo.changed("tasks", "a"), true);
memo.forget();
assert.equal(memo.changed("tasks", "a"), true, "forget() with no slot clears every region");
assert.deepEqual(memo.stats, { writes: 5, skips: 1 });

// A minute of idle polling (10 Hz) with a frozen snapshot: zero region writes.
const idleMemo = new HudMemo();
const frozen = { phase: "playing", self: { alive: true }, tasks: [], feed: [] };
const frozenKey = JSON.stringify([tasksKey(frozen, true), feedKey(frozen), voteKey(frozen)]);
let idleWrites = 0;
for (let i = 0; i < 600; i++) {
  if (idleMemo.changed("tasks", tasksKey(frozen, true))) idleWrites++;
  if (idleMemo.changed("feed", feedKey(frozen))) idleWrites++;
  if (idleMemo.changed("vote", voteKey(frozen))) idleWrites++;
}
assert.equal(idleWrites, 3, `a frozen minute costs 3 writes, not 1800 (got ${idleWrites})`);
assert.ok(frozenKey.length >= 0);

// --------------------------------------------------------------- hudTick ----
const player = (over = {}) => ({ id: "me", x: 100, alive: true, caged: false, ...over });
const base = (over = {}) => ({
  phase: "playing",
  now: 10_000,
  players: [player()],
  self: { id: "me", role: "crew", alive: true, sabotageCooldownMs: 0, killCooldownMs: 0, blackoutCooldownMs: 0 },
  ...over,
});
assert.deepEqual(hudTick(base()), {}, "crew with no timers has nothing to tick");
const meeting = hudTick(base({
  phase: "meeting",
  meeting: { endsAt: 13_400, inArea: true, reason: "a body" },
  players: [player({ x: 0 })],
}));
assert.equal(meeting.meeting, "Cast your verdict — <b>4s</b>", "the verdict clock is server-clock derived");
const walk = hudTick(base({ phase: "meeting", meeting: { endsAt: 13_400, inArea: false, reason: "a body" } }));
assert.match(walk.meeting, /^Walk to the town square (← west|→ east) — <b>4s<\/b>$/, "a distant player is pointed to the square");
assert.notEqual(hudTick(base({ phase: "meeting", meeting: { endsAt: 13_400, inArea: false }, players: [player({ x: 9999 })] })).meeting, walk.meeting, "the direction follows where the player stands");
const past = hudTick(base({ time: { mode: "past", endsAt: 14_000 } }));
assert.equal(past.status, "In the past · 4s remaining · M to return", "time travel shows its own countdown");
const hollow = hudTick(base({ self: { id: "me", role: "hollow", alive: true, sabotageCooldownMs: 5_000, killCooldownMs: 26_000, blackoutCooldownMs: 4_000 } }));
assert.equal(hollow.ruin, " · 5s", "ruin cooldown is a suffix so the key label can change");
assert.equal(hollow.ability, "26s 🌑4s", "kill and snuff cooldowns share one line");
assert.equal(hudTick(base({ self: { id: "me", role: "hollow", alive: false, sabotageCooldownMs: 1, killCooldownMs: 1, blackoutCooldownMs: 1 } })).ability, undefined, "the dead acquire nothing");
assert.equal(hudTick(base({ phase: "meeting", meeting: { endsAt: 1, inArea: true } })).meeting, "Cast your verdict — <b>0s</b>", "the clock floors at zero");

// Clock-only changes must not dirty the region keys.
const task = { id: "well", name: "Well", done: false, delivered: true, progress: 0.5, sabotaged: false };
const keyA = tasksKey(base({ tasks: [task] }), true);
const keyB = tasksKey(base({ now: 99_999, tasks: [{ ...task }] }), true);
assert.equal(keyA, keyB, "a new clock never dirties the ward list");
const keyC = tasksKey(base({ tasks: [{ ...task, progress: 0.51 }] }), true);
assert.notEqual(keyA, keyC, "real ward progress does");
assert.equal(tasksKey(base({ tasks: [task], phase: "lobby" }), true), "", "no ward list in the lobby");
assert.equal(tasksKey(base({ tasks: [task], self: { id: "me", alive: false } }), true), "", "the dead get no ward list");
assert.notEqual(tasksKey(base({ tasks: [task] }), true), tasksKey(base({ tasks: [task] }), false), "collapsing the list repaints");
assert.notEqual(voteKey(base({ phase: "meeting", meeting: { inArea: true } })), "", "an open verdict is a region");
assert.equal(voteKey(base()), "", "no verdict outside a meeting");
assert.notEqual(feedKey(base({ feed: [{ text: "a" }] })), feedKey(base({ feed: [{ text: "b" }] })), "a new line repaints the feed");
assert.equal(feedKey(base({ feed: [{ text: "a" }] })), feedKey(base({ feed: [{ text: "a" }] })), "an unchanged feed does not");
console.log("PERF PASSED: frame budget, dt compensation, memo, countdown tick, region keys");
