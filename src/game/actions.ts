// Room lifecycle + client input handling: create/join/leave/start/restart and
// handleInput (clients send ONLY intent, never positions). Time-travel entry
// points are injected via hooks (they live in engine's replay machinery).
import { desc, eq, lt } from "drizzle-orm";
import { randomInt, randomUUID } from "node:crypto";
import { db } from "@/db";
import { roomPlayers, roomRows } from "@/db/schema";
import { BUILDINGS, WORLD_MIN, WORLD_MAX, doorX, dropBuildingKeys, interactWithBuilding, newDoors, snapAnchor } from "./buildings";
import { feed, journal, markDirty, record, roomNow, seeded, kitId } from "./chronicle";
import { canonicalInput } from "./input";
import { captureHistory } from "./history";
import { applyWardMove, validWardMove, wardProgress, wardSolved } from "./wards";
import { inMeetingArea, killTarget, nearestBody, nearestOccupiedCage, stationNear } from "./proximity";
import { dropKey, dropSupply, dropTimepiece, beginMeeting, beginRepair, canRepair, checkWin, doKill, freePlayer, resolveMeeting, tryDeliverSupply } from "./rules";
import { endTimeVisit, handlePastInput, startTimeVisit } from "./time-travel";
import { rooms, listRoomsSync, makeCode } from "./registry";
import { shuffle } from "./rng";
import { heldPiece, nearTimepiece, nearestTimepiece } from "./timepieces";
import { newMatchStats } from "./stats";
import { bumpStats } from "./stats";
import {
  BELL_X, BLACKOUT_CD_MS, BLACKOUT_MS, BUBBLE_MS, CAGE_XS, INTERACT_RANGE, NOTE_REACH, NOTE_TEXT_MAX,
  PLAYER_COLORS, SABOTAGE_COOLDOWN_MS, SABOTAGE_VIGOR_COST, STAMINA_BELL_COST, STAMINA_BLACKOUT_COST,
  STAMINA_UNLOCK_COST, STATIONS, SUPPLY_CART_START, TIMEPIECE_X, WORLD_W, ix,
  type InputBody, type Note, type Phase, type RoomListing, type Snapshot,
} from "./types";
import type { P, Room } from "./engine";

const dist = (a: number, b: number) => Math.abs(a - b);

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------


export function createRoom(playerId: string, name: string) {
  const room: Room = {
    code: makeCode(),
    phase: "lobby",
    timepieces: [], timepiecePending: false, revisions: [],
    history: [], historyEvents: [], journal: [], journalSeq: 0, activeSeed: 1, activeEventId: "", lastHistoryAt: 0, timeVisit: null, rev: 0, etags: new Map(),
    players: new Map(),
    bodies: [],
    doors: newDoors(),
    keyX: null,
    supplyDrops: [],
    notes: [],
    cartX: SUPPLY_CART_START,
    cartPushers: 0,
    cages: CAGE_XS.map((x) => ({ x, occupant: null })),
    feed: [],
    meeting: null,
    winner: null,
    winReason: null,
    bellAt: 0,
    flickerAt: 0,
    nextFlicker: Date.now() + 20000,
    createdAt: Date.now(),
    startedAt: 0,
    endedAt: 0,
    pool: [],
    blackoutUntil: 0,
    blackoutReadyAt: 0,
    round: 0,
  };
  rooms.set(room.code, room);
  markDirty(room);
  record(room, null, "room_created", {});
  joinRoom(room.code, playerId, name);
  feed(room, "The town of Hollow Creek waits under a bruised October sky…");
  return room.code;
}

export function joinRoom(code: string, playerId: string, rawName: string): { ok: boolean; error?: string; playerId?: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: "No such town. Check the code." };
  const now = Date.now();
  const existing = room.players.get(playerId);
  if (existing) {
    existing.lastSeen = now;
    if (!room.replaying && room.phase !== "lobby" && room.phase !== "ended" && now - (existing.lastPresenceAt ?? 0) > 30_000) {
      existing.lastPresenceAt = now;
      journal(room, "presence", now, existing.id);
    }
    if (existing.parked) {
      existing.parked = false;
      feed(room, `${existing.name} is back on the street.`);
      record(room, existing, "seat_claimed", {});
      markDirty(room);
    }
    return { ok: true, playerId };
  }
  if (room.phase !== "lobby" && room.phase !== "ended") {
    return { ok: false, error: "This tale has already begun." };
  }
  const name = (rawName || "Stranger").trim().slice(0, 14) || "Stranger";
  // Re-adoption: someone returning under the same name takes over their old
  // (stale) seat instead of spawning a duplicate "name-2" stranger.
  // Allowed in lobby AND after the tale ended, so the same souls can regather.
  const staleSeat = [...room.players.values()].find(
    (q) => q.name.toLowerCase() === name.toLowerCase() && now - q.lastSeen > 8000
  );
  if (staleSeat) {
    room.players.delete(staleSeat.id);
    const oldId = staleSeat.id;
    staleSeat.id = playerId;
    staleSeat.lastSeen = now;
    staleSeat.joinedAt = now;
    staleSeat.parked = false;
    room.players.set(playerId, staleSeat);
    record(room, staleSeat, "rejoin", { oldId });
    feed(room, `${staleSeat.name} returned to town.`);
    return { ok: true, playerId };
  }
  if (room.phase === "ended") {
    return { ok: false, error: "This town's night is over — only its own souls may return." };
  }
  if (room.players.size >= 10) return { ok: false, error: "The town is full (10 souls)." };
  const used = new Set([...room.players.values()].map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  const p: P = {
    id: playerId,
    name,
    color,
    x: BELL_X + (room.players.size - 2) * 60,
    dir: 0,
    facing: 1,
    moving: false,
    alive: true,
    caged: false,
    cageIndex: -1,
    inside: null,
    role: "crew",
    stamina: 1,
    exhausted: false,
    killAt: 0,
    bellUsed: false,
    hasKey: false,
    hasSupply: false,
    supplyId: null,
    cartHeld: false,
    sabotageAt: 0,
    match: newMatchStats(),
    bubbleText: "",
    bubbleUntil: 0,
    actionText: "", actionUntil: 0,
    interactHeld: false,
    activeWard: null,
    lastSeen: Date.now(),
    joinedAt: Date.now(),
    vote: null,
    isHost: true,
    parked: false, // the lantern always passes to the LAST joiner
  };
  const previousHost = [...room.players.values()].find((q) => q.isHost);
  if (previousHost) {
    previousHost.isHost = false;
    feed(room, `${name} takes the town lantern (host).`);
  }
  room.players.set(playerId, p);
  markDirty(room);
  feed(room, `${name} arrived in Hollow Creek.`);
  record(room, p, "join", {});
  return { ok: true, playerId };
}

/** Explicit leave (button or sendBeacon on tab close). Lobby: removed + host
 *  promoted to the NEWEST remaining joiner (most likely to be present).
 *  In-game: seat is kept (roles must persist), but the lantern passes on. */
export function leaveRoom(code: string, playerId: string): { ok: boolean } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false };
  markDirty(room);
  const p = room.players.get(playerId);
  if (!p) return { ok: false };
  if (room.timeVisit?.playerId === p.id) endTimeVisit(room, p, "leaving");
  if (!room.replaying && room.phase !== "lobby" && room.phase !== "ended") journal(room, "leave", roomNow(room), p.id);
  record(room, p, "leave", { lobby: room.phase === "lobby" });
  if (room.phase !== "lobby") {
    dropTimepiece(room, p);
    dropKey(room, p);
    dropSupply(room, p);
    dropBuildingKeys(room.doors, p.id, p.x, p.inside);
  }
  if (room.phase === "lobby") {
    room.players.delete(playerId);
    feed(room, `${p.name} turned back down the old road.`);
  } else {
    p.dir = 0;
    p.cartHeld = false;
    p.activeWard = null;
    p.lastSeen = 0;
  }
  if (p.isHost) {
    p.isHost = false;
    const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
    if (next) {
      next.isHost = true;
      feed(room, `${next.name} now holds the town lantern (host).`);
    }
  }
  return { ok: true };
}

export function startGame(room: Room, playerId: string): { ok: boolean; error?: string } {
  markDirty(room);
  const host = room.players.get(playerId);
  if (!host?.isHost) return { ok: false, error: "Only the host may begin." };
  if (room.phase !== "lobby") return { ok: false, error: "Already begun." };
  if (room.players.size < 4) return { ok: false, error: "At least 4 souls are needed." };

  const ps = [...room.players.values()];
  const shuffled = shuffle(ps); // uniform Fisher–Yates — every seat equally likely
  const hollowCount = ps.length >= 6 ? 2 : 1;
  shuffled.forEach((p, i) => {
    p.role = i < hollowCount ? "hollow" : "crew";
    p.x = ix(300 + (seeded(room, `spawn:${p.id}`) % 100000) / 100000 * (WORLD_W - 600));
    p.killAt = Date.now() + 10000;
  });
  // Shared pool: the town's wards belong to everyone. A death never orphans
  // a chore, and nothing is redistributed — anyone living can work anything.
  // Every ward is visibly broken at dusk. The shared pool has a task for every
  // structure, so nothing magically repairs itself when the night begins.
  room.pool = STATIONS.map(({ id, initialSupplied }) => ({ id, done: false, delivered: !!initialSupplied, sabotaged: false, progress: 0, puzzle: null, previewUntil: 0, supplyId: null }));
  room.timepieces = [{ id: "tp0", x: TIMEPIECE_X, holder: null, consumed: false }]; room.timepiecePending = false; room.revisions = [];
  room.history = []; room.historyEvents = []; room.journal = []; room.journalSeq = 0; room.activeSeed = 1; room.activeEventId = ""; room.lastHistoryAt = 0; room.timeVisit = null;
  room.doors = newDoors();
  for (const p of ps) p.inside = null;
  room.supplyDrops = [];
  room.notes = [];
  room.cartX = SUPPLY_CART_START;
  room.cartPushers = 0;
  for (const p of ps) { p.stamina = 1; p.exhausted = false; p.hasSupply = false; p.supplyId = null; p.cartHeld = false; p.sabotageAt = 0; p.activeWard = null; p.match = newMatchStats(); }
  room.startedAt = Date.now();
  room.endedAt = 0;
  room.round += 1;
  // The cage key hides somewhere on the outskirts, clear of the timepiece's pickup range.
  const keyRoll = seeded(room, "cage-key") % 100000 / 100000;
  room.keyX = ix(keyRoll < 0.5 ? 150 + keyRoll * 2 * 1400 : 2700 + (keyRoll - 0.5) * 2 * 1350);
  if (Math.abs(room.keyX - TIMEPIECE_X) < INTERACT_RANGE + 60) {
    room.keyX = TIMEPIECE_X + (room.keyX < TIMEPIECE_X ? -1 : 1) * (INTERACT_RANGE + 65); // int
  }
  room.phase = "playing";
  room.nextFlicker = Date.now() + 15000 + (seeded(room, "flicker") % 15000);
  feed(room, "Night falls. Bring kits from the cart to the broken wards. Deliver a kit to open its repair puzzle; each solved board mends a ward.");
  feed(room, "Something wearing a human shape walks among you.");
  record(room, null, "game_start", { players: ps.map((p) => ({ id: p.id, name: p.name, role: p.role })) });
  captureHistory(room, Date.now(), true);
  checkWin(room);
  return { ok: true };
}


/**
 * Room browser, backed by Postgres: towns survive a restart, so the menu can
 * offer a town that is not currently in memory.
 */
export async function listRooms(): Promise<RoomListing[]> {
  // let go of towns nobody has touched for a week
  try {
    await db.delete(roomRows).where(lt(roomRows.updatedAt, new Date(Date.now() - 7 * 24 * 3600_000)));
  } catch {
    /* non-fatal */
  }
  const out = new Map<string, RoomListing>();
  try {
    const rows = await db
      .select({
        code: roomRows.code,
        round: roomRows.round,
        updatedAt: roomRows.updatedAt,
        name: roomPlayers.name,
      })
      .from(roomRows)
      .leftJoin(roomPlayers, eq(roomPlayers.code, roomRows.code))
      .orderBy(desc(roomRows.updatedAt))
      .limit(24);
    for (const r of rows) {
      const cur = out.get(r.code) ?? {
        code: r.code,
        phase: "lobby" as Phase,
        playerCount: 0,
        hostName: "—",
        names: [],
        createdAt: r.updatedAt.getTime(),
        round: r.round,
      };
      if (r.name) cur.names.push(r.name);
      cur.playerCount = cur.names.length;
      out.set(r.code, cur);
    }
  } catch (e) {
    console.error("room list failed", e);
  }
  // live rooms win: their phase and roster are current
  for (const r of rooms.values()) {
    if (r.players.size === 0) continue;
    const ps = [...r.players.values()];
    out.set(r.code, {
      code: r.code,
      phase: r.phase,
      playerCount: ps.length,
      hostName: ps.find((p) => p.isHost)?.name ?? "—",
      names: ps.map((p) => p.name),
      createdAt: r.createdAt,
      round: r.round,
    });
  }
  return [...out.values()]
    .filter((r) => r.playerCount > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24);
}

/** Live room browser — open towns on the map. */
/** The same souls gather in the same town for another night. */
export function restartGame(room: Room, playerId: string): { ok: boolean; error?: string } {
  markDirty(room);
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  if (!p.isHost) {
    // if the lantern-bearer never came back, a present soul may claim it
    const host = [...room.players.values()].find((q) => q.isHost);
    if (host && Date.now() - host.lastSeen > 12000) {
      host.isHost = false;
      p.isHost = true;
      feed(room, `${p.name} picked up the fallen lantern (host).`);
    } else {
      return { ok: false, error: "Only the lantern-bearer may gather the town." };
    }
  }
  if (room.phase !== "ended") return { ok: false, error: "The night is not over yet." };
  let i = 0;
  for (const q of room.players.values()) {
    q.x = BELL_X + (i++ - 2) * 60;
    q.dir = 0;
    q.facing = 1;
    q.moving = false;
    q.alive = true;
    q.caged = false;
    q.cageIndex = -1;
    q.inside = null;
    q.role = "crew";
    q.stamina = 1;
    q.exhausted = false;
    q.killAt = 0;
    q.bellUsed = false;
    q.hasKey = false;
    q.hasSupply = false;
    q.supplyId = null;
    q.cartHeld = false;
    q.sabotageAt = 0;
    q.match = newMatchStats();
    q.bubbleText = "";
    q.bubbleUntil = 0;
    q.actionText = ""; q.actionUntil = 0;
    q.interactHeld = false;
    q.activeWard = null;
    q.vote = null;
  }
  room.bodies = [];
  room.timepieces = [{ id: "tp0", x: TIMEPIECE_X, holder: null, consumed: false }]; room.timepiecePending = false; room.revisions = [];
  room.history = []; room.historyEvents = []; room.journal = []; room.journalSeq = 0; room.activeSeed = 1; room.activeEventId = ""; room.lastHistoryAt = 0; room.timeVisit = null;
  room.doors = newDoors();
  room.keyX = null;
  room.supplyDrops = [];
  room.notes = [];
  room.cartX = SUPPLY_CART_START;
  room.cartPushers = 0;
  for (const c of room.cages) c.occupant = null;
  room.meeting = null;
  room.winner = null;
  room.winReason = null;
  room.endedAt = 0;
  room.blackoutUntil = 0;
  room.blackoutReadyAt = 0;
  room.pool = [];
  room.phase = "lobby";
  feed(room, "The town gathers again. The same faces… but who will wear them tonight?");
  record(room, p, "restart", { round: room.round + 1 });
  return { ok: true };
}


// ---------------------------------------------------------------------------
// Input — clients send ONLY intent, never positions
// ---------------------------------------------------------------------------

export function handleInput(room: Room, body: InputBody): { ok: boolean; error?: string } {
  const p = room.players.get(body.playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  p.lastSeen = roomNow(room);
  if (room.replaying && p.temporalAbsent) return { ok: false, error: "That soul is outside this moment." };
  if (!room.replaying && !room.temporalShadow && room.timeVisit?.playerId === p.id) return handlePastInput(room, p, body);
  if (!room.replaying && !room.temporalShadow && room.phase !== "lobby" && body.action !== "time_travel" && body.action !== "time_return" && body.action !== "restart") journal(room, "input", p.lastSeen, p.id, body);
  if (body.action === "time_travel") return startTimeVisit(room, p, body.targetAt);
  if (body.action === "time_return") return { ok: false, error: "You are already in the present." };

  if (typeof body.dir === "number") {
    const d = Math.max(-1, Math.min(1, Math.round(body.dir)));
    if (d !== p.dir) record(room, p, "move_input", { dir: d });
    p.dir = d;
  }
  if (typeof body.interactHeld === "boolean") p.interactHeld = body.interactHeld;
  if (typeof body.cartHeld === "boolean") p.cartHeld = body.cartHeld;

  if (typeof body.chat === "string" && body.chat.trim()) {
    const text = body.chat.trim().slice(0, 120);
    p.bubbleText = text;
    p.bubbleUntil = roomNow(room) + BUBBLE_MS;
    record(room, p, "chat", { text, ghost: !p.alive, caged: p.caged });
    if (!room.replaying) bumpStats(p.id, p.name, { chatChars: text.length });
  }

  if (body.action === "start") return startGame(room, p.id);
  if (body.action === "restart") return restartGame(room, p.id);

  if (body.action === "interact" && p.alive && !p.caged && !p.inside && room.phase === "playing" && nearTimepiece(room, p)) {
    const tp = nearestTimepiece(room, p)!;
    tp.holder = p.id;
    feed(room, `${p.name} finds a strange timepiece. Press M to choose a moment.`);
    record(room, p, "timepiece_taken", { piece: tp.id });
    return { ok: true };
  }

  if ((body.action === "interact" || body.action === "door_lock") && p.alive && !p.caged &&
      (room.phase === "playing" || room.phase === "meeting")) {
    const beforeDoors = structuredClone(room.doors);
    const result = interactWithBuilding(room.doors, p.id, p.x, p.inside, body.action === "door_lock" ? "lock" : "interact");
    if (result.handled) {
      const changed = room.doors.find((door) => JSON.stringify(door) !== JSON.stringify(beforeDoors.find((item) => item.id === door.id)));
      if (result.message) { feed(room, result.message); record(room, p, "door_action", { message: result.message, doorId: changed?.id }); }
      return result.error ? { ok: false, error: result.error } : { ok: true };
    }
    if (body.action === "door_lock") return { ok: false, error: "Stand beside a door with its key." };
  }

  if (body.action === "pin_note") {
    if (!p.alive) return { ok: false, error: "The dead cannot pin pages." };
    if (room.phase !== "playing") return { ok: false, error: "The night has not begun." };
    if (p.caged) return { ok: false, error: "A caged soul cannot pin a page." };
    const text = typeof body.noteText === "string" ? body.noteText.replace(/\s+/g, " ").trim() : "";
    if (!text) return { ok: false, error: "Write something on the page first." };
    if (text.length > NOTE_TEXT_MAX) return { ok: false, error: `Keep the page under ${NOTE_TEXT_MAX} characters.` };
    let anchor: { x: number; kind: "wall" | "tree"; ref: string } | null, house: string | null = null;
    if (p.inside) {
      // Inside a house the page goes on that house's interior wall.
      const b = BUILDINGS.find((item) => item.id === p.inside);
      if (!b) return { ok: false, error: "This place has no walls to pin to." };
      house = b.id;
      anchor = { x: ix(Math.max(b.x + 12, Math.min(b.x + b.width - 12, p.x))), kind: "wall", ref: b.id };
    } else {
      anchor = snapAnchor(p.x);
      if (!anchor || Math.abs(anchor.x - p.x) > NOTE_REACH) return { ok: false, error: "Stand beside a house wall or a tree to pin a page." };
    }
    const note: Note = { id: `note:${room.code}:${room.round}:${room.notes.length}:${room.activeEventId || randomUUID()}`, authorId: p.id, authorName: p.name, text, x: ix(anchor.x), kind: anchor.kind, house, at: roomNow(room) };
    room.notes.push(note);
    feed(room, `${p.name} pins a page to the ${house ? `${(BUILDINGS.find((b) => b.id === house)?.name ?? "house").toLowerCase()} wall` : anchor.kind === "wall" ? (BUILDINGS.find((b) => b.id === anchor!.ref)?.name ?? "wall").toLowerCase() : "tree"}.`);
    record(room, p, "pin_note", { x: note.x, kind: note.kind });
    return { ok: true };
  }
  if (body.action === "drop_supply" && p.alive && !p.inside && room.phase === "playing" && p.hasSupply) {
    dropSupply(room, p);
    record(room, p, "supply_drop", {});
    feed(room, `${p.name} puts down a repair kit.`);
    return { ok: true };
  }

  if (body.action === "ward_cancel") {
    p.activeWard = null;
    p.interactHeld = false;
    return { ok: true };
  }

  if (body.action === "ward_move") {
    const task = room.pool.find((t) => t.id === p.activeWard && t.id === body.wardId);
    const station = task && STATIONS.find((s) => s.id === task.id);
    if (room.phase !== "playing" || !canRepair(room, p) || !p.alive || p.caged || !task ||
        !station || !task.delivered || task.done || !task.puzzle || p.dir !== 0 ||
        !stationNear(p, station.id, INTERACT_RANGE + 35)) {
      p.activeWard = null;
      return { ok: false, error: "Stand beside a supplied ward to repair it." };
    }
    if (p.exhausted || p.stamina <= 0) return { ok: false, error: "Rest your vigor before repairing." };
    if (typeof body.move !== "number" || !validWardMove(task.puzzle, body.move)) {
      return { ok: false, error: "That is not a tile on this board." };
    }
    const before = task.puzzle;
    if (before.kind === "scarecrow" && body.move !== 4 && roomNow(room) < task.previewUntil) {
      return { ok: false, error: "Watch the crow call before repeating it." };
    }
    task.puzzle = applyWardMove(before, body.move);
    if (before.kind === "scarecrow" && (body.move === 4 ||
        task.puzzle.values[0] !== before.values[0] || task.puzzle.mistakes > before.mistakes)) {
      task.previewUntil = roomNow(room) + 3200;
    }
    task.progress = wardProgress(task.puzzle);
    p.stamina = Math.max(0, p.stamina - 0.024);
    if (p.stamina <= 0) p.exhausted = true;
    record(room, p, "ward_move", { task: task.id, tile: body.move, progress: Math.round(task.progress * 100) });
    if (wardSolved(task.puzzle)) {
      task.done = true;
      task.progress = 1;
      for (const player of room.players.values()) if (player.activeWard === task.id) player.activeWard = null;
      p.match.repairs++;
      feed(room, `${p.name} repairs ${station.name.toLowerCase()}.`);
      record(room, p, "task_complete", { task: task.id, puzzle: task.puzzle.kind, supplyId: task.supplyId ?? null });
      if (!room.replaying) bumpStats(p.id, p.name, { tasksDone: 1 });
      checkWin(room);
    }
    return { ok: true };
  }

  if (body.action === "sabotage") {
    if (room.phase !== "playing" || p.role !== "hollow" || !p.alive || p.caged) {
      return { ok: false, error: "Only a free Hollow can ruin a ward." };
    }
    const now = roomNow(room);
    if (now < p.sabotageAt) return { ok: false, error: "The ruin is not ready yet." };
    const ward = room.pool.find((t) => !t.sabotaged && (t.done || t.delivered) && stationNear(p, t.id));
    if (!ward) return { ok: false, error: "Find a supplied or repaired ward to ruin." };
    // One ruin per ward each night keeps the repair victory reachable.
    ward.sabotaged = true;
    ward.done = false;
    ward.delivered = false;
    ward.supplyId = null;
    ward.progress = 0;
    ward.puzzle = null;
    ward.previewUntil = 0;
    for (const q of room.players.values()) if (q.activeWard === ward.id) q.activeWard = null;
    p.sabotageAt = now + SABOTAGE_COOLDOWN_MS;
    p.stamina = Math.max(0, p.stamina - SABOTAGE_VIGOR_COST);
    const station = STATIONS.find((st) => st.id === ward.id)!;
    feed(room, `A crash comes from ${station.name.toLowerCase()}. That ward needs supplies again.`);
    p.match.ruins++;
    record(room, p, "ward_ruined", { ward: ward.id });
    return { ok: true };
  }

  if (body.action === "interact" && p.alive) {
    // free a prisoner with the cage key
    if (p.hasKey) {
      const ci = nearestOccupiedCage(room, p.x);
      if (ci >= 0) {
        const occ = room.players.get(room.cages[ci].occupant!)!;
        freePlayer(room, occ);
        p.match.cagesOpened++;
        p.hasKey = false;
        p.stamina = Math.max(0, p.stamina - STAMINA_UNLOCK_COST);
        room.keyX = room.cages[ci].x + 40; // the key falls by the open cage — the town learns where it lies (int)
        feed(room, `${p.name} unlocks the cage. ${occ.name} steps free. The key clatters to the ground.`);
        record(room, p, "unlock_cage", { freed: occ.name, freedId: occ.id, cageIndex: ci });
        if (!room.replaying) bumpStats(p.id, p.name, { unlocks: 1 });
        return { ok: true };
      }
    }
    // report a body
    if (room.phase === "playing" && !p.caged) {
      const b = nearestBody(room, p);
      if (b) {
        record(room, p, "report", { body: b.name });
        if (!room.replaying) bumpStats(p.id, p.name, { reports: 1 });
        p.match.reports++;
        feed(room, `${p.name} found ${b.name}'s body.`);
        beginMeeting(room, `${p.name} found the body of ${b.name}`, p);
        return { ok: true };
      }
    }
    if (tryDeliverSupply(room, p)) return { ok: true };
    // pick up the cage key
    if (room.keyX !== null && !p.caged && !p.inside && dist(room.keyX, p.x) < INTERACT_RANGE) {
      p.hasKey = true;
      room.keyX = null;
      feed(room, `${p.name} found an old iron key.`);
      record(room, p, "pickup_key", {});
      return { ok: true };
    }
    // If the whole living town has been locked up, a prisoner may call a vote
    // to free someone. This does not reveal roles or decide the match.
    if (room.phase === "playing" && p.caged &&
        [...room.players.values()].filter((q) => q.alive).every((q) => q.caged)) {
      beginMeeting(room, `${p.name} calls a vote from the cages`, p);
      return { ok: true };
    }
    // ring the bell
    if (room.phase === "playing" && !p.caged && !p.inside && !p.bellUsed && dist(p.x, BELL_X) < INTERACT_RANGE) {
      p.bellUsed = true;
      p.stamina = Math.max(0, p.stamina - STAMINA_BELL_COST);
      p.match.bells++;
      record(room, p, "ring_bell", {});
      if (!room.replaying) bumpStats(p.id, p.name, { bells: 1 });
      beginMeeting(room, `${p.name} rang the bell`, p);
      return { ok: true };
    }

    if (room.phase === "playing" && !p.caged) {
      // The server owns both ends of the journey: a kit must be picked up at a
      // cart (or from the ground) and physically carried to an unfinished ward.
      if (!p.hasSupply && !p.inside) {
        const dropped = room.supplyDrops.findIndex((item) => dist(item.x, p.x) < INTERACT_RANGE);
        if (dropped !== -1) {
          const [kit] = room.supplyDrops.splice(dropped, 1);
          p.hasSupply = true;
          p.supplyId = kit.id;
          feed(room, `${p.name} recovers a fallen repair kit.`);
          record(room, p, "supply_recovered", { supplyId: p.supplyId });
          return { ok: true };
        }
        if (dist(room.cartX, p.x) < INTERACT_RANGE) {
          p.hasSupply = true;
          p.supplyId = kitId(room, p);
          feed(room, `${p.name} takes a repair kit from the supply cart.`);
          record(room, p, "supply_taken", { supplyId: p.supplyId });
          return { ok: true };
        }
      }
      const ready = room.pool.find((t) => !t.done && t.delivered && stationNear(p, t.id));
      if (ready) return beginRepair(room, p, ready);
      const broken = room.pool.find((t) => !t.done && !t.delivered && stationNear(p, t.id));
      if (broken) return { ok: false, error: "Bring a repair kit from the cart first." };
    }
  }

  if (body.action === "ability" && p.alive) {
    if (p.role === "hollow" && room.phase === "playing") {
      if (roomNow(room) < p.killAt) return { ok: false, error: "The hunger has not returned." };
      const victim = killTarget(room, p);
      if (!victim) return { ok: false, error: "No one close enough." };
      doKill(room, p, victim);
      return { ok: true };
    }
    if (p.role === "crew" && room.phase === "playing" && !p.caged && !p.bellUsed && dist(p.x, BELL_X) < INTERACT_RANGE + 20) {
      p.bellUsed = true;
      p.stamina = Math.max(0, p.stamina - STAMINA_BELL_COST);
      p.match.bells++;
      record(room, p, "ring_bell", {});
      if (!room.replaying) bumpStats(p.id, p.name, { bells: 1 });
      beginMeeting(room, `${p.name} rang the bell`, p);
      return { ok: true };
    }
  }

  if (body.action === "blackout" && p.alive && p.role === "hollow" && room.phase === "playing") {
    const now = roomNow(room);
    if (now < room.blackoutReadyAt) return { ok: false, error: "The dark is not yet hungry again." };
    room.blackoutUntil = now + BLACKOUT_MS;
    room.blackoutReadyAt = now + BLACKOUT_CD_MS;
    p.stamina = Math.max(0, p.stamina - STAMINA_BLACKOUT_COST);
    if (!room.replaying) bumpStats(p.id, p.name, { blackouts: 1 });
    p.match.blackouts++;
    feed(room, "Every lantern in town is snuffed at once. The dark rushes in.");
    record(room, p, "blackout", { caged: p.caged });
    return { ok: true };
  }

  if (body.action === "vote" && room.phase === "meeting" && p.alive && body.vote) {
    if (!inMeetingArea(p)) return { ok: false, error: "Walk to the square to vote." };
    const v = body.vote;
    let valid = v === "skip";
    if (!valid && v.startsWith("free:")) {
      const t = room.players.get(v.slice(5));
      valid = !!t && t.caged;
    }
    if (!valid) {
      const t = room.players.get(v);
      valid = !!t && t.alive && !t.caged && t.id !== p.id;
    }
    if (!valid) return { ok: false, error: "Invalid vote." };
    p.vote = v;
    p.match.votes++;
    record(room, p, "vote", { target: v });
    // A visiting incarnation can vote, but its mere presence must not add an
    // extra required voter to the original meeting's quorum.
    const alivePs = [...room.players.values()].filter((q) => q.alive && !q.temporalAbsent && !(room.replaying && q.temporalVisitor === true && !q.vote));
    if (alivePs.every((q) => q.vote)) resolveMeeting(room);
    return { ok: true };
  }

  return { ok: true };
}

