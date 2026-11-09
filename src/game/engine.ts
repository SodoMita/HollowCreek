import { type DoorState } from "./buildings";
import { bindEngineHooks } from "./hooks";
import { tickRoom } from "./tick";
import { snapshot } from "./snapshot";
export { roomEtag, snapshot } from "./snapshot";
export { endTimeVisit, handlePastInput, pastRoom, pastSnapshot, reconcileFuture, simulatePastForTest, spawnNextTimepiece, startTimeVisit } from "./time-travel";
export { TICK_MS } from "./types";
export { advanceRoomForTest, tick, tickRoom, tickRooms } from "./tick";
export { createRoom, handleInput, joinRoom, leaveRoom, listRooms, restartGame, startGame } from "./actions";

export { loadRoom } from "./persistence";
export { getRoom, listRoomsSync } from "./registry";
export { onRoomEvent } from "./chronicle";
import { type WardPuzzle } from "./wards";
import type { FeedItem, InputBody, MatchStats, Note, Phase, Role } from "./types";

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
  supplyDrops: SupplyDrop[]; cartX: number; cartSubX?: number; cartPushers: number;
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
  subX?: number;
  steerSeq?: number;
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
  cartSubX?: number;
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

// ---------------------------------------------------------------------------
// Chronicle — every player action is persisted

bindEngineHooks({ snapshot, tickRoom });

// Full barrel: the modules split out of this file stay reachable from
// "@/game/engine" for routes, tests and the static client.
export * from "./timepieces";
export * from "./proximity";
export * from "./history";
export * from "./input";
export * from "./chronicle";
export * from "./time-travel";
export * from "./rules";
export * from "./actions";
export * from "./tick";
export * from "./persistence";
export * from "./registry";
export * from "./snapshot";
export * from "./hooks";
