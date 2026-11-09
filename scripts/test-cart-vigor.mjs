// Regression: vigor must gate and slow cart pushing, exactly as it gates ward work.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.cart-vigor.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now;
const TICK = game.TICK;
let clock = realNow(); Date.now = () => clock;
function create(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], `${prefix}A`);
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `${prefix}${i}`).ok);
  const room = game.getRoom(code); assert.ok(game.startGame(room, ids[3]).ok);
  return { room, players: [...room.players.values()] };
}
function advance(room, count) { for (let i = 0; i < count; i++) { clock += TICK; game.tickRoom(room, clock); } }
const fresh = () => { const r = create("Vig"); r.room.cartX = 2000; for (const p of r.players) { p.x = 2020; p.stamina = 1; p.exhausted = false; p.lastSeen = clock; } return r; };
try {
  // full vigor pushes at the documented solo speed
  {
    const { room, players } = fresh();
    const p = players[0];
    assert.ok(game.handleInput(room, { playerId: p.id, dir: 1, cartHeld: true }).ok);
    const x0 = room.cartX; advance(room, 120); // one second of ticks
    const speed = (room.cartX - x0);
    assert.ok(speed > 30 && speed < 46, `full-vigor cart speed ${speed} px/s should be ~38`);
    console.log(`PASS full vigor pushes the cart at ${speed} px/s (CART_SOLO_SPEED 38)`);
  }
  // low vigor slows the cart
  {
    const { room, players } = fresh();
    const p = players[0];
    p.stamina = 0.15; // half of the 0.3 threshold => ~0.5x speed
    assert.ok(game.handleInput(room, { playerId: p.id, dir: 1, cartHeld: true }).ok);
    const x0 = room.cartX; advance(room, 120);
    const speed = room.cartX - x0;
    assert.ok(speed > 12 && speed < 26, `low-vigor cart speed ${speed} px/s should be ~19 (half)`);
    console.log(`PASS vigor 0.15 slows the cart to ${speed} px/s (about half)`);
  }
  // an exhausted soul cannot push at all
  {
    const { room, players } = fresh();
    const p = players[0];
    p.stamina = 0; p.exhausted = true;
    assert.ok(game.handleInput(room, { playerId: p.id, dir: 1, cartHeld: true }).ok);
    const x0 = room.cartX; advance(room, 120);
    assert.equal(room.cartPushers, 0, "an exhausted soul is not a pusher");
    assert.equal(room.cartX, x0, "the cart does not move for an exhausted pusher");
    console.log("PASS an exhausted soul cannot push the cart");
  }
  // the slowest pusher sets the pace
  {
    const { room, players } = fresh();
    const [a, b] = players;
    b.stamina = 0.15;
    assert.ok(game.handleInput(room, { playerId: a.id, dir: 1, cartHeld: true }).ok);
    assert.ok(game.handleInput(room, { playerId: b.id, dir: 1, cartHeld: true }).ok);
    const x0 = room.cartX; advance(room, 120);
    const speed = room.cartX - x0;
    assert.ok(speed < 46, `two pushers with one tired set the pace to ${speed} px/s (below the fresh two-pusher speed)`);
    assert.ok(speed > 12, `the tired pair still moves the cart at ${speed} px/s`);
    console.log(`PASS the tired pusher sets the pace: ${speed} px/s for two pushers, one at 0.15 vigor`);
  }
  console.log("CART VIGOR PASSED");
  process.exit(0); // the room tick scheduler keeps the event loop alive otherwise
} finally { try { require("node:fs").unlinkSync(filename); } catch {} }
