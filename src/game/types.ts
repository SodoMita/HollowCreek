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
  { id: "pumpkins", name: "Harvest the pumpkins", x: 280, kind: "pumpkins" },
  { id: "well", name: "Draw water from the old well", x: 680, kind: "well" },
  { id: "scarecrow", name: "Mend the scarecrow", x: 1060, kind: "scarecrow" },
  { id: "lantern", name: "Relight the street lantern", x: 1450, kind: "lantern" },
  { id: "chapel", name: "Light the chapel candles", x: 1720, kind: "chapel" },
  { id: "mill", name: "Oil the sawmill gears", x: 2760, kind: "mill" },
  { id: "graves", name: "Cover the open graves", x: 3200, kind: "graves" },
  { id: "radio", name: "Retune the radio tower", x: 3650, kind: "radio" },
  { id: "silo", name: "Lock the grain silo", x: 4000, kind: "silo" },
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
  bellUsed: boolean;
  killCooldownMs: number;
  canKill: boolean;
  blackoutCooldownMs: number;
  canBlackout: boolean;
  teammates: string[]; // other hollow ids (only for hollow)
  myVote: string | null;
  /** 0..100 — work and deeds spend it, standing still recovers it */
  stamina: number;
  /** true when the player is too tired for the nearest chore to progress */
  winded: boolean;
}

export interface TaskView {
  id: string;
  name: string;
  x: number;
  done: boolean;
  progress: number; // 0..1
}

export interface FeedItem {
  text: string;
  at: number;
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
  action?: "interact" | "ability" | "blackout" | "vote" | "start" | "restart" | "leave";
  chat?: string;
  vote?: string; // playerId | "skip" | "free:<id>"
}