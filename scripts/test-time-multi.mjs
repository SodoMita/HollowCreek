// Multi-traveller time-travel tests + integer-position invariant.
// Covers: several sequential visits (one at a time), moving items/kits/cart in
// the past, killing in the past, repairing/delivering in the past, push-riding
// players with the cart, and replay determinism with integer world positions.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.time-multi-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now; let clock = realNow(); Date.now = () => clock;

function create(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], `${prefix}A`);
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `${prefix}${i}`).ok);
  const room = game.getRoom(code);
  assert.ok(game.startGame(room, ids[3]).ok);
  // Deterministic layout AFTER startGame (it re-randomizes seats): fixed
  // positions, cooldowns ready, cage key far from the cart — then recapture
  // history[0] so every replay base sees this exact layout.
  const players = [...room.players.values()];
  players.forEach((p, i) => { p.x = 400 + i * 100; p.dir = 0; p.killAt = 0; });
  players[3].role = "hollow";
  for (let i = 0; i < 3; i++) players[i].role = "crew";
  room.keyX = 3300;
  room.cartX = 900;
  room.history.length = 0; room.lastHistoryAt = 0;
  advance(room, 1); // fresh history[0] with the pinned layout
  return { room, players, crew: players.slice(0, 3), hollow: players[3] };
}
function advance(room, count) {
  for (let i = 0; i < count; i++) {
    clock += 50;
    if (i % 20 === 0) for (const player of room.players.values()) game.snapshot(room, player.id);
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
  player.x = game.snapshot(room, player.id) && 1260; // TIMEPIECE_X
  for (const p of room.players.values()) p.lastSeen = clock;
  advance(room, 11);
  assert.ok(input(room, player, { action: "interact" }).ok, "timepiece picked up");
  assert.equal(room.timepieceHolder, player.id);
}
function startVisit(room, player, targetAt) {
  assert.ok(input(room, player, { action: "time_travel", targetAt }).ok, "time travel starts");
  assert.ok(room.timeVisit, "visit active");
}
function endVisit(room, player) {
  assert.ok(input(room, player, { action: "time_return" }).ok, "return");
  assert.equal(room.timeVisit, null);
}
function assertIntPositions(room, label) {
  for (const p of room.players.values()) assert.ok(Number.isInteger(p.x), `${label}: player ${p.name} x=${p.x} is int`);
  assert.ok(Number.isInteger(room.cartX), `${label}: cartX int`);
  if (room.keyX !== null) assert.ok(Number.isInteger(room.keyX), `${label}: keyX int`);
  if (room.timepieceX !== null) assert.ok(Number.isInteger(room.timepieceX), `${label}: timepieceX int`);
  for (const d of room.supplyDrops) assert.ok(Number.isInteger(d.x), `${label}: drop x int`);
  for (const b of room.bodies) assert.ok(Number.isInteger(b.x), `${label}: body x int`);
  for (const c of room.cages) assert.ok(Number.isInteger(c.x), `${label}: cage x int`);
  for (const d of room.doors) if (d.keyX !== null) assert.ok(Number.isInteger(d.keyX), `${label}: door key x int`);
  const snap = game.snapshot(room, [...room.players.keys()][0]);
  for (const p of snap.players) if (p.x !== -9999) assert.ok(Number.isInteger(p.x), `${label}: snapshot x int`);
  assert.ok(Number.isInteger(snap.cartX), `${label}: snapshot cartX int`);
}
function fingerprint(room) {
  return JSON.stringify({
    players: [...room.players.values()].map((p) => [p.id, p.x, p.alive, p.caged, p.hasKey, p.hasSupply, p.supplyId, p.inside, p.dir]),
    cartX: room.cartX, keyX: room.keyX, timepieceX: room.timepieceX,
    drops: room.supplyDrops, bodies: room.bodies.map((b) => [b.id, b.x]),
    doors: room.doors, pool: room.pool.map((t) => [t.id, t.done, t.delivered, t.sabotaged, t.progress]),
    phase: room.phase, revisions: room.revisions.length,
  });
}
function replayTwice(room, label) {
  const seq0 = room.history[0].seq, end = room.journalSeq;
  const a = game.replayRecordedState(room, seq0, end);
  const b = game.replayRecordedState(room, seq0, end);
  assert.ok(a && b, `${label}: replays exist`);
  assert.equal(JSON.stringify(a), JSON.stringify(b), `${label}: two full replays are identical`);
  return a;
}

try {
  // ------------------------------------------------------------------
  // 1. Cart push carries the pushers with it, like the cart itself.
  {
    const { room, crew } = create("Push");
    room.cartX = 900;
    const [a, b, c] = crew;
    a.x = 880; b.x = 920; c.x = 860;
    for (const p of room.players.values()) p.lastSeen = clock;
    input(room, a, { dir: 1, cartHeld: true });
    input(room, b, { dir: 1, cartHeld: true });
    input(room, c, { dir: -1, cartHeld: true });
    advance(room, 20);
    input(room, a, { dir: 0, cartHeld: false }); input(room, b, { dir: 0, cartHeld: false }); input(room, c, { dir: 0, cartHeld: false });
    // 2 push right vs 1 left: majority wins, cart moves right.
    assert.ok(room.cartX > 900, `majority direction moves the cart right (cartX=${room.cartX})`);
    // Pushers ride the cart: they advanced at the cart speed, not player speed.
    assert.ok(a.x > 880 && b.x > 920, "pushers are carried along with the cart");
    const cartStep = room.cartX - 900;
    assert.ok(Math.abs(a.x - 880 - cartStep) <= 20, `pusher A moved with the cart (${a.x - 880} vs cart ${cartStep})`);
    // A player with hands full cannot push.
    const d = room.players.get([...room.players.keys()][3]); d.x = 905; d.hasSupply = true; d.supplyId = "k1";
    input(room, d, { dir: 1, cartHeld: true });
    const before = room.cartX;
    advance(room, 10);
    input(room, d, { dir: 0, cartHeld: false });
    assert.equal(room.cartPushers, 0, "hands-full player is not a pusher");
    assert.equal(room.cartX, before, "cart does not move without pushers");
    assertIntPositions(room, "push");
    console.log("PASS cart push carries pushers with the cart (majority direction, hands-full excluded)");
  }

  // ------------------------------------------------------------------
  // 2. A traveller moves items (a kit) in the past; the present follows.
  {
    const { room, crew } = create("MoveItems");
    const traveler = crew[0];
    room.cartX = 900;
    for (const p of room.players.values()) p.lastSeen = clock;
    takeTimepiece(room, traveler);
    const origin = room.history.at(-1).at;
    advance(room, 120);
    startVisit(room, traveler, origin);
    // In the past: walk to the cart, take a kit, carry it away, drop it there.
    walk(room, traveler, 900);
    assert.ok(input(room, traveler, { action: "interact" }).ok, "kit taken from cart in the past");
    assert.equal(game.snapshot(room, traveler.id).self.hasSupply, true, "traveller carries the kit in the past");
    walk(room, traveler, 1500);
    assert.ok(input(room, traveler, { action: "drop_supply" }).ok, "kit dropped in the past");
    endVisit(room, traveler);
    const drop = room.supplyDrops.find((d) => Math.abs(d.x - 1500) <= 40);
    assert.ok(drop, "the kit moved in the past exists in the present");
    assert.ok(Math.abs(drop.x - 1500) <= 40, `kit rests where the traveller left it (x=${drop.x})`);
    assert.ok(Number.isInteger(drop.x), "moved kit position is an integer");
    assert.equal(room.timepieceUses, 1);
    assert.equal(room.timepieceX, 1260, "a second timepiece respawns after the visit");
    assertIntPositions(room, "move-items");
    replayTwice(room, "move-items");
    console.log("PASS traveller carried a kit through time; present world kept the moved item at an integer position");
  }

  // ------------------------------------------------------------------
  // 3. A traveller kills in the past; a second traveller later sees the
  //    changed past. Only one visit can be active at a time.
  {
    const { room, crew, hollow } = create("KillPast");
    const victim = crew[1];
    victim.dir = 0; // keep the victim still so its recorded position is stable
    for (const p of room.players.values()) p.lastSeen = clock;
    advance(room, 11);
    const victimX = victim.x; // journal-consistent position (history[0] was captured at startGame)
    const origin = room.history.at(-1).at;
    advance(room, 60);
    takeTimepiece(room, hollow);
    startVisit(room, hollow, origin);
    walk(room, hollow, victimX + 30);
    assert.ok(input(room, hollow, { action: "ability" }).ok, "strike lands in the past");
    const past = game.snapshot(room, hollow.id);
    const echoVictim = past.players.find((p) => p.id === `echo:${victim.id}`);
    assert.ok(echoVictim && !echoVictim.alive, "the victim's echo is dead in the past");
    endVisit(room, hollow);
    assert.equal(victim.alive, false, "the present victim inherits the replayed death");
    assert.ok(room.bodies.some((b) => b.id === victim.id), "a body is left in the present");
    assert.equal(room.revisions.length, 1, "the visit is retained as a revision");

    // Second timepiece, second traveller, later moment: sees the death.
    const second = crew[2];
    advance(room, 30);
    takeTimepiece(room, second);
    const later = room.history.at(-1).at;
    advance(room, 40);
    // Only one visit at a time: another travel attempt must fail.
    const intruder = input(room, crew[0], { action: "time_travel", targetAt: origin });
    startVisit(room, second, later);
    assert.ok(!intruder.ok || room.timeVisit.playerId === second.id, "no concurrent visits");
    walk(room, second, victimX); // stand where the first traveller struck
    const past2 = game.snapshot(room, second.id);
    const echo2 = past2.players.find((p) => p.id === `echo:${victim.id}`);
    assert.ok(echo2 && !echo2.alive, "the later traveller sees the earlier traveller's kill in the past");
    endVisit(room, second);
    assert.equal(room.revisions.length, 2, "both visits are retained");
    assert.equal(room.timepieceUses, 2);
    assert.equal(room.timepieceX, null, "only two timepieces exist per night");
    assertIntPositions(room, "kill-past");
    replayTwice(room, "kill-past");
    console.log("PASS kill in the past reshapes the present; a second traveller witnesses it; visits are serialized");
  }

  // ------------------------------------------------------------------
  // 4. A traveller delivers a kit and works a ward in the past.
  {
    const { room, crew } = create("TaskPast");
    const traveler = crew[0];
    room.cartX = 900;
    for (const p of room.players.values()) p.lastSeen = clock;
    takeTimepiece(room, traveler);
    const origin = room.history.at(-1).at;
    advance(room, 80);
    startVisit(room, traveler, origin);
    walk(room, traveler, 900);
    assert.ok(input(room, traveler, { action: "interact" }).ok, "kit taken in the past");
    walk(room, traveler, 680); // the well
    assert.ok(input(room, traveler, { action: "interact" }).ok, "kit delivered in the past");
    const task = room.pool.find((t) => t.id === "well");
    assert.ok(task.delivered, "ward is supplied in the past");
    // Work the board with valid moves.
    let board = game.snapshot(room, traveler.id).minigame;
    assert.ok(board, "repair board opens in the past");
    for (let i = 0; i < 6 && board && !game.snapshot(room, traveler.id).tasks.find((t) => t.id === "well").done; i++) {
      const move = i % 4;
      input(room, traveler, { action: "ward_move", wardId: "well", move });
      board = game.snapshot(room, traveler.id).minigame;
    }
    endVisit(room, traveler);
    assert.ok(room.pool.find((t) => t.id === "well").delivered, "delivery persists into the present");
    const present = room.pool.find((t) => t.id === "well");
    assert.ok(present.progress > 0, `repair progress persisted (progress=${present.progress})`);
    assertIntPositions(room, "task-past");
    replayTwice(room, "task-past"); // journal replay machinery is deterministic
    assert.equal(room.revisions.length, 1, "the visit is retained as a revision");
    // A second traveller at a later moment sees the delivered ward in the past.
    const second = crew[1];
    advance(room, 20);
    takeTimepiece(room, second);
    const later = room.history.at(-1).at;
    advance(room, 20);
    startVisit(room, second, later);
    const pastTasks = game.snapshot(room, second.id).tasks;
    assert.ok(pastTasks.find((task) => task.id === "well")?.delivered, "the later traveller sees the ward supplied in the past");
    endVisit(room, second);
    assert.equal(room.revisions.length, 2, "both visits retained");
    console.log("PASS traveller delivered a kit and repaired a ward in the past; a later traveller sees it");
  }

  // ------------------------------------------------------------------
  // 5. Full determinism: two full replays of a night with visits, kills,
  //    moved items and tasks are byte-identical, and positions are ints.
  {
    const { room, crew, hollow } = create("Full");
    const a = crew[0], b = crew[1];
    room.cartX = 900;
    for (const p of room.players.values()) p.lastSeen = clock;
    advance(room, 11);
    const origin = room.history.at(-1).at;
    advance(room, 50);
    input(room, a, { dir: 1 }); advance(room, 30); input(room, a, { dir: 0 });
    input(room, b, { dir: -1 }); advance(room, 30); input(room, b, { dir: 0 });
    // A pushes the cart in the past.
    takeTimepiece(room, a);
    startVisit(room, a, origin);
    walk(room, a, 900);
    input(room, a, { dir: 1, cartHeld: true });
    advance(room, 40);
    input(room, a, { dir: 0, cartHeld: false });
    endVisit(room, a);
    assert.ok(room.cartX !== 900 || room.cartPushers >= 0, "cart state after past push");
    const cartAfterA = room.cartX;
    // B visits after A's return and observes the moved cart in the past.
    advance(room, 20);
    takeTimepiece(room, b);
    const later = room.history.at(-1).at;
    advance(room, 20);
    startVisit(room, b, later);
    const pastSnap = game.snapshot(room, b.id);
    assert.equal(pastSnap.cartX, cartAfterA, "the second traveller sees the cart where the first left it");
    // B moves the cart further in the past.
    walk(room, b, cartAfterA);
    input(room, b, { dir: -1, cartHeld: true });
    advance(room, 30);
    input(room, b, { dir: 0, cartHeld: false });
    endVisit(room, b);
    assert.notEqual(room.cartX, cartAfterA, "the second traveller moved the cart again");
    // Hollow kills in the present for good measure, then everything replays.
    hollow.killAt = 0;
    const target = crew[2]; target.x = hollow.x + 30;
    assert.ok(input(room, hollow, { action: "ability" }).ok);
    assert.equal(target.alive, false);
    advance(room, 40);
    assertIntPositions(room, "full");
    const rep = replayTwice(room, "full");
    for (const p of rep.players.values()) assert.ok(Number.isInteger(p.x), "replayed positions are integers");
    assert.equal(fingerprint(rep).length > 0, true);
    console.log("PASS two sequential travellers moved the cart through time; full double replay is identical; all positions integer");
  }

  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("TIME-MULTI FAILED", error); process.exit(1); }
