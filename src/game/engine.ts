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
import { bumpStats, newMatchStats } from "./stats";
import { shuffle } from "./rng";
import { canonicalInput } from "./input";
import { captureHistory, frameAt, restoreFrame } from "./history";
import { dirtyRooms, emitRoom, feed, gPersist, journal, kitId, markDirty, record, roomNow, seeded } from "./chronicle";
import { getRoom, listRoomsSync, makeCode, roomLoads, rooms } from "./registry";
import { flushRooms, loadRoom, pruneChronicle } from "./persistence";
import { beginMeeting, beginRepair, cagePlayer, canRepair, checkWin, doKill, dropKey, dropSupply, dropTimepiece, freePlayer, resolveMeeting, tryDeliverSupply } from "./rules";
import { bindEngineHooks } from "./hooks";
import { createRoom, handleInput, joinRoom, leaveRoom, listRooms, restartGame, startGame } from "./actions";
export { createRoom, handleInput, joinRoom, leaveRoom, listRooms, restartGame, startGame } from "./actions";

const dist = (a: number, b: number) => Math.abs(a - b);
export { loadRoom } from "./persistence";
export { getRoom, listRoomsSync } from "./registry";
export { onRoomEvent } from "./chronicle";
import { heldPiece, loosePieces, nearTimepiece, nearestTimepiece, usedPieces } from "./timepieces";
import { inMeetingArea, killTarget, nearestBody, nearestOccupiedCage, stationNear } from "./proximity";
import { snapshotEtag } from "./fingerprint";
import { applyWardMove, createWardPuzzle, validWardMove, wardProgress, wardSolved, wardView, type WardPuzzle } from "./wards";
import type { FeedItem, InputBody, MatchStats, Note, Phase, Role, RoomListing, Snapshot } from "./types";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

export interface TaskState { id: string; done: boolean; delivered: boolean; sabotaged: boolean; progress: number; puzzle: WardPuzzle | null; previewUntil: number; supplyId?: string | null }
interface SupplyDrop { id: string; x: number }
interface HistoryEvent { at: number; actorId: string; name: string; x: number; inside: string | null; type: string; data: Record<string, unknown> }
export type JournalEntry = { seq: number; at: number; kind: "input" | "tick" | "presence" | "leave" | "depart" | "return" | "respawn"; seed: number; playerId?: string; visitorId?: string; cursor?: number; lastSeen?: number; pieceId?: string; body?: InputBody };
export interface TimepieceState { id: string; x: number; holder: string | null; consumed: boolean }
export interface HistoryFrame {
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


export interface P {
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

export interface Room {
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

// ---------------------------------------------------------------------------
// Chronicle — every player action is persisted
// ---------------------------------------------------------------------------
// The timepiece: server-owned snapshots and a single temporary past layer.
// History is sampled rather than trusting a client-provided world state.
// ---------------------------------------------------------------------------


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

bindEngineHooks({ endTimeVisit, spawnNextTimepiece, handlePastInput, startTimeVisit });
