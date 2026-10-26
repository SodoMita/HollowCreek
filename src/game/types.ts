// Shared types & world constants for HOLLOW CREEK — a 1D autumn horror deduction game.
import type { WardGameView } from "./wards";

export const WORLD_W = 6400;
export const SPEED = 190; // px per second
export const GHOST_SPEED = 260;
export const TICK_MS = 50;
export const KILL_RANGE = 75;
export const KILL_COOLDOWN_MS = 18000;
export const INTERACT_RANGE = 80;
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
    | "silo"
    | "desk"
    | "safe";
  /** Interior-only wards can only be reached from inside that building. */
  inside?: string;
}

export interface Building {
  id: string;
  /** Name on the painted sign above the door. */
  name: string;
  /** The room behind the door — a place, not just scenery. */
  interiorName: string;
  /** Centre of the facade / the door itself. */
  x: number;
  /** Half-width of the building footprint in world units. */
  half: number;
  kind: "lodge" | "cider" | "post" | "quarry";
  doorStyle: "arch" | "plank" | "iron";
  /** Little hand-drawn interior locations, shown as props in the cutaway. */
  props: { name: string; x: number; kind: "shelf" | "table" | "stove" | "crate" | "lamp" | "barrel" }[];
}

export const STATIONS: Station[] = [
  // --- west reach: the ferry landing below the bridge ---
  { id: "ferry", name: "Refloat the ferry winch", x: 130, kind: "well" },
  // --- original street ---
  { id: "pumpkins", name: "Repair the harvest shed", x: 280, kind: "pumpkins" },
  { id: "well", name: "Rebuild the well winch", x: 680, kind: "well" },
  { id: "scarecrow", name: "Restitch the scarecrow", x: 1060, kind: "scarecrow" },
  { id: "lantern", name: "Rewire the street lantern", x: 1450, kind: "lantern" },
  { id: "chapel", name: "Restore the chapel lights", x: 1720, kind: "chapel" },
  { id: "mill", name: "Replace the sawmill blades", x: 2760, kind: "mill" },
  { id: "graves", name: "Rebuild the grave markers", x: 3200, kind: "graves" },
  { id: "radio", name: "Repair the radio tower", x: 3650, kind: "radio" },
  { id: "silo", name: "Patch the grain silo", x: 4000, kind: "silo" },
  // --- east reach: orchard, beacon and quarry beyond the creek ---
  { id: "orchard", name: "Rebind the orchard press", x: 4520, kind: "pumpkins" },
  { id: "beacon", name: "Rekindle the watch beacon", x: 5180, kind: "lantern" },
  { id: "quarry", name: "Plug the quarry pump", x: 6060, kind: "silo" },
];

/** Houses with interiors. Each door needs the iron key to be opened or locked. */
export const BUILDINGS: Building[] = [
  {
    id: "lodge", name: "Ferryman's Lodge", interiorName: "The Ferryman's Lodge",
    x: 480, half: 165, kind: "lodge", doorStyle: "arch",
    props: [
      { name: "Ledger table", x: 480, kind: "table" },
      { name: "Peat stove", x: 370, kind: "stove" },
      { name: "Rope shelf", x: 580, kind: "shelf" },
    ],
  },
  {
    id: "schoolhouse", name: "Hollow Creek School", interiorName: "The Old Schoolroom",
    x: 3420, half: 175, kind: "lodge", doorStyle: "plank",
    props: [
      { name: "Chalk desk", x: 3420, kind: "table" },
      { name: "Cold stove", x: 3320, kind: "stove" },
      { name: "Book shelf", x: 3510, kind: "shelf" },
    ],
  },
  {
    id: "cider", name: "Cider House", interiorName: "The Cider Cellar",
    x: 4850, half: 170, kind: "cider", doorStyle: "plank",
    props: [
      { name: "Press table", x: 4850, kind: "table" },
      { name: "Cider barrels", x: 4740, kind: "barrel" },
      { name: "Cellar lamp", x: 4950, kind: "lamp" },
    ],
  },
  {
    id: "post", name: "Watchtower Post", interiorName: "The Signal Office",
    x: 5650, half: 160, kind: "post", doorStyle: "arch",
    props: [
      { name: "Telegraph desk", x: 5650, kind: "table" },
      { name: "Parcel crates", x: 5540, kind: "crate" },
      { name: "Signal lamp", x: 5750, kind: "lamp" },
    ],
  },
  {
    id: "quarryoffice", name: "Quarry Office", interiorName: "The Quarry Office",
    x: 6250, half: 150, kind: "quarry", doorStyle: "iron",
    props: [
      { name: "Survey table", x: 6250, kind: "table" },
      { name: "Dynamite crate", x: 6150, kind: "crate" },
      { name: "Oil lamp", x: 6340, kind: "lamp" },
    ],
  },
];

/** Wards that only exist behind a locked door. */
export const INTERIOR_STATIONS: Station[] = [
  { id: "lodge_ledger", name: "Rekindle the lodge hearth", x: 480, kind: "lantern", inside: "lodge" },
  { id: "signal_desk", name: "Rebuild the signal relays", x: 5650, kind: "radio", inside: "post" },
];

export const ALL_STATIONS: Station[] = [...STATIONS, ...INTERIOR_STATIONS];

export const INTERIOR_HALF = 140;
export const buildingById = (id: string | null | undefined): Building | undefined =>
  id ? BUILDINGS.find((b) => b.id === id) : undefined;
export const stationById = (id: string): Station | undefined => ALL_STATIONS.find((s) => s.id === id);
/** Every station a player can currently reach: street wards, or wards in their own room. */
export const stationReachable = (station: Station, inside: string | null, x: number, range = INTERACT_RANGE) =>
  (station.inside ?? null) === (inside ?? null) && Math.abs(station.x - x) <= range;

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
  /** Building id while this soul is behind a door, else null. */
  inside: string | null;
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
  inside: string | null;
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
  /** Doors and interiors everyone nearby can see; walls fade when occupied. */
  buildings: {
    id: string;
    x: number;
    half: number;
    doorOpen: boolean;
    occupants: number;
    transparent: boolean;
    wardDone: boolean;
  }[];
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
  action?: "interact" | "ability" | "blackout" | "vote" | "start" | "restart" | "leave" | "drop_supply" | "sabotage" | "ward_move" | "ward_cancel" | "door" | "lock";
  building?: string;
  wardId?: string;
  move?: number;
  chat?: string;
  vote?: string; // playerId | "skip" | "free:<id>"
}