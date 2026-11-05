// Deterministic replay tests: pickups, dependent commands, and traveler consequences.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.command-replay-test.cjs`;
const compiled = new Module(filename); compiled.filename = filename; compiled.paths = Module._nodeModulePaths(process.cwd()); compiled._compile(out.outputFiles[0].text, filename);
const game = compiled.exports, realNow = Date.now; let clock = realNow(); Date.now = () => clock;
function create(prefix) {
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const code = game.createRoom(ids[0], `${prefix}A`);
  for (let i = 1; i < 4; i++) assert.ok(game.joinRoom(code, ids[i], `${prefix}${i}`).ok);
  const room = game.getRoom(code); assert.ok(game.startGame(room, ids[3]).ok);
  const players = [...room.players.values()];
  return { room, crew: players.filter((p) => p.role === "crew"), hollow: players.find((p) => p.role === "hollow") };
}
function advance(room, count) {
  for (let i = 0; i < count; i++) {
    clock += 50;
    if (i % 20 === 0) for (const player of room.players.values()) game.snapshot(room, player.id);
    game.advanceRoomForTest(room, clock);
  }
}
function input(room, player, body) { return game.handleInput(room, { playerId: player.id, ...body }); }
function solveHearth(room, player) {
  assert.ok(input(room, player, { action: "interact" }).ok);
  let board = game.snapshot(room, player.id).minigame; assert.equal(board?.kind, "hearth");
  for (let i = 0; i < 3; i++) while (board.values[i] !== board.targets[i]) {
    assert.ok(input(room, player, { action: "ward_move", wardId: "tollhouse-hearth", move: i }).ok);
    board = game.snapshot(room, player.id).minigame;
  }
  assert.ok(input(room, player, { action: "ward_move", wardId: "tollhouse-hearth", move: 3 }).ok);
}
function walk(room, player, target) {
  for (let i = 0; i < 1200 && Math.abs(player.x - target) > 18; i++) {
    const dir = player.x < target ? 1 : -1;
    if (player.dir !== dir) input(room, player, { dir });
    advance(room, 1);
  }
  input(room, player, { dir: 0 });
  assert.ok(Math.abs(player.x - target) <= 18, `reached ${target}`);
}
function recordedHouseRun(prefix) {
  const test = create(prefix), { room, crew } = test, traveler = crew[0], actor = crew[1];
  traveler.x = 1260; actor.x = -190; room.keyX = 3300;
  for (const player of room.players.values()) player.lastSeen = clock;
  advance(room, 11); const origin = room.history.at(-1).at;
  advance(room, 200); const pickupAt = clock;
  assert.ok(input(room, actor, { action: "interact" }).ok);
  assert.equal(room.doors.find((door) => door.id === "tollhouse").holder, actor.id);
  input(room, actor, { dir: -1 }); advance(room, 12); input(room, actor, { dir: 0 });
  assert.ok(input(room, actor, { action: "interact" }).ok);
  input(room, actor, { dir: -1 }); advance(room, 20); input(room, actor, { dir: 0 });
  assert.equal(actor.inside, "tollhouse"); solveHearth(room, actor);
  assert.equal(room.pool.find((task) => task.id === "tollhouse-hearth").done, true);
  advance(room, 11);
  assert.ok(input(room, traveler, { action: "interact" }).ok);
  assert.equal(game.heldPiece(room, traveler.id)?.holder, traveler.id);
  assert.ok(input(room, traveler, { action: "time_travel", targetAt: origin }).ok);
  return { ...test, traveler, actor, origin, pickupAt };
}
try {
  const observed = recordedHouseRun("ReplaySee");
  assert.ok(observed.room.history.some((frame) => frame.at >= observed.pickupAt && frame.events.some((event) => event.actorId === observed.actor.id && event.type === "door_action")), "checkpoints retain nearby pickup events");
  input(observed.room, observed.traveler, { dir: -1 });
  for (let i = 0; i < 220 && observed.traveler.x > -185 && observed.room.timeVisit; i++) advance(observed.room, 1);
  input(observed.room, observed.traveler, { dir: 0 });
  while (observed.room.timeVisit && observed.room.timeVisit.originAt + (clock - observed.room.timeVisit.startedAt) < observed.pickupAt + 100) advance(observed.room, 1);
  const past = game.snapshot(observed.room, observed.traveler.id);
  const actorEcho = past.players.find((player) => player.id === `echo:${observed.actor.id}`);
  assert.ok(actorEcho?.action?.text.includes("took"), "a nearby echo visibly announces its pickup");
  assert.ok(actorEcho.doorKeys?.includes("tollhouse"), "the echo visibly carries the acquired key");
  assert.ok(past.feed.some((item) => item.text.includes(`${observed.actor.name} took the brass tollhouse key`)), "the past feed identifies who picked up the key");
  assert.equal(past.doors.find((door) => door.id === "tollhouse").keyX, null);
  console.log("PASS historical pickup is replayed and visible on the actor");

  const changed = recordedHouseRun("ReplayEdit");
  input(changed.room, changed.traveler, { dir: -1 });
  for (let i = 0; i < 220 && changed.traveler.x > -185 && changed.room.timeVisit; i++) advance(changed.room, 1);
  input(changed.room, changed.traveler, { dir: 0 });
  assert.ok(input(changed.room, changed.traveler, { action: "interact" }).ok);
  assert.equal(changed.room.doors.find((door) => door.id === "tollhouse").holder, changed.traveler.id);
  assert.equal(changed.actor.inside, null, "recorded movement cannot enter the now-locked house");
  assert.equal(changed.room.pool.find((task) => task.id === "tollhouse-hearth").done, false, "dependent recorded repair no longer succeeds");
  assert.ok(input(changed.room, changed.traveler, { action: "time_return" }).ok);
  assert.equal(changed.room.doors.find((door) => door.id === "tollhouse").holder, changed.traveler.id);
  console.log("PASS edited pickup replays later door, movement and repair commands for the whole town");

  // A later traveler can change a previous traveler's already-returned present.
  const second = changed.crew[2];
  assert.equal(changed.room.revisions.length, 1);
  assert.ok(game.loosePieces(changed.room).some((tp) => tp.x === 1260), "a second single-use timepiece is available");
  function walkPresent(player, target) {
    for (let i = 0; i < 1200 && Math.abs(player.x - target) > 18; i++) {
      const dir = player.x < target ? 1 : -1;
      if (player.dir !== dir) input(changed.room, player, { dir });
      advance(changed.room, 1);
    }
    input(changed.room, player, { dir: 0 });
    assert.ok(Math.abs(player.x - target) <= 18, `reached ${target}`);
  }
  walkPresent(changed.traveler, -300);
  assert.ok(input(changed.room, changed.traveler, { action: "interact" }).ok);
  walkPresent(changed.traveler, -490);
  assert.equal(changed.traveler.inside, "tollhouse");
  solveHearth(changed.room, changed.traveler);
  assert.equal(changed.room.pool.find((task) => task.id === "tollhouse-hearth").done, true);
  walkPresent(second, 1260);
  assert.ok(input(changed.room, second, { action: "interact" }).ok);
  assert.equal(game.heldPiece(changed.room, second.id)?.holder, second.id);
  walkPresent(second, 900); // this visitor reaches the key earlier in the past
  changed.room.history = changed.room.history.filter((frame) => frame.at >= changed.origin);
  assert.ok(input(changed.room, second, { action: "time_travel", targetAt: changed.origin }).ok);
  input(changed.room, second, { dir: -1 });
  for (let i = 0; i < 180 && second.x > -185 && changed.room.timeVisit; i++) advance(changed.room, 1);
  input(changed.room, second, { dir: 0 });
  assert.ok(input(changed.room, second, { action: "interact" }).ok);
  assert.equal(changed.room.doors.find((door) => door.id === "tollhouse").holder, second.id);
  assert.ok(!game.snapshot(changed.room, changed.traveler.id).self.doorKeys.includes("tollhouse"), "the earlier traveler loses the key after their commands replay");
  assert.equal(changed.traveler.inside, null, "the returned traveler's later door and movement commands replay against the locked house");
  assert.equal(changed.room.pool.find((task) => task.id === "tollhouse-hearth").done, false, "the returned traveler's dependent repair is undone");
  assert.ok(input(changed.room, second, { action: "time_return" }).ok);
  assert.equal(changed.room.doors.find((door) => door.id === "tollhouse").holder, second.id);
  console.log("PASS a later visit replays and changes a previous traveler's present");

  const stop = create("ReplayStop"), first = stop.crew[0], next = stop.crew[1];
  first.x = 1260; next.x = 1260; stop.room.keyX = 3300;
  for (const player of stop.room.players.values()) player.lastSeen = clock;
  advance(stop.room, 11); const stopOrigin = stop.room.history.at(-1).at;
  assert.ok(input(stop.room, first, { action: "interact" }).ok);
  assert.ok(input(stop.room, first, { action: "time_travel", targetAt: stopOrigin }).ok);
  input(stop.room, first, { dir: -1 }); advance(stop.room, 20);
  assert.ok(input(stop.room, first, { action: "time_return" }).ok);
  const returnedX = first.x; assert.equal(first.dir, 0);
  advance(stop.room, 100); assert.equal(first.x, returnedX);
  assert.ok(input(stop.room, next, { action: "interact" }).ok);
  stop.room.history = stop.room.history.filter((frame) => frame.at >= stopOrigin);
  assert.ok(input(stop.room, next, { action: "time_travel", targetAt: stopOrigin }).ok);
  input(stop.room, next, { dir: 0 });
  assert.equal(first.x, returnedX, "a replayed return does not leave a prior traveler walking");
  console.log("PASS a replayed return stops the previous traveler's movement");

  const leaving = create("ReplayLeave"), departing = leaving.crew[0], nextVisitor = leaving.crew[1];
  departing.x = 1260; nextVisitor.x = 1260; leaving.room.keyX = 1180;
  for (const player of leaving.room.players.values()) player.lastSeen = clock;
  advance(leaving.room, 11); const leaveOrigin = leaving.room.history.at(-1).at;
  assert.ok(input(leaving.room, departing, { action: "interact" }).ok);
  assert.ok(input(leaving.room, departing, { action: "time_travel", targetAt: leaveOrigin }).ok);
  walk(leaving.room, departing, 1180);
  assert.ok(input(leaving.room, departing, { action: "interact" }).ok);
  assert.equal(departing.hasKey, true);
  assert.ok(game.leaveRoom(leaving.room.code, departing.id).ok);
  assert.equal(departing.hasKey, false); assert.notEqual(leaving.room.keyX, null);
  assert.ok(input(leaving.room, nextVisitor, { action: "interact" }).ok);
  leaving.room.history = leaving.room.history.filter((frame) => frame.at >= leaveOrigin);
  assert.ok(input(leaving.room, nextVisitor, { action: "time_travel", targetAt: leaveOrigin }).ok);
  input(leaving.room, nextVisitor, { dir: 0 });
  assert.equal(departing.hasKey, false, "replayed leave still drops the previous traveler's key");
  assert.notEqual(leaving.room.keyX, null, "the dropped key is not reserved by the departed traveler");
  console.log("PASS replay preserves return-before-leave item drops");

  const paradox = create("ReplaySelf"), { room, crew, hollow } = paradox;
  const traveler = crew[0], victim = crew[1], other = crew[2];
  traveler.x = 300; hollow.x = 1260; victim.x = 1320; other.x = 3500; room.keyX = 3700;
  for (const player of room.players.values()) player.lastSeen = clock;
  advance(room, 11); const origin = room.history.at(-1).at;
  advance(room, 210);
  assert.ok(input(room, hollow, { action: "ability" }).ok);
  assert.equal(victim.alive, false, "original recorded strike killed the nearer soul");
  input(room, traveler, { dir: 1 }); advance(room, 101); input(room, traveler, { dir: 0 });
  assert.ok(input(room, traveler, { action: "interact" }).ok); advance(room, 11);
  assert.ok(input(room, traveler, { action: "time_travel", targetAt: origin }).ok);
  for (let i = 0; i < 250 && room.timeVisit; i++) advance(room, 1);
  assert.equal(room.timeVisit, null, "a killed traveler returns automatically");
  assert.equal(traveler.alive, false, "the replayed strike can affect the traveler");
  assert.equal(victim.alive, true, "the original victim survives when the target changes");
  console.log("PASS replayed attacks affect the traveler and replace the original outcome");

  const vote = create("ReplayVote"), voteHollow = vote.hollow, voteVictim = vote.crew[0], voteCaller = vote.crew[1], voteOther = vote.crew[2];
  for (const player of vote.room.players.values()) { player.x = 2200; player.lastSeen = clock; }
  vote.room.keyX = 3700;
  advance(vote.room, 11); const voteOrigin = vote.room.history.at(-1).at;
  advance(vote.room, 200);
  assert.ok(input(vote.room, voteCaller, { action: "ability" }).ok);
  assert.equal(vote.room.phase, "meeting");
  assert.ok(input(vote.room, voteCaller, { action: "vote", vote: voteVictim.id }).ok);
  assert.ok(input(vote.room, voteOther, { action: "vote", vote: voteVictim.id }).ok);
  assert.ok(input(vote.room, voteHollow, { action: "vote", vote: voteVictim.id }).ok);
  assert.ok(input(vote.room, voteVictim, { action: "vote", vote: "skip" }).ok);
  assert.equal(voteVictim.caged, true, "original votes caged the victim");
  walk(vote.room, voteHollow, 1260); assert.ok(input(vote.room, voteHollow, { action: "interact" }).ok); advance(vote.room, 11);
  assert.ok(input(vote.room, voteHollow, { action: "time_travel", targetAt: voteOrigin }).ok);
  walk(vote.room, voteHollow, 2200);
  while (game.snapshot(vote.room, voteHollow.id).self.killCooldownMs > 0) advance(vote.room, 1);
  assert.equal(game.snapshot(vote.room, voteHollow.id).time.mode, "past");
  assert.ok(input(vote.room, voteHollow, { action: "ability" }).ok);
  assert.equal(voteVictim.alive, false, "the earlier strike changes the victim");
  assert.equal(vote.room.phase, "meeting", "recorded votes against a dead target no longer complete the original verdict");
  assert.equal(vote.room.timeVisit, null, "the changed present meeting returns the traveler");
  assert.ok(!vote.room.cages.some((cage) => cage.occupant === voteVictim.id));
  console.log("PASS recorded meeting and votes replay against the changed past");

  const timed = create("ReplayClock"), timedVisitor = timed.crew[0]; timedVisitor.x = 1260;
  for (const player of timed.room.players.values()) player.lastSeen = clock;
  advance(timed.room, 11); const timedOrigin = timed.room.history.at(-1).at;
  assert.ok(input(timed.room, timedVisitor, { action: "interact" }).ok);
  assert.ok(input(timed.room, timedVisitor, { action: "time_travel", targetAt: timedOrigin }).ok);
  assert.equal(timed.room.timeVisit.endsAt - timed.room.timeVisit.startedAt, 60000);
  clock += 59900; game.snapshot(timed.room, timedVisitor.id); game.advanceRoomForTest(timed.room, clock);
  assert.ok(timed.room.timeVisit, "visit remains active before the deadline");
  clock += 101; game.snapshot(timed.room, timedVisitor.id); game.advanceRoomForTest(timed.room, clock);
  assert.equal(timed.room.timeVisit, null, "visit ends at the one-minute deadline");
  console.log("PASS replayed visits still expire after one minute");

  const meeting = create("ReplayMeet"), visitor = meeting.crew[0], caller = meeting.crew[1];
  visitor.x = 1260; caller.x = 2200;
  for (const player of meeting.room.players.values()) player.lastSeen = clock;
  advance(meeting.room, 11); const meetingOrigin = meeting.room.history.at(-1).at;
  assert.ok(input(meeting.room, visitor, { action: "interact" }).ok);
  assert.ok(input(meeting.room, visitor, { action: "time_travel", targetAt: meetingOrigin }).ok);
  assert.ok(input(meeting.room, caller, { action: "ability" }).ok);
  assert.equal(meeting.room.timeVisit, null);
  assert.equal(meeting.room.phase, "meeting");
  assert.equal(meeting.room.timepiecePending, true);
  clock += 45001; game.advanceRoomForTest(meeting.room, clock);
  assert.equal(meeting.room.phase, "playing");
  assert.ok(game.loosePieces(meeting.room).some((tp) => tp.x === 1260), "the next item appears after the meeting");
  console.log("PASS meetings return the traveler and defer the next timepiece");
  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("COMMAND REPLAY TEST FAILED", error); process.exit(1); }
