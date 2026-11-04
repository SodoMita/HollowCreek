// Deterministic replay must reproduce an unchanged recorded night exactly.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.replay-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now; let clock = realNow(); Date.now = () => clock;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = async (ms = 55) => { clock += ms; await sleep(60); };
try {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], "ReplayA");
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `Replay${i}`).ok);
  const room = game.getRoom(code); assert.ok(game.startGame(room, ids[3]).ok);
  const worker = [...room.players.values()].find((p) => p.role === "crew");
  worker.x = 900; room.keyX = 3300; room.cartX = 900;
  await tick(600); const checkpoint = room.history.at(-1);
  assert.ok(game.handleInput(room, { playerId: worker.id, action: "interact" }).ok);
  assert.equal(worker.hasSupply, true);
  assert.ok(game.handleInput(room, { playerId: worker.id, dir: -1 }).ok);
  for (let i = 0; i < 26; i++) { await tick(); game.snapshot(room, worker.id); }
  assert.ok(game.handleInput(room, { playerId: worker.id, dir: 0 }).ok);
  assert.ok(game.handleInput(room, { playerId: worker.id, action: "interact" }).ok);
  let board = game.snapshot(room, worker.id).minigame; assert.equal(board?.kind, "well");
  for (let i = 0; i < 5; i++) {
    assert.ok(game.handleInput(room, { playerId: worker.id, action: "ward_move", wardId: "well", move: i % 2 }).ok);
  }
  await tick(600); const final = room.history.at(-1);
  const replay = game.replayRecordedState(room, checkpoint.seq, final.seq); assert.ok(replay);
  const pick = (p) => ({ id: p.id, x: p.x, dir: p.dir, alive: p.alive, caged: p.caged, inside: p.inside, hasKey: p.hasKey, hasSupply: p.hasSupply, supplyId: p.supplyId, stamina: p.stamina, activeWard: p.activeWard, actionText: p.actionText, actionUntil: p.actionUntil, lastSeen: p.lastSeen, match: p.match });
  assert.deepEqual([...replay.players.values()].map(pick), final.players.map(pick));
  assert.deepEqual(replay.pool, final.pool);
  assert.deepEqual(replay.doors, final.doors);
  assert.deepEqual(replay.supplyDrops, final.supplyDrops);
  assert.equal(replay.keyX, final.keyX); assert.equal(replay.cartX, final.cartX);
  assert.deepEqual(replay.timepieces, final.timepieces);
  assert.deepEqual(replay.feed, final.feed);
  console.log("PASS recorded inputs, movement ticks, kit identities and puzzle seed replay identically");
  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("REPLAY DETERMINISM FAILED", error); process.exit(1); }
