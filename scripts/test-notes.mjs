// Pinned pages: custom-text notes snapped to building walls or tree trunks,
// readable via the zoom-in button data, carried through time travel.
// Covers: snap to wall vs tree, text validation, vision-filtered snapshots,
// pinning inside a past visit (present inherits it, author remapped), history
// frames + journal replay determinism, integer positions.
import assert from "node:assert/strict";
import Module from "node:module";
import { build } from "esbuild";
import "dotenv/config";
const out = await build({ entryPoints: ["src/game/engine.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
const filename = `${process.cwd()}/scripts/.notes-test.cjs`;
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
  const players = [...room.players.values()];
  players.forEach((p, i) => { p.x = 400 + i * 100; p.dir = 0; p.killAt = 0; });
  players[3].role = "hollow";
  for (let i = 0; i < 3; i++) players[i].role = "crew";
  room.keyX = 3300;
  room.cartX = 900;
  room.history.length = 0; room.lastHistoryAt = 0;
  advance(room, 1);
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
function stand(room, player, x) {
  player.x = x; player.dir = 0;
  for (const p of room.players.values()) p.lastSeen = clock;
  advance(room, 11);
}
function replayTwice(room, label) {
  const seq0 = room.history[0].seq, end = room.journalSeq;
  const a = game.replayRecordedState(room, seq0, end);
  const b = game.replayRecordedState(room, seq0, end);
  assert.deepEqual(a.notes, b.notes, `${label}: notes replay identically`);
  assert.deepEqual([...a.players.values()].map((p) => [p.id, p.x, p.alive]), [...b.players.values()].map((p) => [p.id, p.x, p.alive]), `${label}: players replay identically`);
}

try {
  const { room, players } = create("Notes");
  const [A, B] = players;

  // --- 1. snap to a building wall ------------------------------------------
  stand(room, A, -320); // inside the tollhouse footprint (-470..-170)
  const wallAnchor = game.snapAnchorForTest(-320);
  assert.equal(wallAnchor.kind, "wall");
  assert.equal(wallAnchor.ref, "tollhouse");
  const pinned = input(room, A, { action: "pin_note", noteText: "  Meet   at\n the bell. " });
  assert.ok(pinned.ok, `pinning to a wall works${pinned.error ? `: ${pinned.error}` : ""}`);
  assert.equal(room.notes.length, 1);
  const wallNote = room.notes[0];
  assert.equal(wallNote.kind, "wall");
  assert.ok(wallNote.x >= -470 + 12 && wallNote.x <= -170 - 12, `wall snap stays on the facade (x=${wallNote.x})`);
  assert.equal(wallNote.x, wallAnchor.x, "note x is the snapped anchor");
  assert.ok(Number.isInteger(wallNote.x), "note x is an integer");
  assert.equal(wallNote.text, "Meet at the bell.", "text is stored verbatim (whitespace collapsed), not a placeholder");
  assert.equal(wallNote.authorId, A.id);
  assert.equal(wallNote.authorName, A.name);

  // --- 2. snap to a tree trunk ---------------------------------------------
  let treeAnchor = null;
  for (let x = -1400; x <= 5700 && !treeAnchor; x += 7) {
    const a = game.snapAnchorForTest(x);
    if (a && a.kind === "tree" && Math.abs(a.x - x) < 1) treeAnchor = a;
  }
  assert.ok(treeAnchor, "found a tree trunk");
  stand(room, B, treeAnchor.x);
  assert.ok(input(room, B, { action: "pin_note", noteText: "Beware the Hollow." }).ok, "pinning to a tree works");
  const treeNote = room.notes.at(-1);
  assert.equal(treeNote.kind, "tree");
  assert.equal(treeNote.x, treeAnchor.x, "tree snap lands exactly on the trunk");
  assert.equal(treeNote.text, "Beware the Hollow.");

  // --- 3. validation --------------------------------------------------------
  stand(room, A, -320);
  assert.ok(!input(room, A, { action: "pin_note", noteText: "   " }).ok, "empty page rejected");
  assert.ok(!input(room, A, { action: "pin_note" }).ok, "missing text rejected");
  const long = "x".repeat(250);
  const tooLong = input(room, A, { action: "pin_note", noteText: long });
  assert.ok(!tooLong.ok, "overlong page rejected");
  assert.ok(tooLong.error.includes("200"), "error states the 200-char limit");
  assert.equal(room.notes.length, 2, "rejected pins create nothing so far (wall + tree)");
  // far from any wall/tree
  let farX = 0, farDist = -1;
  for (let x = -1400; x <= 5700; x += 5) {
    const a = game.snapAnchorForTest(x);
    const d = a ? Math.abs(a.x - x) : 1e9;
    if (d > farDist) { farDist = d; farX = x; }
  }
  assert.ok(farDist > 90, `there is open road with no anchor nearby (dist=${farDist})`);
  stand(room, A, farX);
  assert.ok(!input(room, A, { action: "pin_note", noteText: "Nowhere to pin." }).ok, "pinning in the open road rejected");
  stand(room, A, -320);
  A.inside = "tollhouse";
  const insidePin = input(room, A, { action: "pin_note", noteText: "Inside the tollhouse." });
  assert.ok(insidePin.ok, `pinning inside a house works${insidePin.error ? `: ${insidePin.error}` : ""}`);
  const inNote = room.notes.at(-1);
  assert.equal(inNote.house, "tollhouse", "interior page is tagged with its house");
  assert.equal(inNote.kind, "wall");
  assert.ok(inNote.x >= -470 + 12 && inNote.x <= -170 - 12, "interior page x clamps into the house");
  assert.ok(game.snapshot(room, A.id).notes.some((n) => n.id === inNote.id), "a soul inside sees the interior page in its snapshot");
  A.inside = null;
  assert.ok(!(game.snapshot(room, A.id).notes ?? []).some((n) => n.id === inNote.id), "from outside the interior page is not visible");
  assert.equal(room.notes.length, 3, "the interior pin was stored (wall + tree + interior)");
  stand(room, A, -320);
  assert.ok(game.snapshot(room, A.id).notes.some((n) => n.id === wallNote.id), "exterior pages stay visible from outside");
  A.alive = false;
  assert.ok(!input(room, A, { action: "pin_note", noteText: "Ghost." }).ok, "the dead cannot pin pages");
  A.alive = true;
  assert.equal(room.notes.length, 3, "the dead pin created nothing (wall + tree + interior)");

  // --- 4. snapshot carries real text, vision-filtered ------------------------
  const near = game.snapshot(room, A.id);
  const snapWall = near.notes.find((n) => n.id === wallNote.id);
  assert.ok(snapWall, "a nearby page is in the snapshot");
  assert.equal(snapWall.text, "Meet at the bell.", "snapshot carries the real text for the reader");
  assert.equal(snapWall.author, A.name);
  stand(room, A, 3300); // far away: outside vision of the tollhouse
  const far = game.snapshot(room, A.id);
  assert.ok(!(far.notes ?? []).some((n) => n.id === wallNote.id), "far pages leave the snapshot (vision-filtered)");
  stand(room, A, -320);
  assert.ok(game.snapshot(room, A.id).notes.some((n) => n.id === wallNote.id), "back in range the page returns");
  replayTwice(room, "present");
  console.log("PASS pages pin to walls/trees with validated real text; snapshots carry text within vision only");

  // --- 5. pin a page inside a past visit ------------------------------------
  advance(room, 30);
  const origin = room.history.at(-1).at;
  advance(room, 20);
  // A takes the timepiece and travels
  stand(room, A, 1260);
  assert.ok(input(room, A, { action: "interact" }).ok, "timepiece taken");
  assert.ok(input(room, A, { action: "time_travel", targetAt: origin }).ok, "visit starts");
  walk(room, A, treeAnchor.x);
  const pastPin = input(room, A, { action: "pin_note", noteText: "I was here before you." });
  assert.ok(pastPin.ok, `a traveller can pin a page in the past${pastPin.error ? `: ${pastPin.error}` : ""}`);
  const shadow = game.simulatePastForTest(room, room.timeVisit.originAt + (clock - room.timeVisit.startedAt));
  assert.ok(shadow.notes.some((n) => n.text === "I was here before you."), "the shadow past contains the pinned page");
  const pastSnap = game.snapshot(room, A.id);
  assert.ok((pastSnap.notes ?? []).some((n) => n.text === "I was here before you."), "the traveller sees their own page in the past snapshot");
  assert.ok(input(room, A, { action: "time_return" }).ok, "return");
  const pastNote = room.notes.find((n) => n.text === "I was here before you.");
  assert.ok(pastNote, "the page pinned in the past exists in the present after return");
  assert.equal(pastNote.authorId, A.id, "authorship is remapped from the visitor incarnation to the real soul");
  assert.equal(pastNote.kind, "tree");
  assert.ok(room.revisions[0].actions.some((a) => a.body.action === "pin_note" && a.body.noteText === "I was here before you."), "the revision records the pin action verbatim");
  advance(room, 12); // let the sampler capture a fresh frame
  assert.ok(room.history.at(-1).notes.some((n) => n.id === pastNote.id), "history frames carry notes");
  stand(room, A, treeAnchor.x);
  assert.ok(game.snapshot(room, A.id).notes.some((n) => n.text === "I was here before you."), "the returned traveller sees the page in the present");

  // A later traveller's shadow also replays the pinned page.
  advance(room, 20);
  const later = room.history.at(-1).at;
  advance(room, 20);
  stand(room, B, 1260);
  assert.ok(input(room, B, { action: "interact" }).ok, "second timepiece taken");
  assert.ok(input(room, B, { action: "time_travel", targetAt: later }).ok, "second visit starts");
  const shadow2 = game.simulatePastForTest(room, room.timeVisit.originAt + (clock - room.timeVisit.startedAt));
  assert.ok(shadow2.notes.some((n) => n.text === "I was here before you."), "a later traveller's past replays the earlier pin");
  assert.ok(input(room, B, { action: "time_return" }).ok, "second return");

  for (const n of room.notes) assert.ok(Number.isInteger(n.x), `note ${n.id} x int`);
  replayTwice(room, "final");
  console.log(`PASS pages pinned in the past travel back to the present and replay into later travellers (${room.notes.length} notes total)`);
  Date.now = realNow; process.exit(0);
} catch (error) { Date.now = realNow; console.error("NOTES FAILED", error); process.exit(1); }
