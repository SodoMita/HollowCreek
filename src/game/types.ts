// Shared types & world constants for HOLLOW CREEK — a 1D autumn horror deduction game.
import type { WardGameView, WardKind } from "./wards";
import type { DoorState } from "./buildings";

export const WORLD_W = 4200;

// Balance knobs live in ./balance (grouped & commented); re-exported here for compatibility.
export {
  SPEED,
  GHOST_SPEED,
  TICK_MS,
  KILL_RANGE,
  KILL_COOLDOWN_MS,
  INTERACT_RANGE,
  NOTE_REACH,
  NOTE_TEXT_MAX,
  MEETING_MS,
  NIGHT_LENGTH_MS,
  CELL_HALF,
  CAGE_UNLOCK_RANGE,
  MEETING_FROM,
  MEETING_TO,
  BELL_X,
  BUBBLE_MS,
  TASKS_PER_CREW,
  VISION_CREW,
  VISION_HOLLOW,
  VISION_BLACKOUT,
  BLACKOUT_MS,
  BLACKOUT_CD_MS,
  STAMINA_WORK_DRAIN,
  STAMINA_IDLE_REGEN,
  STAMINA_SLOW_THRESHOLD,
  STAMINA_KILL_COST,
  STAMINA_BLACKOUT_COST,
  STAMINA_BELL_COST,
  STAMINA_UNLOCK_COST,
  SUPPLY_CART_START,
  CART_PUSH_RANGE,
  CART_SOLO_SPEED,
  CART_HELPER_BONUS,
  CART_MAX_SPEED,
  CARRY_SPEED,
  CARRY_VIGOR_DRAIN,
  SABOTAGE_COOLDOWN_MS,
  SABOTAGE_VIGOR_COST,
  TIMEPIECE_X,
  TIME_VISIT_MS,
  HISTORY_SAMPLE_MS,
} from "./balance";
// Game state uses NO floats for positions: every world coordinate (player x,
// cart, drops, keys, bodies, doors, cages) is an integer, so replays and
// snapshots compare exactly. Rendering may still interpolate on the client.
export const ix = (v: number) => Math.round(v);
/** A handwritten page pinned to a building wall or a tree trunk. */
export interface Note {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Snapped world x of the wall face / trunk. Always an integer. */
  x: number;
  kind: "wall" | "tree";
  /** Building id when pinned on an interior wall, else null. */
  house: string | null;
  at: number;
}
export interface Station {
  id: string;
  name: string;
  x: number;
  kind: WardKind;
  /** Indoor work requires being in this specific house, not just at its x. */
  inside?: string;
  /** Small indoor jobs have their own supplies and need no cart delivery. */
  initialSupplied?: boolean;
}

export const STATIONS: Station[] = [
  { id: "pumpkins", name: "Repair the harvest shed", x: 280, kind: "pumpkins" },
  { id: "well", name: "Rebuild the well winch", x: 680, kind: "well" },
  { id: "scarecrow", name: "Restitch the scarecrow", x: 1060, kind: "scarecrow" },
  { id: "lantern", name: "Rewire the street lantern", x: 1450, kind: "lantern" },
  { id: "chapel", name: "Restore the chapel lights", x: 1720, kind: "chapel" },
  { id: "mill", name: "Replace the sawmill blades", x: 2760, kind: "mill" },
  { id: "graves", name: "Rebuild the grave markers", x: 3200, kind: "graves" },
  { id: "radio", name: "Repair the radio tower", x: 3650, kind: "radio" },
  { id: "silo", name: "Patch the grain silo", x: 4000, kind: "silo" },
  { id: "ferry-beacon", name: "Relight the ferry beacon", x: -3420, kind: "lantern", initialSupplied: true },
  { id: "ridge-cairn", name: "Rebuild the ridge cairn", x: 7300, kind: "graves", initialSupplied: true },
  { id: "ferryman-hearth", name: "Ferryman's Hut · relight the hearth", x: -3140, kind: "hearth", inside: "ferryman", initialSupplied: true },
  { id: "lodge-clock", name: "Watchman's Lodge · wind the watch-clock", x: 8005, kind: "clock", inside: "lodge", initialSupplied: true },
  { id: "tollhouse-hearth", name: "Tollhouse · relight the hearth", x: -490, kind: "hearth", inside: "tollhouse", initialSupplied: true },
  { id: "orchard-pantry", name: "Orchard House · arrange preserves", x: -1120, kind: "pantry", inside: "orchard", initialSupplied: true },
  { id: "office-clock", name: "Foreman's Office · set the clock", x: 4725, kind: "clock", inside: "foreman", initialSupplied: true },
  { id: "cottage-fuses", name: "Quarry Cottage · repair the fuses", x: 5375, kind: "fusebox", inside: "quarry", initialSupplied: true },
];

export const CAGE_XS = [1940, 2030, 2120, 2280, 2370, 2460];

export const PLAYER_COLORS = [
  "#c0392b", "#d35400", "#e0a52a", "#6b8e23", "#2e8b57",
  "#3a7ca5", "#5b4b8a", "#8e44ad", "#b0567a", "#7f8c8d",
];

export type Role = "crew" | "hollow";
export type Phase = "lobby" | "playing" | "meeting" | "ended";

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  facing: number;
  moving: boolean;
  alive: boolean;
  caged: boolean;
  hasKey: boolean;
  hasSupply: boolean;
  /** House layer, if any; x remains a world coordinate. */
  inside?: string | null;
  echo?: boolean;
  hasTimepiece?: boolean;
  doorKeys?: string[];
  action?: { text: string; until: number } | null;
  voted: boolean;
  bubble: { text: string; until: number } | null;
  isHost: boolean;
}

export interface SelfInfo {
  id: string;
  role: Role;
  alive: boolean;
  caged: boolean;
  hasKey: boolean;
  hasSupply: boolean;
  doorKeys?: string[];
  hasTimepiece?: boolean;
  bellUsed: boolean;
  killCooldownMs: number;
  canKill: boolean;
  stamina: number; // 0..1
  exhausted: boolean; // hit 0 — must rest to 20% before working again
  blackoutCooldownMs: number;
  canBlackout: boolean;
  sabotageCooldownMs: number;
  canSabotage: boolean;
  teammates: string[]; // other hollow ids (only for hollow)
  myVote: string | null;
}

export interface TaskView {
  id: string;
  name: string;
  x: number;
  inside?: string;
  done: boolean;
  delivered: boolean; // a kit has arrived or supplies are already on site
  sabotaged: boolean; // the Hollow has ruined this ward once this night
  progress: number; // 0..1, repair work after delivery
}

export interface FeedItem {
  text: string;
  at: number;
}

/** One player's deeds during this night, not their lifetime record. */
export interface MatchStats {
  repairs: number;
  kitsDelivered: number;
  kills: number;
  deaths: number;
  timesCaged: number;
  cagesOpened: number;
  votes: number;
  reports: number;
  ruins: number;
  bells: number;
  blackouts: number;
  distance: number; // world units walked while alive
}

export interface MatchResult {
  id: string;
  name: string;
  color: string;
  role: Role;
  alive: boolean;
  caged: boolean;
  stats: MatchStats;
}

export interface MatchResults {
  durationSec: number;
  players: MatchResult[];
}

export interface TimeView {
  mode: "present" | "past";
  earliest: number;
  latest: number;
  cursor?: number;
  endsAt?: number;
}

export interface Snapshot {
  code: string;
  phase: Phase;
  round: number;
  now: number;
  self: SelfInfo;
  players: PublicPlayer[];
  bodies: { x: number; color: string; name: string; id?: string; at?: number; inside?: string | null }[];
  doors?: DoorState[];
  keyX: number | null;
  timepieceX?: number | null;
  /** All loose, visible timepieces on the road (x positions). */
  timepieces?: number[];
  time?: TimeView;
  /** Dropped kits can be recovered after a death, cage or voluntary drop. */
  supplyDrops: number[];
  /** Pages pinned to walls/trees that are inside the viewer's vision. */
  notes?: { id: string; x: number; kind: "wall" | "tree"; house: string | null; author: string; text: string }[];
  cartX: number;
  cartPushers: number;
  cages: { x: number; occupant: string | null }[];
  tasks: TaskView[];
  /** Only the viewer working beside a supplied ward receives its board. */
  minigame: WardGameView | null;
  taskBar: { done: number; total: number };
  meeting: {
    endsAt: number;
    reason: string;
    inArea: boolean;
  } | null;
  feed: FeedItem[];
  winner: Role | null;
  winReason: string | null;
  /** Roles and per-match stats are absent until the game is over. */
  results: MatchResults | null;
  bellAt: number;
  flickerAt: number;
  blackoutUntil: number;
  /** 0..1 proximity dread — nearest living Hollow to you (crew only). Drives audio tension. */
  danger: number;
  visionRadius: number;
  hint: string | null;
  abilityLabel: string;
  abilityReady: boolean;
  hostId: string;
  playerCount: number;
  /** 0..1 — dusk to deep night over the round; drives the sky/stars/lanterns. */
  nightT: number;
}

export interface RoomListing {
  code: string;
  phase: Phase;
  playerCount: number;
  hostName: string;
  names: string[];
  createdAt: number;
  round: number;
}

export interface InputBody {
  playerId: string;
  dir?: number;
  interactHeld?: boolean;
  cartHeld?: boolean; // hold Push + a direction while beside the cart
  action?: "interact" | "ability" | "blackout" | "vote" | "start" | "restart" | "leave" | "drop_supply" | "sabotage" | "ward_move" | "ward_cancel" | "door_lock" | "time_travel" | "time_return" | "pin_note";
  noteText?: string; // custom page text for pin_note
  wardId?: string;
  targetAt?: number;
  move?: number;
  chat?: string;
  vote?: string; // playerId | "skip" | "free:<id>"
}