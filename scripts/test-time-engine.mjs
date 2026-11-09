// Command-driven causal tests for the cage key and unique repair kits.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.time-engine-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now; let clock = realNow(); Date.now = () => clock;
function makeRoom(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], `${prefix}A`);
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `${prefix}${i}`).ok);
  const room = game.getRoom(code); assert.ok(game.startGame(room, ids[3]).ok);
  return { room, crew: [...room.players.values()].filter((p) => p.role === "crew") };
}
function advance(room, count) {
  const stepMs = game.TICK_MS ?? 50;
  const substeps = Math.max(1, Math.round(50 / stepMs));
  for (let i = 0; i < count * substeps; i++) {
    clock += stepMs;
    if (i % (20 * substeps) === 0) for (const player of room.players.values()) game.snapshot(room, player.id);
    game.advanceRoomForTest(room, clock);
  }
}
function input(room, player, body) { return game.handleInput(room, { playerId: player.id, ...body }); }
function walk(room, player, target) {
  for (let i = 0; i < 1200 && Math.abs(player.x - target) > 18; i++) {
    const dir = player.x < target ? 1 : -1;
    if (player.dir !== dir) input(room, player, { dir });
    advance(room, 1);
  }
  input(room, player, { dir: 0 });
  assert.ok(Math.abs(player.x - target) <= 18, `reached ${target}`);
}
try {
  const a = makeRoom("ReplayCage"), traveler = a.crew[0], locksmith = a.crew[1], prisoner = a.crew[2];
  traveler.x = 1260; locksmith.x = 1200; a.room.keyX = 1200;
  prisoner.caged = true; prisoner.cageIndex = 0; prisoner.x = a.room.cages[0].x; a.room.cages[0].occupant = prisoner.id;
  for (const player of a.room.players.values()) player.lastSeen = clock;
  advance(a.room, 11); const origin = a.room.history.at(-1).at;
  advance(a.room, 200);
  assert.ok(input(a.room, locksmith, { action: "interact" }).ok); assert.equal(locksmith.hasKey, true);
  walk(a.room, locksmith, a.room.cages[0].x + 90);
  assert.ok(input(a.room, locksmith, { action: "interact" }).ok); assert.equal(prisoner.caged, false);
  advance(a.room, 11);
  assert.ok(input(a.room, traveler, { action: "interact" }).ok);
  assert.ok(input(a.room, traveler, { action: "time_travel", targetAt: origin }).ok);
  walk(a.room, traveler, 1200);
  assert.ok(input(a.room, traveler, { action: "interact" }).ok);
  assert.equal(traveler.hasKey, true);
  assert.equal(prisoner.caged, true, "the recorded unlock fails without the stolen key");
  assert.equal(a.room.keyX, null);
  assert.ok(input(a.room, traveler, { action: "time_return" }).ok);
  assert.equal(traveler.hasKey, true);
  console.log("PASS replaying commands invalidates the later cage-key unlock");

  const b = makeRoom("ReplayKit"), visitor = b.crew[0], carrier = b.crew[1];
  visitor.x = 1260; carrier.x = 800; b.room.keyX = 3300;
  b.room.supplyDrops.push({ id: "test-unique-kit", x: 800 });
  for (const player of b.room.players.values()) player.lastSeen = clock;
  advance(b.room, 11); const kitOrigin = b.room.history.at(-1).at;
  advance(b.room, 100);
  assert.ok(input(b.room, carrier, { action: "interact" }).ok); assert.equal(carrier.supplyId, "test-unique-kit");
  walk(b.room, carrier, 680);
  assert.ok(input(b.room, carrier, { action: "interact" }).ok);
  assert.equal(b.room.pool.find((task) => task.id === "well").delivered, true);
  advance(b.room, 11);
  assert.ok(input(b.room, visitor, { action: "interact" }).ok);
  assert.ok(input(b.room, visitor, { action: "time_travel", targetAt: kitOrigin }).ok);
  walk(b.room, visitor, 800);
  assert.ok(input(b.room, visitor, { action: "interact" }).ok);
  assert.equal(visitor.supplyId, "test-unique-kit");
  assert.equal(b.room.pool.find((task) => task.id === "well").delivered, false, "the later delivery fails without the stolen kit");
  assert.ok(input(b.room, visitor, { action: "time_return" }).ok);
  assert.equal(visitor.hasSupply, true);
  console.log("PASS replaying commands invalidates a later delivery of the stolen kit");
  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("TIME ENGINE TEST FAILED", error); process.exit(1); }
