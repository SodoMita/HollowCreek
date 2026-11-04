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
import { roomEtag, snapshot } from "./snapshot";
export { roomEtag, snapshot } from "./snapshot";
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

bindEngineHooks({ snapshot, tickRoom });
