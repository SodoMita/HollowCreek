// Shared types & world constants for HOLLOW CREEK — a 1D autumn horror deduction game.

export const WORLD_W = 4200;
export const SPEED = 190; // px per second
export const GHOST_SPEED = 260;
export const TICK_MS = 50;
export const KILL_RANGE = 75;
export const KILL_COOLDOWN_MS = 18000;
export const INTERACT_RANGE = 80;
export const TASK_HOLD_MS = 3200;
export const MEETING_MS = 45000;
export const CELL_HALF = 30;
export const CAGE_UNLOCK_RANGE = 125;
export const MEETING_FROM = 1880;
export const MEETING_TO = 2520;
export const BELL_X = 2200;
export const BUBBLE_MS = 6000;
export const TASKS_PER_CREW = 4;
export const VISION_CREW = 420;
export const VISION_HOLLOW = 620;
export const VISION_BLACKOUT = 190;
export const BLACKOUT_MS = 9000;
export const BLACKOUT_CD_MS = 30000;
// Vigor (stamina): work and deeds drain it; idling restores it.
export const STAMINA_WORK_DRAIN = 0.10; // per second while working a ward
export const STAMINA_IDLE_REGEN = 0.09; // per second while idle
export const STAMINA_SLOW_THRESHOLD = 0.3; // below this, work slows linearly
export const STAMINA_KILL_COST = 0.35;
export const STAMINA_BLACKOUT_COST = 0.3;
export const STAMINA_BELL_COST = 0.15;
export const STAMINA_UNLOCK_COST = 0.1;

// One cart, pushed together; sizes and speeds are world units per second.
export const SUPPLY_CART_START = 900;
export const CART_PUSH_RANGE = 105;
export const CART_SOLO_SPEED = 38;
export const CART_HELPER_BONUS = 26;
export const CART_MAX_SPEED = 116;
export const CARRY_SPEED = 122;
export const CARRY_VIGOR_DRAIN = 0.045;
export const SABOTAGE_COOLDOWN_MS = 26000;
export const SABOTAGE_VIGOR_COST = 0.22;

export interface Station {
  id: string;
  name: string;
  x: number;
  kind:
    | "pumpkins"
    | "well"
    | "scarecrow"
    | "lantern"
    | "chapel"
    | "mill"
    | "graves"
    | "radio"
    | "silo";
}

export const STATIONS: Station[] = [
  { id: "pumpkins", name: "Repair the harvest shed", x: 280, kind: "pumpkins" },
  { id: "well", name: "Rebuild the well winch", x: 680, kind: "well" },
  { id: "scarecrow", name: "Restitch the scarecrow", x: 1060, kind: "scarecrow" },
  { id: "lantern", name: "Rewire the street lantern", x: 1450, kind: "lantern" },
  { id: "chapel", name: "Mend the chapel windows", x: 1720, kind: "chapel" },
  { id: "mill", name: "Replace the sawmill blades", x: 2760, kind: "mill" },
  { id: "graves", name: "Rebuild the grave markers", x: 3200, kind: "graves" },
  { id: "radio", name: "Repair the radio tower", x: 3650, kind: "radio" },
  { id: "silo", name: "Patch the grain silo", x: 4000, kind: "silo" },
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
  done: boolean;
  delivered: boolean; // a kit has arrived from the cart
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

export interface Snapshot {
  code: string;
  phase: Phase;
  round: number;
  now: number;
  self: SelfInfo;
  players: PublicPlayer[];
  bodies: { x: number; color: string; name: string }[];
  keyX: number | null;
  /** Dropped kits can be recovered after a death, cage or voluntary drop. */
  supplyDrops: number[];
  cartX: number;
  cartPushers: number;
  cages: { x: number; occupant: string | null }[];
  tasks: TaskView[];
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
  action?: "interact" | "ability" | "blackout" | "vote" | "start" | "restart" | "leave" | "drop_supply" | "sabotage";
  chat?: string;
  vote?: string; // playerId | "skip" | "free:<id>"
}