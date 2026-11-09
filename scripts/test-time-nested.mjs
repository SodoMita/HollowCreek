// Nested time travel: taking AND using a timepiece inside the past, nestable
// multiple times, exercised by 4 players in the same night with 10 timepieces
// spawned on the map.
//
// Covers: multi-piece world (10 loose timepieces), pickup in the shadow past,
// time_travel-from-the-past validation (needs a held piece + recorded target),
// rebase semantics (a nested use re-bases the visit at the deeper frame, so
// world state newer than that frame vanishes from the shadow), the nested piece
// being consumed, the recorded revision keeping the time_travel actions, the
// present world being reshaped by the deepest past, later travellers seeing
// earlier travellers' echoes in overlapping windows, and replay determinism.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.time-nested-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now;
const TICK = game.TICK; // one server tick — never a hardcoded millisecond figure
// Each `advance(room, n)` below means "n × 50 ms of night", matching the tick
// grid the suites were written against; it now runs several real ticks per step
// so the counts keep their meaning in both distance and wall time at any rate.
const TICKS_PER_STEP = Math.max(1, Math.round(50 / TICK));
let clock = realNow(); Date.now = () => clock;

function create(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], `${prefix}A`);
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `${prefix}${i}`).ok);
  const room = game.getRoom(code);
  assert.ok(game.startGame(room, ids[3]).ok);
  // Deterministic layout AFTER startGame (it re-randomizes seats).
  const players = [...room.players.values()];
  players.forEach((p, i) => { p.x = 400 + i * 100; p.dir = 0; p.killAt = 0; });
  players[3].role = "hollow";
  for (let i = 0; i < 3; i++) players[i].role = "crew";
  room.keyX = 3300;
  room.cartX = 900;
  return { room, players };
}
function advance(room, count) {
  for (let i = 0; i < count * TICKS_PER_STEP; i++) {
    clock += TICK;
    if (i % TICKS_PER_STEP === 0) for (const player of room.players.values()) game.snapshot(room, player.id);
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
function cursorOf(room) {
  const v = room.timeVisit; if (!v) return clock;
  return Math.min(clock, v.originAt + Math.max(0, clock - v.startedAt));
}
function shadow(room) { return game.simulatePastForTest(room, cursorOf(room)); }
function startVisit(room, player, targetAt) {
  assert.ok(input(room, player, { action: "time_travel", targetAt }).ok, "time travel starts");
  assert.ok(room.timeVisit, "visit active");
}
function endVisit(room, player) {
  assert.ok(input(room, player, { action: "time_return" }).ok, "return");
  assert.equal(room.timeVisit, null);
}
function replayTwice(room, label) {
  const seq0 = room.history[0].seq, end = room.journalSeq;
  const a = game.replayRecordedState(room, seq0, end);
  const b = game.replayRecordedState(room, seq0, end);
  assert.deepEqual(a.timepieces, b.timepieces, `${label}: timepiece replay deterministic`);
  assert.deepEqual([...a.players.values()].map((p) => [p.id, p.x, p.alive]), [...b.players.values()].map((p) => [p.id, p.x, p.alive]), `${label}: players replay identically`);
}
function assertIntPositions(room, label) {
  for (const p of room.players.values()) assert.ok(Number.isInteger(p.x), `${label}: player ${p.name} x=${p.x} is int`);
  assert.ok(Number.isInteger(room.cartX), `${label}: cartX int`);
  if (room.keyX !== null) assert.ok(Number.isInteger(room.keyX), `${label}: keyX int`);
  for (const tp of room.timepieces) assert.ok(Number.isInteger(tp.x), `${label}: timepiece ${tp.id} x int`);
  for (const d of room.supplyDrops) assert.ok(Number.isInteger(d.x), `${label}: drop x int`);
}
function takePresentPiece(room, player) {
  const piece = game.loosePieces(room)[0];
  assert.ok(piece, "a loose timepiece exists in the present");
  player.x = piece.x; player.dir = 0;
  for (const p of room.players.values()) p.lastSeen = clock;
  advance(room, 11);
  assert.ok(input(room, player, { action: "interact" }).ok, "present timepiece picked up");
  assert.equal(game.heldPiece(room, player.id)?.id, piece.id, "player holds the piece");
  return piece.id;
}
/** In the past: walk to a loose shadow piece and take it (retry if an echo took it first). */
function takePastPiece(room, player, label) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const loose = game.loosePieces(shadow(room));
    if (!loose.length) break;
    const piece = loose.reduce((a, b) => (Math.abs(b.x - player.x) < Math.abs(a.x - player.x) ? b : a));
    walk(room, player, piece.x);
    input(room, player, { action: "interact" });
    if (game.snapshot(room, player.id).self.hasTimepiece) {
      const held = game.heldPiece(shadow(room), room.timeVisit.visitorId);
      assert.ok(held && !held.consumed, `${label}: shadow agrees a piece is held`);
      return held.id;
    }
  }
  assert.fail(`${label}: could not take a timepiece in the past`);
}
/** In the past: take a loose shadow piece, then use it to travel deeper. */
function nestDeeper(room, player, targetAt, label) {
  const heldId = takePastPiece(room, player, label);
  let snap = game.snapshot(room, player.id);
  assert.equal(snap.self.hasTimepiece, true, `${label}: the visitor holds a piece in the shadow`);
  assert.ok(input(room, player, { action: "time_travel", targetAt }).ok, `${label}: nested time travel accepted`);
  const last = room.timeVisit.actions.at(-1);
  assert.equal(last.body.action, "time_travel", `${label}: the nested travel is recorded`);
  assert.equal(last.body.targetAt, targetAt, `${label}: recorded target kept`);
  snap = game.snapshot(room, player.id);
  assert.equal(snap.self.hasTimepiece, false, `${label}: the nested piece is spent by the deeper travel`);
  assert.equal(game.heldPiece(shadow(room), room.timeVisit.visitorId), undefined, `${label}: no piece held after nesting`);
  return heldId;
}

try {
  const { room, players } = create("Nest");
  const [A, B, C, D] = players;

  // --- 10 timepieces spawned on the map, all captured into history[0] ------
  for (let i = 1; i < 10; i++) room.timepieces.push({ id: `tp${i}`, x: 1260 + i * 30, holder: null, consumed: false });
  assert.equal(room.timepieces.length, 10, "10 timepieces exist");
  assert.equal(game.loosePieces(room).length, 10, "10 timepieces spawned loose on the map");
  room.history.length = 0; room.lastHistoryAt = 0;
  advance(room, 1); // history[0] carries all 10 pieces
  const F0 = room.history[0];
  assert.equal(F0.timepieces.length, 10, "history[0] recorded all 10 pieces");
  advance(room, 12); // a few early frames (pieces, no marker yet) — frames sample every 500ms
  const deep2 = F0.at + 1;                 // frameAt -> history[0]
  const deep1 = room.history[1].at + 1;    // frameAt -> history[1]
  // Unjournaled world marker between the deep frames and the visit origin:
  // visible from late bases, invisible from the early (rebased) bases.
  room.supplyDrops.push({ id: "marker", x: 1600 });
  advance(room, 40);
  const origin = room.history.at(-1).at;
  assert.ok(origin > deep1 && deep1 > deep2 && deep2 > F0.at, "time ladder ordered");
  assertIntPositions(room, "setup");

  const nestedPlan = new Map([[A.id, 2], [B.id, 2], [C.id, 1], [D.id, 1]]);
  const windows = new Map([[A.id, origin], [B.id, origin + 500], [C.id, origin + 1000], [D.id, origin + 1500]]);
  let prevVisitorId = null;

  for (const player of [A, B, C, D]) {
    const label = player.name;
    const pieceId = takePresentPiece(room, player);
    player.x = 1500; player.dir = 0; // depart from beside the piece row
    const target = windows.get(player.id);
    startVisit(room, player, target);
    const visit = room.timeVisit;

    // Validation: no piece held in the past yet -> nested travel rejected.
    assert.ok(!input(room, player, { action: "time_travel", targetAt: deep1 }).ok, `${label}: nested travel without a past piece rejected`);
    assert.ok(!input(room, player, { action: "time_travel", targetAt: room.history.at(-1).at + 60_000 }).ok, `${label}: travel beyond the recorded night rejected`);
    assert.ok(!input(room, player, { action: "time_travel", targetAt: F0.at - 1 }).ok, `${label}: travel before the first record rejected`);

    // The first visit bases on a late frame (marker visible); once revisions
    // exist every visit bases on history[0], which predates the marker.
    walk(room, player, 1560);
    let snap = game.snapshot(room, player.id);
    if (!prevVisitorId) assert.ok(snap.supplyDrops.includes(1600), `${label}: marker visible in the original past window`);
    else assert.ok(!snap.supplyDrops.includes(1600), `${label}: rebased base (history[0]) predates the marker`);

    // Another traveller's echo, when this visit overlaps an earlier window.
    if (prevVisitorId) {
      const echo = snap.players.find((p) => p.id === `echo:${prevVisitorId}`);
      assert.ok(echo, `${label}: sees the earlier traveller's echo in the overlapping window`);
    }

    // Nest as planned: each nest takes a loose piece in the past and travels deeper.
    const nests = nestedPlan.get(player.id);
    const targets = nests === 2 ? [deep1, deep2] : [deep2];
    const used = [pieceId];
    for (const t of targets) used.push(nestDeeper(room, player, t, label));
    // After the deepest rebase the marker (newer than the deep frame) is gone.
    snap = game.snapshot(room, player.id);
    assert.ok(!snap.supplyDrops.includes(1600), `${label}: rebased visit no longer sees the newer marker`);
    assert.equal(room.timeVisit.actions.filter((a) => a.body.action === "time_travel").length, nests, `${label}: ${nests} nested travel(s) recorded`);

    // Act in the deepest past: haul a kit from the cart and leave it elsewhere.
    walk(room, player, 900);
    assert.ok(input(room, player, { action: "interact" }).ok, `${label}: kit taken from the cart in the deep past`);
    walk(room, player, 1050);
    assert.ok(input(room, player, { action: "drop_supply" }).ok, `${label}: kit dropped in the deep past`);
    endVisit(room, player);

    const revision = room.revisions.at(-1);
    assert.equal(revision.playerId, player.id);
    assert.equal(revision.actions.filter((a) => a.body.action === "time_travel").length, nests, `${label}: revision keeps the nested time_travel actions`);
    const drop = room.supplyDrops.find((d) => Math.abs(d.x - 1050) <= 40);
    assert.ok(drop, `${label}: the kit moved in the deep past exists in the present (x=${drop?.x})`);
    assert.ok(Number.isInteger(drop.x), `${label}: moved kit position is an integer`);
    assert.ok(!room.supplyDrops.some((d) => d.x === 1600), `${label}: the present was reshaped by the rebased past (marker gone)`);
    for (const id of used) {
      const tp = room.timepieces.find((t) => t.id === id);
      assert.ok(tp.consumed && tp.holder === null, `${label}: timepiece ${id} is spent`);
    }
    assert.equal(room.timepieces.length, 10, `${label}: piece conservation — still exactly 10 pieces`);
    prevVisitorId = revision.visitorId;
    assertIntPositions(room, `${label} after return`);
    replayTwice(room, label);
    console.log(`PASS ${label}: nested time travel x${nests} inside the past (visit -> return, world reshaped, echoes chained)`);
  }

  assert.equal(room.revisions.length, 4, "4 travellers visited the same night");
  assert.ok(room.revisions.every((r) => r.actions.some((a) => a.body.action === "time_travel")), "every traveller nested at least once");
  assert.ok(game.usedPieces(room) >= 8, `pieces spent: ${game.usedPieces(room)} of 10 (4 live + nested)`);
  assert.equal(game.loosePieces(room).length + game.usedPieces(room) + room.timepieces.filter((t) => t.holder).length, 10, "all 10 pieces accounted for");
  assert.equal(room.timeVisit, null, "no visit left open");
  assertIntPositions(room, "final");
  replayTwice(room, "final");
  console.log(`PASS nested time travel by 4 players at once with 10 timepieces on the map (used=${game.usedPieces(room)}, loose=${game.loosePieces(room).length})`);
  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("TIME-NESTED FAILED", error); process.exit(1); }
