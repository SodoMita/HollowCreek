// A traveller in the past can see other time travellers (and their own earlier
// incarnation) from another time: earlier visits are revisions woven into the
// replayed timeline, so a cursor inside an earlier visit's window shows that
// visitor as an echo; after the window closes, only the returned original self
// remains visible.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.time-seeing-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now; let clock = realNow(); Date.now = () => clock;

function create(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], `${prefix}A`);
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `${prefix}${i}`).ok);
  const room = game.getRoom(code);
  assert.ok(game.startGame(room, ids[3]).ok);
  const players = [...room.players.values()];
  players.forEach((p, i) => { p.x = 400 + i * 100; p.dir = 0; p.killAt = 0; });
  players[3].role = "hollow";
  for (let i = 0; i < 3; i++) players[i].role = "crew";
  room.keyX = 3300; room.cartX = 900;
  room.history.length = 0; room.lastHistoryAt = 0;
  advance(room, 1);
  return { room, players, crew: players.slice(0, 3), hollow: players[3] };
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
function walk(room, player, target, max = 1100) {
  for (let i = 0; i < max && Math.abs(player.x - target) > 18; i++) {
    const dir = player.x < target ? 1 : -1;
    if (player.dir !== dir) input(room, player, { dir });
    advance(room, 1);
  }
  input(room, player, { dir: 0 });
  assert.ok(Math.abs(player.x - target) <= 18, `reached ${target} from ${player.x}`);
}
function takeTimepiece(room, player) {
  player.x = 1260; // TIMEPIECE_X
  for (const p of room.players.values()) p.lastSeen = clock;
  advance(room, 11);
  assert.ok(input(room, player, { action: "interact" }).ok, "timepiece picked up");
  assert.equal(game.heldPiece(room, player.id)?.holder, player.id);
}
function startVisit(room, player, targetAt) {
  assert.ok(input(room, player, { action: "time_travel", targetAt }).ok, "time travel starts");
  assert.ok(room.timeVisit, "visit active");
}
function endVisit(room, player) {
  assert.ok(input(room, player, { action: "time_return" }).ok, "return");
  assert.equal(room.timeVisit, null);
}

try {
  // ------------------------------------------------------------------
  // 1. B travels to a moment INSIDE A's visit window: A's visiting
  //    incarnation is visible as an echo; A's original self is absent.
  {
    const { room, crew } = create("SeeDuring");
    const A = crew[0], B = crew[1];
    for (const p of room.players.values()) p.lastSeen = clock;
    advance(room, 11);
    const origin = room.history.at(-1).at;
    advance(room, 40);
    takeTimepiece(room, A);
    startVisit(room, A, origin);
    walk(room, A, 1150);          // A's visitor moves in the past
    advance(room, 100);           // stay in the past a while (long visit window)
    const insideWindow = room.timeVisit.originAt + 1000;
    endVisit(room, A);
    assert.equal(room.revisions.length, 1);
    const aVisitorId = room.revisions[0].visitorId;
    assert.ok(aVisitorId.startsWith(`visit:${A.id}:1:`), "revision remembers A's visitor id");

    advance(room, 30);
    takeTimepiece(room, B);
    startVisit(room, B, insideWindow);
    walk(room, B, 1150);          // B walks up to where A's visitor is
    const past = game.snapshot(room, B.id);
    const echoA = past.players.find((p) => p.id === `echo:${aVisitorId}`);
    assert.ok(echoA, "B sees A's incarnation from A's visit window");
    assert.equal(echoA.echo, true, "it is marked as an echo");
    assert.ok(Math.abs(echoA.x - 1150) <= 40, `the echo stands where A walked in the past (x=${echoA.x})`);
    const origA = past.players.find((p) => p.id === A.id || p.id === `echo:${A.id}`);
    assert.ok(!origA, "A's original self is departed from that moment (only the traveller echo remains)");
    endVisit(room, B);
    console.log("PASS a traveller sees another traveller's past incarnation inside that visit's window");
  }

  // ------------------------------------------------------------------
  // 2. B travels to a moment AFTER A's visit ended: the visiting incarnation
  //    is suspended; only A's returned original self is visible.
  {
    const { room, crew } = create("SeeAfter");
    const A = crew[0], B = crew[2];
    for (const p of room.players.values()) p.lastSeen = clock;
    advance(room, 11);
    const origin = room.history.at(-1).at;
    advance(room, 40);
    takeTimepiece(room, A);
    startVisit(room, A, origin);
    walk(room, A, 1150);
    advance(room, 60);
    endVisit(room, A);
    const aVisitorId = room.revisions[0].visitorId;
    const returnedAt = clock; // live timestamp of the "return" journal entry

    advance(room, 30);
    takeTimepiece(room, B);
    // Target a moment after A's return landed in live time: the "return" entry
    // replays, so A's original self is back; the visit window's suspend has
    // already applied, so the visiting incarnation is gone.
    const afterWindow = Math.min(room.history.at(-1).at, returnedAt + 500);
    startVisit(room, B, afterWindow);
    walk(room, B, 1150);
    const past = game.snapshot(room, B.id);
    const suspended = past.players.find((p) => p.id === `echo:${aVisitorId}`);
    assert.ok(!suspended, "after the visit window closes, the traveller incarnation is gone");
    const origA = past.players.find((p) => p.id === `echo:${A.id}`);
    assert.ok(origA && origA.alive, "A's returned original self is visible again in the past");
    assert.ok(Math.abs(origA.x - 1150) <= 60, `A's self stands where the visit left it (x=${origA.x})`);
    endVisit(room, B);
    console.log("PASS after the window closes only the returned self remains visible (incarnation suspended)");
  }

  // ------------------------------------------------------------------
  // 3. A traveller sees their OWN earlier incarnation: A uses the second
  //    timepiece and travels back into the window of A's own first visit.
  {
    const { room, crew } = create("SeeSelf");
    const A = crew[0];
    for (const p of room.players.values()) p.lastSeen = clock;
    advance(room, 11);
    const origin = room.history.at(-1).at;
    advance(room, 40);
    takeTimepiece(room, A);
    startVisit(room, A, origin);
    walk(room, A, 1150);
    advance(room, 80);
    const insideFirstVisit = room.timeVisit.originAt + 800;
    endVisit(room, A);
    assert.equal(game.usedPieces(room), 1);
    assert.ok(game.loosePieces(room).some((tp) => tp.x === 1260), "second timepiece respawned");
    const firstVisitorId = room.revisions[0].visitorId;

    advance(room, 20);
    takeTimepiece(room, A);        // same soul takes the respawned timepiece
    assert.equal(game.heldPiece(room, A.id)?.holder, A.id);
    startVisit(room, A, insideFirstVisit);
    walk(room, A, 1150);
    const past = game.snapshot(room, A.id);
    assert.equal(past.self.id, A.id, "the current visit shows as self");
    const ownEcho = past.players.find((p) => p.id === `echo:${firstVisitorId}`);
    assert.ok(ownEcho, "A sees their own earlier incarnation from the first visit");
    assert.equal(ownEcho.echo, true);
    assert.ok(ownEcho.id.includes(A.id), "the echo id ties back to A's own first visitor id");
    assert.ok(Math.abs(ownEcho.x - 1150) <= 40, `own past self stands where A walked then (x=${ownEcho.x})`);
    endVisit(room, A);
    assert.equal(game.usedPieces(room), 2);
    console.log("PASS a traveller can see their own incarnation from an earlier visit (self from another time)");
  }

  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("TIME-SEEING FAILED", error); process.exit(1); }
