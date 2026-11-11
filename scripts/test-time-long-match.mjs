// Regression: time travel late in a match. journal() evicts old tick entries
// from the front, so a sequence number is not an array index. Replay used to
// read journal[seq] and, after ~90 s of play, found no entries at all — the
// past had nobody acting in it.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.time-long-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports;
let clock = Date.now(); Date.now = () => clock;
const ids = ["L0", "L1", "L2", "L3"];
const code = game.createRoom(ids[0], "LongA");
for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `Long${i}`).ok);
const room = game.getRoom(code);
assert.ok(game.startGame(room, ids[3]).ok);
const tick = (n) => { for (let i = 0; i < n; i++) { clock += game.TICK; for (const p of room.players.values()) p.lastSeen = clock; game.advanceRoomForTest(room, clock); } };
const perSecond = Math.round(1000 / game.TICK);
tick(perSecond * 100); // 100 s of play: old ticks have been evicted
assert.ok(room.journal[0].seq > 1, "the journal has evicted old entries (seq is no longer an index)");
const walker = [...room.players.values()].find((p) => p.role === "crew");
const checkpoint = room.history.at(-1);
assert.ok(game.handleInput(room, { playerId: walker.id, dir: 1 }).ok);
tick(perSecond);
assert.ok(game.handleInput(room, { playerId: walker.id, dir: 0 }).ok);
tick(12);
const visit = { base: checkpoint, originAt: checkpoint.at, startedAt: clock, actions: [], visitorId: "v", initial: walker, playerId: walker.id };
const items = game.timelineItems(room, visit, clock).filter((it) => it.original);
const inputs = items.filter((it) => it.original.kind === "input").length;
const ticks = items.filter((it) => it.original.kind === "tick").length;
assert.equal(inputs, 2, `replay sees both recorded inputs (saw ${inputs})`);
assert.ok(ticks >= perSecond, `replay sees the ticks after the checkpoint (saw ${ticks})`);
assert.ok(items.every((it, i) => i === 0 || it.original.seq > items[i - 1].original.seq), "entries come in seq order");
assert.ok(items[0].original.seq > checkpoint.seq, "nothing from before the checkpoint is replayed");
console.log(`PASS time travel 100 s into a match replays ${inputs} inputs and ${ticks} ticks after the checkpoint`);
process.exit(0);
