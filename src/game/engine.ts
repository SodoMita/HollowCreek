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
import { advanceRoomForTest, tick, tickRoom, tickRooms } from "./tick";
import { endTimeVisit, handlePastInput, pastRoom, pastSnapshot, reconcileFuture, simulatePastForTest, spawnNextTimepiece, startTimeVisit } from "./time-travel";
export { endTimeVisit, handlePastInput, pastRoom, pastSnapshot, reconcileFuture, simulatePastForTest, spawnNextTimepiece, startTimeVisit } from "./time-travel";
export { advanceRoomForTest, tick, tickRoom, tickRooms } from "./tick";
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
export interface HistoryEvent { at: number; actorId: string; name: string; x: number; inside: string | null; type: string; data: Record<string, unknown> }
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
export interface ReplayAction { at: number; order: number; seed: number; body: InputBody }
export interface TimeVisit {
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

bindEngineHooks({ snapshot, tickRoom });
