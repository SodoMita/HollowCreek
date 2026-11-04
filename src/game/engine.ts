import { db } from "@/db";
import { gameEvents, roomRows, roomPlayers } from "@/db/schema";
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import { randomInt, randomUUID } from "node:crypto";
import {
  BELL_X, BLACKOUT_CD_MS, BLACKOUT_MS, BUBBLE_MS, CAGE_XS, CELL_HALF,
  CART_HELPER_BONUS, CART_MAX_SPEED, CART_PUSH_RANGE, CART_SOLO_SPEED,
  CAGE_UNLOCK_RANGE,
  CARRY_SPEED, CARRY_VIGOR_DRAIN, GHOST_SPEED, INTERACT_RANGE, KILL_COOLDOWN_MS,
  KILL_RANGE, MEETING_FROM, MEETING_MS, MEETING_TO, PLAYER_COLORS,
  SABOTAGE_COOLDOWN_MS, SABOTAGE_VIGOR_COST, SPEED, STAMINA_BELL_COST,
  STAMINA_BLACKOUT_COST, STAMINA_IDLE_REGEN, STAMINA_KILL_COST,
  STAMINA_UNLOCK_COST, STATIONS, SUPPLY_CART_START, TICK_MS, NIGHT_LENGTH_MS,
  VISION_BLACKOUT, VISION_CREW, VISION_HOLLOW, WORLD_W, TIMEPIECE_X, TIME_VISIT_MS, HISTORY_SAMPLE_MS, ix,
  NOTE_REACH, NOTE_TEXT_MAX,
} from "./types";
import { BUILDINGS, buildingHint, clampWorld, doorX, dropBuildingKeys, newDoors, interactWithBuilding, snapAnchor, walkThroughBuildings, type DoorState } from "./buildings";
import { bumpStats } from "./stats";
import { shuffle } from "./rng";
import { snapshotEtag } from "./fingerprint";
import { applyWardMove, createWardPuzzle, validWardMove, wardProgress, wardSolved, wardView, type WardPuzzle } from "./wards";
import type { FeedItem, InputBody, MatchStats, Note, Phase, Role, RoomListing, Snapshot } from "./types";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TaskState { id: string; done: boolean; delivered: boolean; sabotaged: boolean; progress: number; puzzle: WardPuzzle | null; previewUntil: number; supplyId?: string | null }
interface SupplyDrop { id: string; x: number }
interface HistoryEvent { at: number; actorId: string; name: string; x: number; inside: string | null; type: string; data: Record<string, unknown> }
type JournalEntry = { seq: number; at: number; kind: "input" | "tick" | "presence" | "leave" | "depart" | "return" | "respawn"; seed: number; playerId?: string; visitorId?: string; cursor?: number; lastSeen?: number; pieceId?: string; body?: InputBody };
export interface TimepieceState { id: string; x: number; holder: string | null; consumed: boolean }
interface HistoryFrame {
  at: number; seq: number; players: P[]; pool: TaskState[]; doors: DoorState[]; keyX: number | null; notes: Note[];
  phase: Phase; meeting: { endsAt: number; reason: string } | null; winner: Role | null; winReason: string | null;
  nextFlicker: number; blackoutReadyAt: number; timepieces: TimepieceState[]; timepiecePending: boolean; endedAt: number;
  supplyDrops: SupplyDrop[]; cartX: number; cartPushers: number;
  cages: { x: number; occupant: string | null }[];
  bodies: { x: number; color: string; name: string; id: string; at: number; inside: string | null }[];
  feed: FeedItem[]; events: HistoryEvent[]; bellAt: number; flickerAt: number; blackoutUntil: number;
}
interface ReplayAction { at: number; order: number; seed: number; body: InputBody }
interface TimeVisit {
  playerId: string; visitorId: string; pieceId: string; originAt: number; startedAt: number; endsAt: number;
  base: HistoryFrame; initial: P; actions: ReplayAction[]; lastReconcileAt: number; reconciling: boolean;
}
interface TimeRevision {
  playerId: string; visitorId: string; originAt: number; startedAt: number; endedAt: number; endCursor: number;
  initial: P; actions: ReplayAction[];
}

const newMatchStats = (): MatchStats => ({
  repairs: 0, kitsDelivered: 0, kills: 0, deaths: 0, timesCaged: 0,
  cagesOpened: 0, votes: 0, reports: 0, ruins: 0, bells: 0,
  blackouts: 0, distance: 0,
});

interface P {
  id: string;
  name: string;
  color: string;
  x: number;
  dir: number; // last INPUT direction (-1 | 0 | 1). Clients never send positions.
  facing: number;
  moving: boolean;
  alive: boolean;
  caged: boolean;
  cageIndex: number;
  inside: string | null;
  role: Role;
  stamina: number;
  exhausted: boolean;
  killAt: number;
  bellUsed: boolean;
  hasKey: boolean;
  hasSupply: boolean;
  supplyId: string | null;
  cartHeld: boolean;
  sabotageAt: number;
  match: MatchStats;
  bubbleText: string;
  bubbleUntil: number;
  actionText: string;
  actionUntil: number;
  interactHeld: boolean;
  activeWard: string | null;
  lastSeen: number;
  /** last time a presence entry was journaled — heartbeats are throttled to 1/30s */
  lastPresenceAt?: number;
  joinedAt: number;
  vote: string | null;
  isHost: boolean;
  /** true for a seat restored from the database that nobody has claimed yet */
  parked: boolean;
  temporalAbsent?: boolean;
  temporalVisitor?: boolean;
}

interface Room {
  code: string;
  phase: Phase;
  players: Map<string, P>;
  bodies: { x: number; color: string; name: string; id: string; at: number; inside: string | null }[];
  doors: DoorState[];
  keyX: number | null;
  supplyDrops: SupplyDrop[];
  notes: Note[];
  cartX: number;
  cartPushers: number;
  cages: { x: number; occupant: string | null }[];
  feed: FeedItem[];
  meeting: { endsAt: number; reason: string } | null;
  winner: Role | null;
  winReason: string | null;
  bellAt: number;
  flickerAt: number;
  nextFlicker: number;
  createdAt: number;
  startedAt: number;
  endedAt: number;
  /** Shared town wards — any living townfolk may work any of them. */
  pool: TaskState[];
  blackoutUntil: number;
  blackoutReadyAt: number;
  round: number;
  timepieces: TimepieceState[];
  timepiecePending: boolean;
  revisions: TimeRevision[];
  history: HistoryFrame[];
  historyEvents: HistoryEvent[];
  journal: JournalEntry[];
  journalSeq: number;
  /** bumped on every mutation (markDirty + each tick); etag cache keys off it */
  rev: number;
  /** per-player etag cache: valid while entry.rev === room.rev */
  etags: Map<string, { rev: number; etag: string }>;
  activeSeed: number;
  activeEventId: string;
  replaying?: boolean;
  replayNow?: number;
  replayVisitorId?: string;
  lastHistoryAt: number;
  timeVisit: TimeVisit | null;
  temporalShadow?: boolean;
  temporalAt?: number;
}

const g = globalThis as typeof globalThis & {
  __hollowRooms?: Map<string, Room>;
  __hollowRoomLoads?: Map<string, Promise<Room | undefined>>;
  __hollowLoop?: ReturnType<typeof setInterval>;
};
const rooms: Map<string, Room> = g.__hollowRooms ?? new Map();
g.__hollowRooms = rooms;
// Concurrent join/state requests after a restart must share one hydration.
// Otherwise each request can build a room and overwrite the previous one,
// leaving a player whose join already succeeded as "Unknown soul".
const roomLoads: Map<string, Promise<Room | undefined>> = g.__hollowRoomLoads ?? new Map();
g.__hollowRoomLoads = roomLoads;

// ---------------------------------------------------------------------------
// Chronicle — every player action is persisted
// ---------------------------------------------------------------------------

const roomNow = (room: Room) => room.replaying ? (room.replayNow ?? 0) : Math.max(Date.now(), room.journal.at(-1)?.at ?? 0);
const observedTypes = ["pickup_key", "supply_taken", "supply_recovered", "supply_delivered", "task_complete", "ward_ruined", "kill", "door_action", "unlock_cage", "chat", "timepiece_taken", "pin_note"];
function canonicalInput(body: InputBody): InputBody {
  const result: InputBody = { playerId: body.playerId };
  if (typeof body.dir === "number" && Number.isFinite(body.dir)) result.dir = body.dir;
  if (typeof body.interactHeld === "boolean") result.interactHeld = body.interactHeld;
  if (typeof body.cartHeld === "boolean") result.cartHeld = body.cartHeld;
  if (typeof body.action === "string" && ["interact", "ability", "blackout", "vote", "start", "restart", "leave", "drop_supply", "sabotage", "ward_move", "ward_cancel", "door_lock", "time_travel", "time_return", "pin_note"].includes(body.action)) result.action = body.action;
  if (typeof body.wardId === "string") result.wardId = body.wardId.slice(0, 128);
  if (typeof body.move === "number" && Number.isFinite(body.move)) result.move = body.move;
  if (typeof body.chat === "string") result.chat = body.chat.trim().slice(0, 120);
  if (typeof body.vote === "string") result.vote = body.vote; // preserve exact legacy player IDs during replay
  if (typeof body.targetAt === "number" && Number.isFinite(body.targetAt)) result.targetAt = body.targetAt;
  if (typeof body.noteText === "string") result.noteText = body.noteText.slice(0, NOTE_TEXT_MAX + 60); // server rejects overlong text
  return result;
}
function journal(room: Room, kind: JournalEntry["kind"], at: number, playerId?: string, body?: InputBody): JournalEntry {
  // Wall clocks can move backwards; journal order must not.
  at = Math.max(at, room.journal.at(-1)?.at ?? at);
  const entry: JournalEntry = { seq: ++room.journalSeq, at, kind, seed: randomInt(1, 0x7fffffff), playerId, body: body ? canonicalInput(body) : undefined };
  room.journal.push(entry); room.activeSeed = entry.seed; room.activeEventId = String(entry.seq);
  // Ticks (10–20/s) and presence heartbeats flood the chronicle; evict only those.
  if (room.journal.length > 1500) {
    let i = 0;
    while (room.journal.length > 1500 && i < room.journal.length) {
      if (room.journal[i].kind === "tick" || room.journal[i].kind === "presence") room.journal.splice(i, 1);
      else i++;
    }
  }
  return entry;
}
function seeded(room: Room, salt: string): number {
  let h = (room.activeSeed || 1) >>> 0;
  for (const ch of salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 0x7ffffffe) + 1;
}
function kitId(room: Room, p: P): string {
  return `kit:${room.code}:${room.round}:${room.activeEventId || randomUUID()}:${p.id}`;
}

function record(room: Room, p: P | null, type: string, data: Record<string, unknown> = {}) {
  if (p) {
    const actions: Record<string, string> = { pickup_key: "took the iron key", supply_taken: "took a repair kit", supply_recovered: "picked up a repair kit", timepiece_taken: "took the timepiece", pin_note: "pinned a page" };
    const doorPickup = type === "door_action" && typeof data.message === "string" && data.message.includes("found") ? data.message.replace(/^You found /, "took ") : null;
    const text = actions[type] ?? doorPickup;
    if (text) { p.actionText = text; p.actionUntil = roomNow(room) + 3500; }
  }
  if ((room.replaying || !room.temporalShadow) && room.phase !== "lobby" && ((p && observedTypes.includes(type)) || type === "meeting_result")) {
    room.historyEvents.push({ at: roomNow(room), actorId: p?.id ?? "", name: p?.name ?? "", x: p?.x ?? BELL_X, inside: p?.inside ?? null, type, data: { ...data } });
    if (room.historyEvents.length > 5000) room.historyEvents.shift();
  }
  if (room.replaying) return;
  db.insert(gameEvents)
    .values({
      roomCode: room.code,
      playerId: p?.id ?? null,
      playerName: p?.name ?? null,
      type,
      data: { phase: room.phase, x: p ? Math.round(p.x) : undefined, ...(room.temporalShadow ? { pastAt: room.temporalAt } : {}), ...data },
    })
    .catch((e) => console.error("chronicle write failed", e));
}

// ---------------------------------------------------------------------------
// Persistence — the same players repeat in the same room even across a server
// restart. Writes are queued and flushed on an interval so the tick loop never
// waits on the database.
// ---------------------------------------------------------------------------

const gPersist = globalThis as typeof globalThis & {
  __hollowDirtyRooms?: Set<string>;
  __hollowPersistTimer?: ReturnType<typeof setInterval>;
};
const dirtyRooms: Set<string> = gPersist.__hollowDirtyRooms ?? new Set();
gPersist.__hollowDirtyRooms = dirtyRooms;

// Change listeners for server-push (SSE) state streaming: fired on every
// mutation and every tick, so subscribers can re-fingerprint and push.
const roomListeners: Map<string, Set<() => void>> = new Map();
export function onRoomEvent(code: string, cb: () => void): () => void {
  let set = roomListeners.get(code);
  if (!set) { set = new Set(); roomListeners.set(code, set); }
  set.add(cb);
  return () => { set.delete(cb); if (set.size === 0) roomListeners.delete(code); };
}
function emitRoom(code: string) {
  for (const cb of roomListeners.get(code) ?? []) { try { cb(); } catch { /* listener bug must not break the room */ } }
}

function markDirty(room: Room) {
  if (room.replaying) return;
  room.rev++;
  dirtyRooms.add(room.code);
  emitRoom(room.code);
}

async function flushRooms() {
  const codes = [...dirtyRooms];
  dirtyRooms.clear();
  for (const code of codes) {
    const room = rooms.get(code);
    if (!room) continue;
    try {
      await db
        .insert(roomRows)
        .values({ code: room.code, phase: room.phase, round: room.round, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: roomRows.code,
          set: { phase: room.phase, round: room.round, updatedAt: new Date() },
        });
      const roster = [...room.players.values()];
      if (roster.length) {
        await db
          .insert(roomPlayers)
          .values(roster.map((p) => ({ id: p.id, code, name: p.name, color: p.color, joinedAt: new Date(p.joinedAt) })))
          .onConflictDoUpdate({
            target: roomPlayers.id,
            set: { name: sql`excluded.name`, color: sql`excluded.color`, joinedAt: sql`excluded.joined_at` },
          });
        await db
          .delete(roomPlayers)
          .where(and(eq(roomPlayers.code, code), notInArray(roomPlayers.id, roster.map((p) => p.id))));
      } else {
        await db.delete(roomPlayers).where(eq(roomPlayers.code, code));
      }
    } catch (e) {
      console.error("room persist failed", code, e);
    }
  }
}

// Chronicle rows older than 30 days are pruned once an hour — the table grows
// with every observed action otherwise.
let lastChroniclePrune = 0;
async function pruneChronicle() {
  const now = Date.now();
  if (now - lastChroniclePrune < 3_600_000) return;
  lastChroniclePrune = now;
  try {
    await db.delete(gameEvents).where(lt(gameEvents.createdAt, new Date(now - 30 * 86_400_000)));
  } catch (e) {
    console.error("chronicle prune failed", e);
  }
}

if (!gPersist.__hollowPersistTimer) {
  gPersist.__hollowPersistTimer = setInterval(() => { void flushRooms(); void pruneChronicle(); }, 900);
}

/** Bring a town back from Postgres: same code, same seats, same names. */
export async function loadRoom(code: string): Promise<Room | undefined> {
  const key = code.toUpperCase();
  const existing = rooms.get(key);
  if (existing) return existing;
  const pending = roomLoads.get(key);
  if (pending) return pending;
  const loading = hydrateRoom(key);
  roomLoads.set(key, loading);
  try {
    return await loading;
  } finally {
    if (roomLoads.get(key) === loading) roomLoads.delete(key);
  }
}

async function hydrateRoom(code: string): Promise<Room | undefined> {
  const key = code.toUpperCase();
  const existing = rooms.get(key);
  if (existing) return existing;
  let round = 0;
  let roster: { id: string; name: string; color: string; joinedAt: Date }[] = [];
  try {
    const rows = await db.select().from(roomRows).where(eq(roomRows.code, key)).limit(1);
    if (!rows.length) return undefined;
    round = rows[0].round ?? 0;
    roster = await db.select().from(roomPlayers).where(eq(roomPlayers.code, key));
  } catch (e) {
    console.error("room load failed", key, e);
    return undefined;
  }
  const room: Room = {
    code: key,
    // a night interrupted by a restart is over; the same people simply gather again
    phase: "lobby",
    round,
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
  };
  const seated = roster.slice().sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  seated.forEach((pr, i) => {
    room.players.set(pr.id, {
      id: pr.id,
      name: pr.name,
      color: pr.color,
      x: BELL_X + (i - 1) * 60,
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
      lastSeen: 0,
      joinedAt: pr.joinedAt.getTime(),
      vote: null,
      isHost: false,
      parked: true,
    });
  });
  // the newest returning player holds the lantern
  const newest = seated[seated.length - 1];
  if (newest) {
    const p = room.players.get(newest.id);
    if (p) p.isHost = true;
  }
  rooms.set(key, room);
  feed(room, "The town remembers everyone who has walked this street.");
  record(room, null, "room_restored", { seats: seated.length, round });
  dirtyRooms.add(key);
  return room;
}

function feed(room: Room, text: string) {
  room.feed.push({ text, at: roomNow(room) });
  if (room.feed.length > 24) room.feed.shift();
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

function makeCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => chars[randomInt(0, chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

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

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
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
export function listRoomsSync(): RoomListing[] {
  return [...rooms.values()]
    .filter((r) => r.players.size > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24)
    .map((r) => {
      const ps = [...r.players.values()];
      return {
        code: r.code,
        phase: r.phase,
        playerCount: ps.length,
        hostName: ps.find((p) => p.isHost)?.name ?? "—",
        names: ps.map((p) => p.name),
        createdAt: r.createdAt,
        round: r.round,
      };
    });
}

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
// Helpers
// ---------------------------------------------------------------------------

const dist = (a: number, b: number) => Math.abs(a - b);
/** Unused, unheld timepieces still lying on the road. */
export const loosePieces = (room: Room) => room.timepieces.filter((tp) => !tp.consumed && tp.holder === null);
/** The unconsumed timepiece a soul is carrying, if any. */
export const heldPiece = (room: Room, playerId: string) => room.timepieces.find((tp) => tp.holder === playerId && !tp.consumed);
export const usedPieces = (room: Room) => room.timepieces.filter((tp) => tp.consumed).length;
function nearestTimepiece(room: Room, p: P): TimepieceState | null {
  let best: TimepieceState | null = null;
  for (const tp of loosePieces(room)) {
    const distance = dist(tp.x, p.x);
    if (distance >= 55) continue;
    if (room.keyX !== null && dist(room.keyX, p.x) < INTERACT_RANGE && dist(room.keyX, p.x) < distance) continue;
    if (room.doors.some((door) => door.keyX !== null && dist(door.keyX, p.x) <= 44 && dist(door.keyX, p.x) < distance)) continue;
    if (!best || distance < dist(best.x, p.x)) best = tp;
  }
  return best;
}
function nearTimepiece(room: Room, p: P): boolean { return nearestTimepiece(room, p) !== null; }
const inMeetingArea = (p: P) => p.caged || (p.x >= MEETING_FROM && p.x <= MEETING_TO);

/** A key always targets the closest occupied lock within arm's reach. */
function nearestOccupiedCage(room: Room, x: number): number {
  let best = -1;
  let bestDistance = CAGE_UNLOCK_RANGE;
  room.cages.forEach((c, i) => {
    const d = Math.abs(c.x - x);
    if (c.occupant && d <= bestDistance) { best = i; bestDistance = d; }
  });
  return best;
}

function nearestBody(room: Room, p: P) {
  let best: Room["bodies"][number] | null = null;
  for (const b of room.bodies) if (b.inside === p.inside && dist(b.x, p.x) < INTERACT_RANGE + 20 && (!best || dist(b.x, p.x) < dist(best.x, p.x))) best = b;
  return best;
}

function killTarget(room: Room, p: P): P | null {
  let best: P | null = null;
  for (const t of room.players.values()) {
    if (t.id === p.id || t.temporalAbsent || t.id === room.timeVisit?.playerId || !t.alive || t.role === "hollow" || t.inside !== p.inside) continue;
    if (dist(t.x, p.x) <= KILL_RANGE && (!best || dist(t.x, p.x) < dist(best.x, p.x))) best = t;
  }
  return best;
}

function dropKey(room: Room, p: P) {
  if (p.hasKey) {
    p.hasKey = false;
    room.keyX = clampWorld(p.x, 60);
  }
}

function dropTimepiece(room: Room, p: P) {
  const tp = heldPiece(room, p.id);
  if (tp) { tp.holder = null; tp.x = clampWorld(p.x); }
}

function dropSupply(room: Room, p: P) {
  if (!p.hasSupply) return;
  const id = p.supplyId ?? kitId(room, p);
  p.hasSupply = false;
  p.supplyId = null;
  room.supplyDrops.push({ id, x: clampWorld(p.x) });
  // Carts can always provide more; don't retain unbounded abandoned kits.
  if (room.supplyDrops.length > 24) room.supplyDrops.shift();
}

/** Matching x alone is not enough: a house job belongs to its indoor layer. */
function stationNear(p: P, id: string, range = INTERACT_RANGE): boolean {
  const station = STATIONS.find((st) => st.id === id);
  return !!station && (station.inside ?? null) === p.inside && dist(station.x, p.x) < range;
}

/** When carrying a kit, the ward directly beside you wins over loose items. */
function tryDeliverSupply(room: Room, p: P): boolean {
  if (room.phase !== "playing" || p.caged || !p.hasSupply) return false;
  const ward = room.pool.find((t) => !t.done && !t.delivered && stationNear(p, t.id));
  if (!ward) return false;
  ward.delivered = true;
  ward.supplyId = p.supplyId;
  p.hasSupply = false;
  p.supplyId = null;
  feed(room, `${p.name} delivers a repair kit to ${STATIONS.find((st) => st.id === ward.id)!.name.toLowerCase()}.`);
  p.match.kitsDelivered++;
  record(room, p, "supply_delivered", { ward: ward.id, supplyId: ward.supplyId });
  if (canRepair(room, p) && !p.exhausted && p.stamina > 0) void beginRepair(room, p, ward);
  return true;
}

function cagePlayer(room: Room, p: P): boolean {
  const idx = room.cages.findIndex((c) => c.occupant === null);
  if (idx === -1) return false;
  dropTimepiece(room, p);
  dropBuildingKeys(room.doors, p.id, p.x, p.inside);
  dropKey(room, p);
  dropSupply(room, p);
  p.inside = null;
  room.cages[idx].occupant = p.id;
  p.caged = true;
  p.cageIndex = idx;
  p.match.timesCaged++;
  p.x = room.cages[idx].x;
  p.dir = 0;
  p.activeWard = null;
  return true;
}

function freePlayer(room: Room, p: P, stepOutside = true) {
  if (!p.caged || p.cageIndex < 0) return;
  const cage = room.cages[p.cageIndex];
  cage.occupant = null;
  p.caged = false;
  p.cageIndex = -1;
  if (stepOutside) {
    p.x = ix(Math.min(WORLD_W - 30, cage.x + CELL_HALF + 18));
    p.dir = 0;
  }
}

function canRepair(room: Room, p: P) { return p.role === "crew" || (!!room.temporalShadow && (!room.replaying || p.temporalVisitor === true)); }
function beginRepair(room: Room, p: P, task: TaskState): { ok: boolean; error?: string } {
  if (!canRepair(room, p)) return { ok: true }; // In the present the Hollow only pretends; in the past they may do real work.
  if (p.exhausted || p.stamina <= 0) return { ok: false, error: "Rest your vigor before repairing." };
  const st = STATIONS.find((s) => s.id === task.id)!;
  if (!stationNear(p, st.id)) return { ok: false, error: "Stand beside this ward in its room." };
  if (!task.puzzle) {
    task.puzzle = createWardPuzzle(st.kind, seeded(room, `ward:${st.id}`));
    if (task.puzzle.kind === "scarecrow") task.previewUntil = roomNow(room) + 3200;
  }
  p.activeWard = task.id;
  p.dir = 0;
  p.cartHeld = false;
  p.interactHeld = false;
  record(room, p, "ward_started", { task: task.id, kind: task.puzzle.kind });
  return { ok: true };
}

function beginMeeting(room: Room, reason: string, caller: P | null) {
  if (room.timeVisit) { const visitor = room.players.get(room.timeVisit.playerId); if (visitor) endTimeVisit(room, visitor, "meeting"); }
  room.phase = "meeting";
  room.cartPushers = 0;
  room.blackoutUntil = 0; // the gathering rekindles the lanterns
  room.meeting = { endsAt: roomNow(room) + MEETING_MS, reason };
  room.bellAt = roomNow(room);
  for (const p of room.players.values()) { p.vote = null; p.interactHeld = false; p.cartHeld = false; p.activeWard = null; }
  feed(room, "🔔 The bell tolls. All souls must walk to the square.");
  record(room, caller, "meeting_start", { reason });
}

function doKill(room: Room, killer: P, victim: P) {
  const victimWasCaged = victim.caged;
  const deathLayer = victim.inside;
  dropTimepiece(room, victim);
  dropBuildingKeys(room.doors, victim.id, victim.x, victim.inside);
  victim.alive = false;
  victim.dir = 0;
  victim.activeWard = null;
  dropKey(room, victim);
  dropSupply(room, victim);
  freePlayer(room, victim, false); // a killed prisoner dies inside the cell; body remains there
  room.bodies.push({ x: victim.x, color: victim.color, name: victim.name, id: victim.id, at: roomNow(room), inside: deathLayer });
  victim.inside = null; // ghosts cannot be trapped by a locked door
  killer.killAt = roomNow(room) + KILL_COOLDOWN_MS;
  killer.stamina = Math.max(0, killer.stamina - STAMINA_KILL_COST);
  killer.x = victim.x; // lunge
  feed(room, "A scream cuts through the fog, then silence.");
  killer.match.kills++;
  victim.match.deaths++;
  record(room, killer, "kill", { victim: victim.name, victimId: victim.id, victimCaged: victimWasCaged });
  if (!room.replaying) bumpStats(killer.id, killer.name, { kills: 1 });
  if (!room.replaying) bumpStats(victim.id, victim.name, { deaths: 1 });
  checkWin(room);
}

function checkWin(room: Room) {
  if ((room.temporalShadow && !room.replaying) || room.phase === "lobby" || room.phase === "ended") return;
  const ps = [...room.players.values()].filter((player) => !(room.replaying && player.temporalVisitor));
  const hollowFree = ps.filter((p) => p.role === "hollow" && p.alive && !p.caged).length;
  const crewFree = ps.filter((p) => p.role === "crew" && p.alive && !p.caged).length;
  const crewAll = ps.filter((p) => p.role === "crew");
  const tasksDone = room.pool.length > 0 && room.pool.every((t) => t.done);
  let winner: Role | null = null;
  let reason = "";
  if (tasksDone && crewAll.length > 0) { winner = "crew"; reason = "Every ward is restored. The Hollow starves and retreats."; }
  else if (crewAll.every((p) => !p.alive)) { winner = "hollow"; reason = "No living townfolk remain to mend the wards."; }
  else if (hollowFree > 0 && hollowFree >= crewFree) { winner = "hollow"; reason = "The Hollow outnumber the free living townfolk. Hollow Creek belongs to them now."; }
  // Cages are not proof and never grant a crew win. The town must finish wards.
  if (winner) {
    if (room.timeVisit) { const visitor = room.players.get(room.timeVisit.playerId); if (visitor) endTimeVisit(room, visitor, "night ended"); }
    room.phase = "ended";
    room.endedAt = roomNow(room);
    markDirty(room);
    room.winner = winner;
    room.winReason = reason;
    room.meeting = null;
    feed(room, winner === "crew" ? "Dawn breaks over Hollow Creek." : "The last lantern goes out.");
    record(room, null, "game_end", { winner, reason });
    const playtimeSec = Math.max(0, Math.round((roomNow(room) - room.startedAt) / 1000));
    for (const p of room.players.values()) {
      if (!room.replaying) bumpStats(p.id, p.name, {
        games: 1,
        wins: p.role === winner ? 1 : 0,
        losses: p.role === winner ? 0 : 1,
        playtimeSec,
      });
    }
  }
}

function resolveMeeting(room: Room) {
  const votes = new Map<string, number>();
  for (const p of room.players.values()) if (!p.temporalAbsent && p.vote) votes.set(p.vote, (votes.get(p.vote) ?? 0) + 1);
  let top: string | null = null;
  let topN = 0;
  let tie = false;
  for (const [k, n] of votes) {
    if (n > topN) { top = k; topN = n; tie = false; }
    else if (n === topN) tie = true;
  }
  record(room, null, "meeting_result", { tally: Object.fromEntries(votes), top: tie ? null : top });
  if (!top || tie || top === "skip") {
    feed(room, "The town could not agree. The cages stay as they are.");
  } else if (top.startsWith("free:")) {
    const p = room.players.get(top.slice(5));
    if (p && p.caged) {
      freePlayer(room, p);
      feed(room, `${p.name} is released from the iron cage.`);
    }
  } else {
    const p = room.players.get(top);
    if (p && p.alive && !p.caged) {
      if (cagePlayer(room, p)) {
        feed(room, `The town drags ${p.name} into a cage. They can still speak…`);
        if (!room.replaying) bumpStats(p.id, p.name, { cagings: 1 });
      } else feed(room, "Every cage is already full. The verdict is void.");
    }
  }
  room.bodies = [];
  room.meeting = null;
  room.phase = "playing";
  for (const p of room.players.values()) { p.vote = null; if (p.role === "hollow") p.killAt = roomNow(room) + 10000; }
  if (!room.replaying && room.timepiecePending) spawnNextTimepiece(room, roomNow(room));
  checkWin(room);
}

// ---------------------------------------------------------------------------
// The timepiece: server-owned snapshots and a single temporary past layer.
// History is sampled rather than trusting a client-provided world state.
// ---------------------------------------------------------------------------

function captureHistory(room: Room, now: number, force = false) {
  if (room.temporalShadow || (room.phase !== "playing" && room.phase !== "meeting")) return;
  if (!force && now - room.lastHistoryAt < HISTORY_SAMPLE_MS) return;
  room.lastHistoryAt = now;
  room.history.push({
    at: now, seq: room.journalSeq, phase: room.phase, meeting: structuredClone(room.meeting), winner: room.winner, winReason: room.winReason,
    nextFlicker: room.nextFlicker, blackoutReadyAt: room.blackoutReadyAt, timepieces: structuredClone(room.timepieces), timepiecePending: room.timepiecePending, endedAt: room.endedAt,
    players: structuredClone([...room.players.values()].filter((p) => p.id !== room.timeVisit?.playerId)),
    pool: structuredClone(room.pool), doors: structuredClone(room.doors), keyX: room.keyX,
    supplyDrops: structuredClone(room.supplyDrops), notes: structuredClone(room.notes), cartX: room.cartX, cartPushers: room.cartPushers,
    cages: structuredClone(room.cages), bodies: structuredClone(room.bodies), feed: structuredClone(room.feed), events: structuredClone(room.historyEvents.slice(-32)),
    bellAt: room.bellAt, flickerAt: room.flickerAt, blackoutUntil: room.blackoutUntil,
  });
  // Keep the whole night selectable while progressively thinning older samples.
  if (room.history.length > 7200) {
    const older = room.history.slice(0, 3600).filter((_, index) => index % 2 === 0);
    room.history = older.concat(room.history.slice(3600));
  }
}

function frameAt(room: Room, at: number): HistoryFrame | null {
  if (!room.history.length) return null;
  let lo = 0, hi = room.history.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (room.history[mid].at <= at) lo = mid; else hi = mid - 1;
  }
  return room.history[lo];
}

/** Restore a checkpoint without sharing mutable objects or performing I/O. */
function restoreFrame(room: Room, frame: HistoryFrame): Room {
  return {
    ...room, replaying: true, temporalShadow: true, replayNow: frame.at, replayVisitorId: undefined,
    timeVisit: null, history: [], historyEvents: structuredClone(frame.events), journal: [], journalSeq: frame.seq,
    phase: frame.phase, meeting: structuredClone(frame.meeting), winner: frame.winner, winReason: frame.winReason,
    nextFlicker: frame.nextFlicker, blackoutReadyAt: frame.blackoutReadyAt, endedAt: frame.endedAt,
    timepieces: structuredClone(frame.timepieces), timepiecePending: frame.timepiecePending,
    players: new Map(frame.players.map((player) => [player.id, structuredClone(player)])),
    pool: structuredClone(frame.pool), doors: structuredClone(frame.doors), keyX: frame.keyX,
    supplyDrops: structuredClone(frame.supplyDrops), notes: structuredClone(frame.notes), cartX: frame.cartX, cartPushers: frame.cartPushers,
    cages: structuredClone(frame.cages), bodies: structuredClone(frame.bodies), feed: structuredClone(frame.feed),
    bellAt: frame.bellAt, flickerAt: frame.flickerAt, blackoutUntil: frame.blackoutUntil,
  };
}

function replayDeparture(room: Room, playerId: string, pieceId?: string) {
  const player = room.players.get(playerId);
  if (!player) return;
  dropKey(room, player); dropSupply(room, player); dropBuildingKeys(room.doors, player.id, player.x, player.inside);
  const spent = pieceId ? room.timepieces.find((tp) => tp.id === pieceId) : undefined;
  if (spent && !spent.consumed) { spent.consumed = true; spent.holder = null; }
  for (const tp of room.timepieces) if (tp.holder === playerId) { tp.consumed = true; tp.holder = null; }
  player.temporalAbsent = true; player.dir = 0; player.cartHeld = false; player.interactHeld = false; player.activeWard = null;
  feed(room, "The timepiece breaks. A soul slips out of the present.");
}

function replayLeave(room: Room, playerId: string) {
  const player = room.players.get(playerId);
  if (!player) return;
  record(room, player, "leave", { lobby: false });
  dropTimepiece(room, player); dropKey(room, player); dropSupply(room, player); dropBuildingKeys(room.doors, player.id, player.x, player.inside);
  player.dir = 0; player.cartHeld = false; player.activeWard = null; player.lastSeen = 0;
  if (player.isHost) {
    player.isHost = false;
    const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
    if (next) { next.isHost = true; feed(room, `${next.name} now holds the town lantern (host).`); }
  }
}

function replayReturn(room: Room, playerId: string, visitorId: string, cursor: number, at: number, lastSeen: number) {
  const original = room.players.get(playerId), visitor = room.players.get(visitorId);
  if (!original || !visitor) return;
  const match = mergeMatch(original.match, visitor.match), role = original.role, host = original.isHost;
  if (original.alive && !original.caged && visitor.alive && !visitor.caged) {
    const next = structuredClone(visitor);
    next.id = playerId; next.role = role; next.isHost = host; next.match = match; next.temporalAbsent = false; next.temporalVisitor = false; next.lastSeen = lastSeen;
    next.dir = 0; next.moving = false; next.cartHeld = false; next.interactHeld = false; next.activeWard = null;
    next.killAt = at + Math.max(0, visitor.killAt - cursor); next.sabotageAt = at + Math.max(0, visitor.sabotageAt - cursor);
    next.bubbleUntil = visitor.bubbleUntil ? at + Math.max(0, visitor.bubbleUntil - cursor) : 0;
    next.actionUntil = visitor.actionUntil ? at + Math.max(0, visitor.actionUntil - cursor) : 0;
    Object.assign(original, next);
    for (const door of room.doors) if (door.holder === visitorId) door.holder = playerId;
  } else {
    if (!visitor.alive && original.alive) {
      original.x = visitor.x; original.inside = visitor.inside;
      dropBuildingKeys(room.doors, original.id, original.x, original.inside); dropKey(room, original); dropSupply(room, original);
      original.alive = false; original.caged = false; original.cageIndex = -1; original.inside = null; original.dir = 0;
      const body = room.bodies.find((item) => item.id === visitorId);
      if (body) body.id = playerId;
      else if (!room.bodies.some((item) => item.id === playerId)) room.bodies.push({ x: visitor.x, color: visitor.color, name: visitor.name, id: playerId, at, inside: visitor.inside });
    } else if (visitor.caged && original.alive && !original.caged) cagePlayer(room, original);
    dropBuildingKeys(room.doors, visitor.id, visitor.x, visitor.inside); dropKey(room, visitor); dropSupply(room, visitor);
    original.match = match; original.temporalAbsent = false; original.temporalVisitor = false; original.lastSeen = lastSeen;
    original.dir = 0; original.moving = false; original.cartHeld = false; original.interactHeld = false; original.activeWard = null;
  }
  room.players.delete(visitorId);
  feed(room, `${original.name} returns as the timepiece falls silent.`);
  checkWin(room);
}

function applyJournalEntry(room: Room, entry: JournalEntry): { ok: boolean; error?: string } | undefined {
  room.replayNow = entry.at; room.activeSeed = entry.seed; room.activeEventId = String(entry.seq);
  if (entry.kind === "tick") tickRoom(room, entry.at);
  else if (entry.kind === "presence" && entry.playerId) { const player = room.players.get(entry.playerId); if (player) player.lastSeen = entry.at; }
  else if (entry.kind === "leave" && entry.playerId) replayLeave(room, entry.playerId);
  else if (entry.kind === "depart" && entry.playerId) replayDeparture(room, entry.playerId, entry.pieceId);
  else if (entry.kind === "return" && entry.playerId && entry.visitorId) replayReturn(room, entry.playerId, entry.visitorId, entry.cursor ?? entry.at, entry.at, entry.lastSeen ?? entry.at);
  else if (entry.kind === "respawn") { room.timepieces.push({ id: `tp${room.timepieces.length}`, x: TIMEPIECE_X, holder: null, consumed: false }); room.timepiecePending = false; }
  else if (entry.kind === "input" && entry.body) return handleInput(room, entry.body);
  return undefined;
}

/** Test hook: nearest pinnable wall/tree anchor to a world x. */
export const snapAnchorForTest = (x: number) => snapAnchor(x);

/** Test hook: the shadow past-world a live visit currently sees at `until`. */
export function simulatePastForTest(room: Room, until: number): Room | null {
  return room.timeVisit ? simulatePast(room, room.timeVisit, until).room : null;
}

/** Internal replay entry point, also used by deterministic regression tests. */
export function replayRecordedState(room: Room, checkpointSeq: number, throughSeq: number): Room | null {
  const frame = room.history.find((item) => item.seq === checkpointSeq);
  if (!frame) return null;
  const replay = restoreFrame(room, frame);
  for (const entry of room.journal) if (entry.seq > frame.seq && entry.seq <= throughSeq) applyJournalEntry(replay, entry);
  return replay;
}

function visitCursor(visit: TimeVisit, now: number) {
  return Math.min(now, visit.originAt + Math.max(0, now - visit.startedAt));
}

type ReplayTimelineItem = { at: number; rank: number; order: number; original?: JournalEntry; arrival?: { id: string; initial: P }; action?: { id: string; entry: ReplayAction }; consume?: { id: string; entry: ReplayAction }; suspend?: string };

function timelineItems(room: Room, visit: TimeVisit, until: number): ReplayTimelineItem[] {
  // Sequence numbers are contiguous, so skip the unchanged prefix instead of
  // scanning the entire night on every past frame.
  const items: ReplayTimelineItem[] = [];
  for (let i = visit.base.seq; i < room.journal.length; i++) {
    const entry = room.journal[i];
    if (entry.at > until) break;
    items.push({ at: entry.at, rank: 0, order: entry.seq, original: entry });
  }
  for (const revision of room.revisions) {
    if (revision.originAt >= visit.base.at && revision.originAt <= until) items.push({ at: revision.originAt, rank: 1, order: 0, arrival: { id: revision.visitorId, initial: revision.initial } });
    for (const entry of revision.actions) if (entry.at >= visit.base.at && entry.at <= until) {
      if (entry.body.action === "time_travel") items.push({ at: entry.at, rank: 2, order: entry.order, consume: { id: revision.visitorId, entry } });
      else items.push({ at: entry.at, rank: 2, order: entry.order, action: { id: revision.visitorId, entry } });
    }
    if (revision.endCursor >= visit.base.at && revision.endCursor <= until) items.push({ at: revision.endCursor, rank: 3, order: 0, suspend: revision.visitorId });
  }
  if (visit.originAt <= until) items.push({ at: visit.originAt, rank: 1, order: 1, arrival: { id: visit.visitorId, initial: visit.initial } });
  for (const entry of visit.actions) if (entry.at <= until) {
    if (entry.body.action === "time_travel") items.push({ at: entry.at, rank: 2, order: entry.order, consume: { id: visit.visitorId, entry } });
    else items.push({ at: entry.at, rank: 2, order: entry.order, action: { id: visit.visitorId, entry } });
  }
  return items.sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order);
}

function applyTimelineItem(sim: Room, item: ReplayTimelineItem): { ok: boolean; error?: string } | undefined {
  if (item.original) return applyJournalEntry(sim, item.original);
  sim.replayNow = item.at;
  if (item.arrival && !sim.players.has(item.arrival.id)) {
    const visitor = structuredClone(item.arrival.initial);
    visitor.id = item.arrival.id; visitor.lastSeen = item.at; visitor.temporalAbsent = false;
    sim.players.set(visitor.id, visitor);
  } else if (item.suspend) {
    const visitor = sim.players.get(item.suspend);
    if (visitor) { visitor.temporalAbsent = true; visitor.dir = 0; visitor.moving = false; visitor.cartHeld = false; }
  } else if (item.consume) {
    // A timepiece used inside the past: the held piece is spent at this moment.
    const tp = sim.timepieces.find((t2) => t2.holder === item.consume!.id && !t2.consumed);
    if (tp) { tp.consumed = true; tp.holder = null; }
    sim.replayNow = item.at;
    return { ok: true };
  } else if (item.action) {
    sim.activeSeed = item.action.entry.seed; sim.activeEventId = `visit:${item.action.id}:${item.action.entry.order}`;
    return handleInput(sim, { ...item.action.entry.body, playerId: item.action.id });
  }
  return undefined;
}

/** Replay real commands and every earlier visit in chronological order. */
function simulatePast(room: Room, visit: TimeVisit, until: number, resultOrder?: number): { room: Room; result?: { ok: boolean; error?: string } } {
  // Nested time travel: using a timepiece inside the past re-bases the whole
  // visit at that earlier recorded moment, and every recorded action (including
  // the earlier ones) replays forward from there. The visit itself — the causal
  // anchor — is never removed.
  let base = visit.base, originAt = visit.originAt;
  for (const a of visit.actions) {
    if (a.at > until) break;
    if (a.body.action === "time_travel" && typeof a.body.targetAt === "number" && Number.isFinite(a.body.targetAt)) {
      const frame = room.revisions.length ? room.history[0] : frameAt(room, a.body.targetAt);
      if (frame) { base = structuredClone(frame); originAt = a.body.targetAt; }
    }
  }
  const eff: TimeVisit = { ...visit, base, originAt };
  const sim = restoreFrame(room, base);
  sim.replayVisitorId = visit.visitorId;
  let result: { ok: boolean; error?: string } | undefined;
  for (const item of timelineItems(room, eff, until)) {
    const applied = applyTimelineItem(sim, item);
    if (item.action?.id === visit.visitorId && item.action.entry.order === resultOrder) result = applied;
  }
  sim.replayNow = until;
  return { room: sim, result };
}

function replayFuture(room: Room, visit: TimeVisit, past: Room, cursor: number, now: number): Room {
  const future = structuredClone(past);
  const visitor = future.players.get(visit.visitorId);
  if (visitor) { visitor.temporalAbsent = true; visitor.dir = 0; visitor.moving = false; visitor.cartHeld = false; }
  for (const item of timelineItems(room, visit, now)) if (item.at > cursor) applyTimelineItem(future, item);
  future.replayNow = now;
  return future;
}

function copyActor(target: P, source: P) {
  const lastSeen = target.lastSeen, joinedAt = target.joinedAt, parked = target.parked, id = target.id;
  Object.assign(target, structuredClone(source), { id, lastSeen, joinedAt, parked, temporalAbsent: false, temporalVisitor: false });
}

function mergeMatch(original: MatchStats, visit: MatchStats): MatchStats {
  const result = { ...original };
  for (const key of Object.keys(result) as (keyof MatchStats)[]) result[key] += visit[key];
  return result;
}

function reconcileFuture(room: Room, visit: TimeVisit, now: number, past?: Room) {
  if (visit.reconciling) return;
  visit.reconciling = true;
  try {
    const cursor = visitCursor(visit, now);
    const branch = past ?? simulatePast(room, visit, cursor).room;
    const visitor = branch.players.get(visit.visitorId);
    if (!visitor) return;
    const future = replayFuture(room, visit, branch, cursor, now);
    const originalSelf = future.players.get(visit.playerId), futureVisitor = future.players.get(visit.visitorId);
    // An altered history can kill or cage either incarnation. The present
    // traveler must inherit that outcome rather than being immune to the replay.
    if (originalSelf && !visitor.alive && originalSelf.alive) {
      originalSelf.x = visitor.x; originalSelf.inside = visitor.inside;
      dropBuildingKeys(future.doors, originalSelf.id, originalSelf.x, originalSelf.inside); dropKey(future, originalSelf); dropSupply(future, originalSelf);
      originalSelf.alive = false; originalSelf.caged = false; originalSelf.cageIndex = -1; originalSelf.dir = 0; originalSelf.inside = null;
      const temporalBody = future.bodies.find((body) => body.id === visit.visitorId);
      if (temporalBody) temporalBody.id = originalSelf.id;
      else if (!future.bodies.some((body) => body.id === originalSelf.id)) future.bodies.push({ x: visitor.x, color: visitor.color, name: visitor.name, id: originalSelf.id, at: now, inside: visitor.inside });
      checkWin(future);
    }
    if (originalSelf && futureVisitor && (!originalSelf.alive || originalSelf.caged)) {
      // Belongings carried by the visiting incarnation must not remain reserved
      // by an absent synthetic player after the paradox forces them back.
      dropBuildingKeys(future.doors, futureVisitor.id, futureVisitor.x, futureVisitor.inside);
      dropKey(future, futureVisitor); dropSupply(future, futureVisitor);
    }
    const priorPhase = room.phase;
    const priorFingerprint = JSON.stringify([room.pool.map((task) => [task.done, task.delivered, task.sabotaged]), room.keyX, room.doors.map((door) => [door.locked, door.open, door.holder, door.keyX]), [...room.players.values()].map((player) => [player.id, player.alive, player.caged, player.hasKey, player.supplyId])]);
    const statKeys: [keyof MatchStats, "kills" | "deaths" | "tasksDone" | "cagings" | "unlocks" | "reports" | "blackouts" | "bells"][] = [
      ["kills", "kills"], ["deaths", "deaths"], ["repairs", "tasksDone"], ["timesCaged", "cagings"], ["cagesOpened", "unlocks"], ["reports", "reports"], ["blackouts", "blackouts"], ["bells", "bells"],
    ];
    for (const live of room.players.values()) {
      const simulated = future.players.get(live.id);
      if (!simulated) continue;
      const nextMatch = live.id === visit.playerId ? mergeMatch(simulated.match, visitor.match) : simulated.match;
      const deltas: Record<string, number> = {};
      for (const [field, stat] of statKeys) { const delta = nextMatch[field] - live.match[field]; if (delta) deltas[stat] = delta; }
      if (Object.keys(deltas).length) bumpStats(live.id, live.name, deltas);
      if (live.id === visit.playerId) {
        const observed = structuredClone(!simulated.alive || simulated.caged ? simulated : visitor);
        observed.match = nextMatch; observed.id = live.id; observed.isHost = simulated.isHost;
        // Cooldowns and visible notices are measured on the historical clock while visiting.
        observed.killAt = now + Math.max(0, visitor.killAt - cursor);
        observed.sabotageAt = now + Math.max(0, visitor.sabotageAt - cursor);
        observed.bubbleUntil = visitor.bubbleUntil ? now + Math.max(0, visitor.bubbleUntil - cursor) : 0;
        observed.actionUntil = visitor.actionUntil ? now + Math.max(0, visitor.actionUntil - cursor) : 0;
        copyActor(live, observed);
      } else copyActor(live, simulated);
    }
    room.pool = structuredClone(future.pool);
    room.doors = structuredClone(future.doors).map((door) => ({ ...door, holder: door.holder === visit.visitorId ? visit.playerId : door.holder }));
    room.keyX = future.keyX; room.supplyDrops = structuredClone(future.supplyDrops); room.cartX = future.cartX; room.cartPushers = future.cartPushers;
    room.notes = structuredClone(future.notes).map((note) => note.authorId === visit.visitorId && room.players.get(visit.playerId)
      ? { ...note, authorId: visit.playerId, authorName: room.players.get(visit.playerId)!.name } : note);
    room.cages = structuredClone(future.cages); room.bodies = structuredClone(future.bodies).map((body) => ({ ...body, id: body.id === visit.visitorId ? visit.playerId : body.id }));
    room.feed = structuredClone(future.feed);
    room.blackoutUntil = future.blackoutUntil; room.blackoutReadyAt = future.blackoutReadyAt; room.bellAt = future.bellAt; room.flickerAt = future.flickerAt; room.nextFlicker = future.nextFlicker;
    room.phase = future.phase; room.meeting = structuredClone(future.meeting); room.winner = future.winner; room.winReason = future.winReason; room.endedAt = future.endedAt;
    room.timepieces = structuredClone(future.timepieces);
    // The piece spent at departure predates the visit's base frame, so force it.
    const spent = room.timepieces.find((tp) => tp.id === visit.pieceId);
    if (spent && !spent.consumed) { spent.consumed = true; spent.holder = null; }
    const changed = JSON.stringify([room.pool.map((task) => [task.done, task.delivered, task.sabotaged]), room.keyX, room.doors.map((door) => [door.locked, door.open, door.holder, door.keyX]), [...room.players.values()].map((player) => [player.id, player.alive, player.caged, player.hasKey, player.supplyId])]);
    if (changed !== priorFingerprint) { feed(room, "The past changes; the night reshapes around it."); record(room, room.players.get(visit.playerId) ?? null, "time_replay", { pastAt: cursor }); }
    if (priorPhase !== "ended" && room.phase === "ended" && room.winner) {
      for (const player of room.players.values()) bumpStats(player.id, player.name, { games: 1, wins: player.role === room.winner ? 1 : 0, losses: player.role === room.winner ? 0 : 1, playtimeSec: Math.max(0, Math.round((room.endedAt - room.startedAt) / 1000)) });
      markDirty(room);
    }
    visit.lastReconcileAt = now;
  } finally { visit.reconciling = false; }
}

function spawnNextTimepiece(room: Room, now: number) {
  if (room.replaying || usedPieces(room) >= 2 || room.phase !== "playing") return;
  if (loosePieces(room).length) { room.timepiecePending = false; return; } // pieces already on the road
  room.timepieces.push({ id: `tp${room.timepieces.length}`, x: TIMEPIECE_X, holder: null, consumed: false });
  room.timepiecePending = false;
  journal(room, "respawn", now);
  feed(room, "Another timepiece settles onto the road.");
}

function endTimeVisit(room: Room, p: P, reason: string) {
  const visit = room.timeVisit;
  if (!visit || visit.playerId !== p.id) return;
  const now = roomNow(room), cursor = visitCursor(visit, now);
  reconcileFuture(room, visit, now);
  room.timeVisit = null;
  room.revisions.push({ playerId: visit.playerId, visitorId: visit.visitorId, originAt: visit.originAt, startedAt: visit.startedAt, endedAt: now, endCursor: cursor, initial: structuredClone(visit.initial), actions: structuredClone(visit.actions) });
  const entry = journal(room, "return", now, p.id); entry.visitorId = visit.visitorId; entry.cursor = cursor; entry.lastSeen = p.lastSeen;
  p.dir = 0; p.cartHeld = false; p.interactHeld = false; p.activeWard = null;
  feed(room, `${p.name} returns as the timepiece falls silent.`);
  record(room, p, "time_return", { reason, pastAt: cursor });
  if (usedPieces(room) < 2) {
    if (room.phase === "playing") spawnNextTimepiece(room, now);
    else if (room.phase === "meeting") room.timepiecePending = true;
  }
}

function startTimeVisit(room: Room, p: P, target: unknown): { ok: boolean; error?: string } {
  if (room.phase !== "playing" || !p.alive || p.caged || room.timeVisit || !heldPiece(room, p.id))
    return { ok: false, error: "You need an unused timepiece and a free living soul." };
  const first = room.history[0], last = room.history.at(-1);
  if (!first || !last || typeof target !== "number" || !Number.isFinite(target) || target < first.at || target > last.at)
    return { ok: false, error: "Choose a recorded moment from this night." };
  const frame = room.revisions.length ? room.history[0] : frameAt(room, target);
  if (!frame) return { ok: false, error: "That moment is not recorded." };
  const now = roomNow(room), killCooldown = Math.max(0, p.killAt - now), sabotageCooldown = Math.max(0, p.sabotageAt - now);
  const piece = heldPiece(room, p.id)!;
  const depart = journal(room, "depart", now, p.id); depart.pieceId = piece.id;
  dropKey(room, p); dropSupply(room, p); dropBuildingKeys(room.doors, p.id, p.x, p.inside);
  piece.consumed = true; piece.holder = null;
  const visitorId = `visit:${p.id}:${usedPieces(room)}:${now}`;
  const initial = structuredClone(p);
  initial.id = visitorId; initial.temporalVisitor = true; initial.match = newMatchStats(); initial.dir = 0; initial.cartHeld = false; initial.interactHeld = false; initial.activeWard = null;
  initial.killAt = target + killCooldown; initial.sabotageAt = target + sabotageCooldown; initial.bubbleUntil = 0; initial.actionUntil = 0; initial.isHost = false;
  room.timeVisit = { playerId: p.id, visitorId, pieceId: piece.id, originAt: target, startedAt: now, endsAt: now + TIME_VISIT_MS,
    base: structuredClone(frame), initial, actions: [], lastReconcileAt: now, reconciling: false };
  p.dir = 0; p.cartHeld = false; p.interactHeld = false; p.activeWard = null;
  feed(room, "The timepiece breaks. A soul slips out of the present.");
  record(room, p, "time_depart", { pastAt: target });
  return { ok: true };
}

function pastRoom(room: Room, visit: TimeVisit, now: number): Room | null {
  return simulatePast(room, visit, visitCursor(visit, now)).room;
}

function handlePastInput(room: Room, p: P, body: InputBody): { ok: boolean; error?: string } {
  const visit = room.timeVisit;
  if (!visit || visit.playerId !== p.id) return { ok: false, error: "The past has closed." };
  const now = roomNow(room);
  if (now >= visit.endsAt || body.action === "time_return") { endTimeVisit(room, p, now >= visit.endsAt ? "time expired" : "returned early"); return { ok: true }; }
  if (body.action === "start" || body.action === "restart") return { ok: false, error: "That action is unavailable while traveling." };
  const cursor = visitCursor(visit, now), order = visit.actions.length + 1;
  if (body.action === "time_travel") {
    // Time travel in time travel: allowed only with an unused timepiece that
    // exists in the past (picked up there), targeting an earlier recorded moment.
    const target = body.targetAt;
    const first = room.history[0], last = room.history.at(-1);
    if (!first || !last || typeof target !== "number" || !Number.isFinite(target) || target < first.at || target > Math.min(cursor, last.at))
      return { ok: false, error: "Choose an earlier recorded moment from this night." };
    const sim = simulatePast(room, visit, cursor).room;
    if (!heldPiece(sim, visit.visitorId)) return { ok: false, error: "You need an unused timepiece in this moment." };
  }
  const normalized = { ...canonicalInput(body), playerId: visit.visitorId };
  if (typeof normalized.vote === "string") normalized.vote = normalized.vote.replace(/^echo:/, "").replace(/^free:echo:/, "free:");
  visit.actions.push({ at: cursor, order, seed: randomInt(1, 0x7fffffff), body: normalized });
  const simulated = simulatePast(room, visit, cursor, order);
  reconcileFuture(room, visit, now, simulated.room);
  if (room.timeVisit === visit && (!p.alive || p.caged || room.phase !== "playing")) endTimeVisit(room, p, "timeline changed");
  return simulated.result ?? { ok: true };
}

function pastSnapshot(room: Room, p: P, visit: TimeVisit, now: number): Snapshot | null {
  const cursor = visitCursor(visit, now), shadow = simulatePast(room, visit, cursor).room;
  const view = snapshot(shadow, visit.visitorId);
  if (!view) return null;
  const shift = now - cursor;
  view.players = view.players.map((player) => ({ ...player,
    id: player.id === visit.visitorId ? p.id : `echo:${player.id}`,
    echo: player.id !== visit.visitorId,
    bubble: player.bubble ? { ...player.bubble, until: player.bubble.until + shift } : null,
    action: player.action ? { ...player.action, until: player.action.until + shift } : null,
  }));
  view.cages = view.cages.map((cage) => ({ ...cage, occupant: cage.occupant ? (cage.occupant === visit.visitorId ? p.id : `echo:${cage.occupant}`) : null }));
  view.doors = view.doors?.map((door) => ({ ...door, holder: door.holder ? (door.holder === visit.visitorId ? p.id : `echo:${door.holder}`) : null }));
  view.bodies = view.bodies.map((body) => ({ ...body, at: body.at ? body.at + shift : 0 }));
  view.feed = view.feed.map((item) => ({ ...item, at: item.at + shift }));
  const labels: Record<string, string> = { pickup_key: "picked up the iron key", supply_taken: "took a repair kit", supply_recovered: "recovered a repair kit", supply_delivered: "delivered a kit", task_complete: "completed a ward", ward_ruined: "ruined a ward", kill: "struck someone", unlock_cage: "opened a cage", timepiece_taken: "took the timepiece", pin_note: "pinned a page" };
  const label = (event: HistoryEvent) => event.type === "door_action" && typeof event.data.message === "string" && event.data.message.includes("found")
    ? event.data.message.replace(/^You found /, "took ").replace(/\.$/, "") : labels[event.type];
  const witnessed = shadow.historyEvents.filter((event) => event.at <= cursor && event.at >= cursor - 8000 && event.actorId !== visit.visitorId && event.inside === p.inside && dist(event.x, p.x) <= view.visionRadius && label(event)).slice(-4)
    .map((event) => ({ text: `Past echo: ${event.name} ${label(event)}.`, at: now - (cursor - event.at) }));
  view.feed = [...view.feed, ...witnessed].slice(-8);
  view.self.id = p.id; view.self.hasTimepiece = !!heldPiece(shadow, visit.visitorId);
  view.self.teammates = view.self.teammates.map((id) => id === visit.visitorId ? p.id : `echo:${id}`);
  view.now = now;
  view.bellAt = view.bellAt ? view.bellAt + shift : 0; view.flickerAt = view.flickerAt ? view.flickerAt + shift : 0; view.blackoutUntil = view.blackoutUntil ? view.blackoutUntil + shift : 0;
  if (view.meeting) view.meeting.endsAt += shift;
  view.time = { mode: "past", earliest: room.history[0]?.at ?? visit.originAt, latest: room.history.at(-1)?.at ?? visit.originAt, cursor, endsAt: visit.endsAt };
  view.hostId = [...room.players.values()].find((item) => item.isHost)?.id ?? ""; view.playerCount = room.players.size;
  return view;
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

// ---------------------------------------------------------------------------
// Authoritative tick loop
// ---------------------------------------------------------------------------

function tickRoom(room: Room, now: number) {
  const dt = TICK_MS / 1000;
    if (room.timeVisit && (now >= room.timeVisit.endsAt || room.phase !== "playing")) {
      const visitor = room.players.get(room.timeVisit.playerId);
      if (visitor) endTimeVisit(room, visitor, now >= room.timeVisit.endsAt ? "time expired" : "night changed");
      else room.timeVisit = null;
    }
    if (!room.replaying && now - room.createdAt > 6 * 3600_000 && room.players.size === 0) { rooms.delete(room.code); return; }
    if (room.phase === "lobby") {
      // prune souls who have been gone 75s so seats (and the lantern) never rot
      for (const p of [...room.players.values()]) {
        if (p.parked) continue; // a restored seat waits for its player
        if (now - p.lastSeen > 75000) leaveRoom(room.code, p.id);
      }
      // invariant: while anyone is in the lobby, SOMEONE holds the lantern
      const host = [...room.players.values()].find((p) => p.isHost);
      if (!host && room.players.size > 0) {
        const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
        next.isHost = true;
        feed(room, `${next.name} now holds the town lantern (host).`);
      }
      // hand the lantern to someone present if the host went stale
      if (host && now - host.lastSeen > 12000) {
        const fresh = [...room.players.values()]
          .filter((p) => p.id !== host.id && now - p.lastSeen < 8000)
          .sort((a, b) => b.joinedAt - a.joinedAt)[0];
        if (fresh) {
          host.isHost = false;
          fresh.isHost = true;
          feed(room, `${fresh.name} now holds the town lantern (host).`);
        }
      }
      return;
    }
    if (room.phase === "ended") return;

    // The cart follows the majority direction among nearby players actively
    // holding Push + a direction. Ties stop it; hands full of kits cannot push.
    const pushers = room.phase === "playing"
      ? [...room.players.values()].filter((p) => !p.temporalAbsent && p.id !== room.timeVisit?.playerId && p.alive && !p.caged && !p.inside && !p.hasSupply &&
          p.cartHeld && p.dir !== 0 && now - p.lastSeen < 15000 && dist(p.x, room.cartX) <= CART_PUSH_RANGE)
      : [];
    const right = pushers.filter((p) => p.dir > 0);
    const left = pushers.filter((p) => p.dir < 0);
    const team = right.length > left.length ? right : left.length > right.length ? left : [];
    const pushingIds = new Set(team.map((p) => p.id));
    const cartSpeed = Math.min(CART_MAX_SPEED, CART_SOLO_SPEED + Math.max(0, team.length - 1) * CART_HELPER_BONUS);
    room.cartPushers = team.length;

    for (const p of room.players.values()) {
      if (p.temporalAbsent) continue;
      if (room.replaying && p.temporalVisitor === true) p.lastSeen = now;
      if (room.timeVisit?.playerId === p.id) {
        if (now - p.lastSeen > 15000) { endTimeVisit(room, p, "connection lost"); }
        else {
          const visit = room.timeVisit, shadow = pastRoom(room, visit, now);
          const traveler = shadow?.players.get(visit.visitorId);
          if (traveler) {
            p.x = traveler.x; p.inside = traveler.inside; p.facing = traveler.facing; p.dir = traveler.dir; p.moving = traveler.moving;
            p.stamina = traveler.stamina; p.exhausted = traveler.exhausted; p.hasKey = traveler.hasKey; p.hasSupply = traveler.hasSupply; p.supplyId = traveler.supplyId; p.activeWard = traveler.activeWard;
            continue;
          }
          endTimeVisit(room, p, "history unavailable");
        }
      }
      if (now - p.lastSeen > 15000) { p.dir = 0; p.cartHeld = false; dropTimepiece(room, p); dropKey(room, p); dropSupply(room, p); dropBuildingKeys(room.doors, p.id, p.x, p.inside); } // stale connection releases movement and unique items
      const speed = !p.alive ? GHOST_SPEED : p.hasSupply ? CARRY_SPEED : pushingIds.has(p.id) ? cartSpeed : SPEED;
      p.moving = p.dir !== 0;
      if (p.dir !== 0) p.facing = p.dir;
      const wasX = p.x;
      const nextX = p.x + p.dir * speed * dt;
      if (p.caged && p.cageIndex >= 0) {
        const cx = room.cages[p.cageIndex].x;
        p.x = Math.max(cx - CELL_HALF + 8, Math.min(cx + CELL_HALF - 8, nextX));
      } else if (!p.alive) {
        p.x = clampWorld(nextX);
      } else {
        const step = walkThroughBuildings(p.x, nextX, p.inside, room.doors);
        p.x = step.x;
        p.inside = step.inside;
      }
      p.moving = Math.abs(p.x - wasX) > 0.01;
      if (p.alive && !p.caged && p.dir !== 0 && (p.hasSupply || pushingIds.has(p.id))) {
        p.stamina = Math.max(0, p.stamina - CARRY_VIGOR_DRAIN * dt * (pushingIds.has(p.id) ? 1.2 : 1));
        if (p.stamina <= 0) p.exhausted = true;
      }
      if (p.alive) p.match.distance += Math.abs(p.x - wasX);
      // Repair sessions are driven by validated tile moves, never by a held key.
      if (p.activeWard) {
        const task = room.pool.find((t) => t.id === p.activeWard);
        const station = task && STATIONS.find((s) => s.id === task.id);
        if (room.phase !== "playing" || !p.alive || p.caged || p.dir !== 0 ||
            !task?.delivered || task.done || !station || !stationNear(p, station.id, INTERACT_RANGE + 35)) {
          p.activeWard = null;
        }
      }
      if (p.dir === 0) {
        p.stamina = Math.min(1, p.stamina + STAMINA_IDLE_REGEN * dt * (p.activeWard ? 0.5 : 1));
        if (p.exhausted && p.stamina >= 0.2) p.exhausted = false;
      }
    }

    if (team.length) {
      room.cartX = clampWorld(room.cartX + team[0].dir * ix(cartSpeed * dt), 90);
    }

    if (room.phase === "meeting" && room.meeting && now >= room.meeting.endsAt) resolveMeeting(room);

    if (room.phase === "playing" && now >= room.nextFlicker) {
      room.flickerAt = now;
      room.nextFlicker = now + 20000 + seeded(room, "flicker-delay") % 25000;
      const lines = [
        "The lanterns flicker. Something passed between them.",
        "Crows lift from the church roof all at once.",
        "A cold wind carries a whisper no one spoke.",
        "Every window in town goes dark for a heartbeat.",
      ];
      feed(room, lines[seeded(room, "flicker-line") % lines.length]);
    }
    if (!room.replaying && room.timeVisit && now - room.timeVisit.lastReconcileAt >= 500) {
      const visit = room.timeVisit, visitor = room.players.get(visit.playerId);
      reconcileFuture(room, visit, now);
      if (visitor && (!visitor.alive || visitor.caged || room.phase !== "playing")) endTimeVisit(room, visitor, "timeline changed");
    }
    captureHistory(room, now);
}

function tickRooms() {
  for (const room of rooms.values()) {
    const now = roomNow(room);
    if (room.phase === "playing" || room.phase === "meeting") journal(room, "tick", now);
    tickRoom(room, now);
    room.rev++;
    emitRoom(room.code);
  }
}

let tickAcc = 0;
let lastTickWall = Date.now();
function tick() {
  const wall = Date.now();
  tickAcc += wall - lastTickWall;
  lastTickWall = wall;
  if (tickAcc > TICK_MS * 10) tickAcc = TICK_MS * 10; // a sleeping tab must not burst 10 ticks at once
  while (tickAcc >= TICK_MS) {
    tickAcc -= TICK_MS;
    tickRooms();
  }
}

/** Deterministic test harness: advances one room by a recorded server tick. */
export function advanceRoomForTest(room: Room, now: number) {
  if (room.phase === "playing" || room.phase === "meeting") journal(room, "tick", now);
  tickRoom(room, now);
}

if (!g.__hollowLoop) {
  g.__hollowLoop = setInterval(tick, TICK_MS);
}

// ---------------------------------------------------------------------------
// Snapshot (per-viewer, roles hidden)
// ---------------------------------------------------------------------------

/** ETag for a viewer's snapshot, cached per room revision so 10 pollers share one hash per tick. */
export function roomEtag(room: Room, playerId: string, snap: Snapshot): string {
  const cached = room.etags.get(playerId);
  if (cached && cached.rev === room.rev) return cached.etag;
  const etag = snapshotEtag(snap);
  if (room.etags.size > 32) room.etags.clear();
  room.etags.set(playerId, { rev: room.rev, etag });
  return etag;
}

export function snapshot(room: Room, playerId: string): Snapshot | null {
  const me = room.players.get(playerId);
  if (!me) return null;
  if (me.parked) {
    me.parked = false; // its player just asked for a snapshot
    markDirty(room);
  }
  const now = roomNow(room);
  me.lastSeen = now; // the 100ms state poll IS the presence heartbeat
  if (!room.replaying && !room.temporalShadow && room.phase !== "lobby" && room.phase !== "ended" && now - (me.lastPresenceAt ?? 0) > 30_000) {
    me.lastPresenceAt = now;
    journal(room, "presence", now, me.id);
  }
  if (!room.temporalShadow && room.timeVisit?.playerId === me.id) {
    if (now >= room.timeVisit.endsAt) endTimeVisit(room, me, "time expired");
    else return pastSnapshot(room, me, room.timeVisit, now);
  }
  const ps = [...room.players.values()];
  const killCd = Math.max(0, me.killAt - now);
  const target = me.role === "hollow" ? killTarget(room, me) : null;
  const ruinTarget = room.pool.find((t) => !t.sabotaged && (t.done || t.delivered) && stationNear(me, t.id));
  const canSabotage = me.role === "hollow" && me.alive && !me.caged &&
    room.phase === "playing" && now >= me.sabotageAt && !!ruinTarget;

  let hint: string | null = null;
  if (me.alive && room.phase !== "lobby") {
    const b = room.phase === "playing" && !me.caged ? nearestBody(room, me) : null;
    const cageIdx = me.hasKey ? nearestOccupiedCage(room, me.x) : -1;
    const ward = room.pool.find((t) => !t.done && stationNear(me, t.id));
    const dropped = !me.inside && room.supplyDrops.some((item) => dist(item.x, me.x) < INTERACT_RANGE);
    const atCart = !me.inside && dist(room.cartX, me.x) < INTERACT_RANGE;
    const nearCart = !me.inside && dist(room.cartX, me.x) <= CART_PUSH_RANGE;
    if (room.phase === "playing" && me.caged && ps.filter((p) => p.alive).every((p) => p.caged))
      hint = "E — call a vote to free someone";
    else if (cageIdx >= 0) hint = `E — unlock ${room.players.get(room.cages[cageIdx].occupant!)?.name}'s cage`;
    else if (b) hint = `Report ${b.name}'s body`;
    else if (room.phase === "playing" && !me.caged && ward && !ward.delivered && me.hasSupply)
      hint = "E — deliver kit and open repair";
    else if (room.keyX !== null && !me.caged && dist(room.keyX, me.x) < INTERACT_RANGE) hint = "Take the iron key";
    else if (room.phase === "playing" && !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE) hint = "Ring the bell";
    else if (room.phase === "playing" && !me.caged) {
      if (canSabotage) hint = "R — ruin this ward";
      else if (!me.hasSupply && dropped) hint = "E — recover fallen repair kit";
      else if (!me.hasSupply && atCart) hint = "E — take kit · hold Shift + A/D to push";
      else if (ward && !ward.delivered) hint = "Needs kit — find a supply cart";
      else if (ward && ward.delivered) {
        hint = !canRepair(room, me) ? "E — pretend to repair" : me.exhausted
          ? "Spent — stand still and catch your breath" : "E — open the repair puzzle";
      } else if (me.hasSupply && nearCart) hint = "Hands full — G to drop kit, then push";
      else if (me.hasSupply) hint = "Hauling kit (slower) — G to drop";
      else if (nearCart) hint = "Hold Shift + A/D to push the cart";
      else if (room.pool.some((t) => !t.done && !t.delivered)) {
        hint = `Supply cart ${room.cartX < me.x ? "←" : "→"} ${Math.round(dist(room.cartX, me.x))} steps`;
      }
    }
  }

  if (me.alive && !me.caged && room.phase !== "lobby") hint = buildingHint(room.doors, me.id, me.x, me.inside) ?? hint;
  if (me.alive && !me.caged && !me.inside && room.phase === "playing" && nearTimepiece(room, me)) hint = "E — take the timepiece";
  else if (me.alive && heldPiece(room, me.id) && !hint) hint = room.temporalShadow ? "M — travel deeper into the past" : "M — choose a moment in the past";

  const abilityLabel = me.role === "hollow" ? "Kill" : "Ring Bell";
  const abilityReady = me.alive && room.phase === "playing" && (
    me.role === "hollow" ? killCd <= 0 && !!target : !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE + 20
  );

  const doneTasks = room.pool.filter((t) => t.done).length;
  const activeTask = room.phase === "playing" && me.alive && !me.caged && canRepair(room, me)
    ? room.pool.find((t) => t.id === me.activeWard && t.delivered && !t.done)
    : undefined;
  const activeStation = activeTask && STATIONS.find((s) => s.id === activeTask.id);
  const minigame = activeTask?.puzzle && activeStation
    ? wardView(activeTask.id, activeStation.name, activeTask.puzzle, Math.max(0, activeTask.previewUntil - now)) : null;
  const results = room.phase === "ended" ? {
    durationSec: Math.max(0, Math.round((room.endedAt - room.startedAt) / 1000)),
    players: ps.slice().sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role,
      alive: p.alive, caged: p.caged,
      stats: { ...p.match, distance: Math.round(p.match.distance) },
    })),
  } : null;

  // ---- server-side vision: a hacked client cannot wallhack ----
  const blackout = now < room.blackoutUntil;
  const ghostView = !me.alive;
  let vision = ghostView ? 99999
    : room.phase === "meeting" ? 900
    : me.role === "hollow" ? VISION_HOLLOW
    : blackout ? VISION_BLACKOUT
    : VISION_CREW;
  if (room.phase === "lobby" || room.phase === "ended") vision = 99999;
  const canSee = (x: number) => ghostView || dist(x, me.x) <= vision;

  // proximity dread for the living crew — drives heartbeat / tension audio
  let danger = 0;
  if (me.alive && me.role === "crew" && room.phase === "playing") {
    let nearest = Infinity;
    for (const p of ps) if (p.id !== room.timeVisit?.playerId && p.role === "hollow" && p.alive && !p.caged && p.inside === me.inside) nearest = Math.min(nearest, dist(p.x, me.x));
    danger = Math.max(0, Math.min(1, 1 - nearest / 340));
    if (blackout) danger = Math.max(danger, 0.35);
  }

  const nightT = room.phase === "lobby" ? 0.15
    : room.phase === "ended" ? 1
    : room.replaying || !room.startedAt ? 0.5
    : Math.min(1, Math.max(0, (now - room.startedAt) / NIGHT_LENGTH_MS));

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    now,
    nightT,
    self: {
      id: me.id,
      role: me.role,
      alive: me.alive,
      caged: me.caged,
      hasKey: me.hasKey,
      hasSupply: me.hasSupply,
      doorKeys: room.doors.filter((d) => d.holder === me.id).map((d) => d.id),
      hasTimepiece: !!heldPiece(room, me.id),
      bellUsed: me.bellUsed,
      killCooldownMs: killCd,
      canKill: !!target && killCd <= 0,
      stamina: Math.round(me.stamina * 100) / 100,
      exhausted: me.exhausted,
      blackoutCooldownMs: Math.max(0, room.blackoutReadyAt - now),
      canBlackout: me.role === "hollow" && me.alive && room.phase === "playing" && now >= room.blackoutReadyAt,
      sabotageCooldownMs: Math.max(0, me.sabotageAt - now),
      canSabotage,
      teammates: me.role === "hollow" ? ps.filter((p) => p.role === "hollow" && p.id !== me.id).map((p) => p.id) : [],
      myVote: me.vote,
    },
    players: ps
      .filter((p) => p.id === me.id || (!p.temporalAbsent && p.id !== room.timeVisit?.playerId && (canSee(p.x) || room.phase === "meeting" || room.phase === "lobby" || room.phase === "ended")))
      .map((p) => {
        const seen = p.id === me.id || canSee(p.x);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          x: seen ? ix(p.x) : -9999, // positions are integers; meeting roster hides them
          facing: p.facing,
          moving: seen && p.moving && p.dir !== 0,
          alive: p.alive,
          caged: p.caged,
          hasKey: seen && p.hasKey,
          hasSupply: seen && p.hasSupply,
          inside: seen ? p.inside : null,
          echo: room.temporalShadow && p.id.startsWith("echo:"),
          hasTimepiece: seen && !!heldPiece(room, p.id),
          doorKeys: seen ? room.doors.filter((door) => door.holder === p.id).map((door) => door.id) : [],
          action: seen && p.actionUntil > now ? { text: p.actionText, until: p.actionUntil } : null,
          voted: p.vote !== null,
          isHost: p.isHost,
          bubble:
            seen && p.bubbleUntil > now && (me.alive ? p.alive : true)
              ? { text: p.bubbleText, until: p.bubbleUntil }
              : null,
        };
      }),
    bodies: room.bodies.filter((b) => canSee(b.x)).map((b) => ({ x: b.x, color: b.color, name: b.name, id: b.id, at: b.at, inside: b.inside })),
    doors: room.doors.map((d) => {
      const b = BUILDINGS.find((item) => item.id === d.id)!;
      const visible = canSee(doorX(b));
      const owner = d.holder ? room.players.get(d.holder) : null;
      return { id: d.id, locked: visible ? d.locked : true, open: visible && d.open,
        keyX: d.keyX !== null && canSee(d.keyX) ? d.keyX : null,
        holder: d.holder === me.id || (owner && canSee(owner.x)) ? d.holder : null };
    }),
    keyX: room.keyX !== null && canSee(room.keyX) ? room.keyX : null,
    notes: room.notes.filter((n) => (n.house ? me.inside === n.house : !me.inside && canSee(n.x))).map((n) => ({ id: n.id, x: n.x, kind: n.kind, house: n.house, author: n.authorName, text: n.text })),
    timepieces: loosePieces(room).filter((tp) => canSee(tp.x)).map((tp) => tp.x),
    timepieceX: (() => { const tp = loosePieces(room).find((t2) => canSee(t2.x)); return tp ? tp.x : null; })(),
    time: room.temporalShadow ? undefined : { mode: "present", earliest: room.history[0]?.at ?? room.startedAt, latest: room.history.at(-1)?.at ?? room.startedAt },
    supplyDrops: room.supplyDrops.filter((item) => canSee(item.x)).map((item) => item.x),
    cartX: ix(room.cartX),
    cartPushers: room.cartPushers,
    cages: room.cages.map((c) => ({ x: c.x, occupant: c.occupant })),
    tasks: room.pool.map((t) => {
      const st = STATIONS.find((s) => s.id === t.id)!;
      return { id: t.id, name: st.name, x: st.x, inside: st.inside, done: t.done, delivered: t.delivered, sabotaged: t.sabotaged, progress: t.progress };
    }),
    minigame,
    taskBar: { done: doneTasks, total: room.pool.length },
    meeting: room.meeting
      ? { endsAt: room.meeting.endsAt, reason: room.meeting.reason, inArea: inMeetingArea(me) }
      : null,
    feed: room.feed.slice(-8),
    winner: room.winner,
    winReason: room.winReason,
    results,
    bellAt: room.bellAt,
    flickerAt: room.flickerAt,
    blackoutUntil: room.blackoutUntil,
    danger: Math.round(danger * 100) / 100,
    visionRadius: Math.min(vision, 9999),
    hint,
    abilityLabel,
    abilityReady,
    hostId: ps.find((p) => p.isHost)?.id ?? "",
    playerCount: ps.length,
  };
}