// Shared types & world constants for HOLLOW CREEK — a 2D autumn horror deduction game.
// The town is a wide valley: farm in the west, chapel rise at the heart, sawmill in the
// east, cemetery and creek to the south, harrow wood to the north.

export const WORLD_W = 6400;
export const WORLD_H = 4200;
export const SPEED = 215; // px per second
export const GHOST_SPEED = 290;
export const TICK_MS = 50;
export const KILL_RANGE = 110;
export const KILL_COOLDOWN_MS = 18000;
export const INTERACT_RANGE = 120;
export const TASK_HOLD_MS = 3200;
export const MEETING_MS = 45000;
export const CELL_HALF = 34;
export const BUBBLE_MS = 6000;
export const TASKS_PER_CREW = 4;
export const VISION_CREW = 560;
export const VISION_HOLLOW = 780;
export const VISION_BLACKOUT = 250;
export const VISION_MEETING = 1100;
export const BLACKOUT_MS = 9000;
export const BLACKOUT_CD_MS = 30000;

// Vigor (stamina): work and deeds drain it; idling restores it.
export const STAMINA_WORK_DRAIN = 0.1; // per second while working a ward
export const STAMINA_IDLE_REGEN = 0.09; // per second while idle
export const STAMINA_SLOW_THRESHOLD = 0.3; // below this, work slows linearly
export const STAMINA_KILL_COST = 0.35;
export const STAMINA_BLACKOUT_COST = 0.3;
export const STAMINA_BELL_COST = 0.15;
export const STAMINA_UNLOCK_COST = 0.1;

// ---------------------------------------------------------------------------
// Modes. "nightwatch" is the one being polished now: no hidden roles at all —
// every soul in the valley is a townsfolk, and the only enemy is the night.
// "hollow" keeps the hidden-role deduction for a later pass.
// ---------------------------------------------------------------------------

export type GameMode = "nightwatch" | "hollow";
export const NIGHT_MS = 360_000; // six minutes from dusk to dawn
export const STALKER_SPEED = 112; // the thing in the fog
export const STALKER_RANGE = 62;
export const STALKER_REST_MS = 34_000;
export const STALKER_WAKE_MS = 40_000; // grace before it first stirs
export const REVIVE_MS = 2600; // standing over a fallen friend

export interface Vec {
  x: number;
  y: number;
}

/** Solid mass in the world — houses, the mill, the pond, the church. */
export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "house" | "barn" | "mill" | "chapel" | "pond" | "hedge" | "ruin";
}

export const OBSTACLES: Obstacle[] = [
  { x: 250, y: 380, w: 460, h: 320, kind: "barn" },
  { x: 980, y: 250, w: 320, h: 260, kind: "house" },
  { x: 1180, y: 1520, w: 380, h: 300, kind: "house" },
  { x: 420, y: 2280, w: 520, h: 380, kind: "barn" },
  { x: 260, y: 3220, w: 360, h: 280, kind: "house" },
  { x: 2380, y: 300, w: 420, h: 300, kind: "house" },
  { x: 2760, y: 3420, w: 480, h: 340, kind: "ruin" },
  { x: 3020, y: 1180, w: 520, h: 420, kind: "chapel" },
  { x: 3860, y: 520, w: 380, h: 280, kind: "house" },
  { x: 4620, y: 1180, w: 560, h: 420, kind: "mill" },
  { x: 5420, y: 420, w: 340, h: 260, kind: "house" },
  { x: 5560, y: 2420, w: 420, h: 320, kind: "barn" },
  { x: 4380, y: 3180, w: 460, h: 340, kind: "house" },
  { x: 1740, y: 3560, w: 620, h: 300, kind: "pond" },
  { x: 5240, y: 3620, w: 700, h: 320, kind: "pond" },
  { x: 1620, y: 900, w: 120, h: 900, kind: "hedge" },
  { x: 4520, y: 1900, w: 120, h: 900, kind: "hedge" },
];

/** Town square — walk inside it before you may vote. */
export const SQUARE = { x: 2960, y: 1940, w: 1080, h: 940 };
export const MEETING_FROM = SQUARE.x;
export const MEETING_TO = SQUARE.x + SQUARE.w;
export const BELL: Vec = { x: SQUARE.x + SQUARE.w / 2, y: SQUARE.y + SQUARE.h / 2 };
export const BELL_X = BELL.x;

export interface Station {
  id: string;
  name: string;
  x: number;
  y: number;
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
    | "beehive"
    | "laundry"
    | "woodpile"
    | "gate"
    | "bridge";
}

/** The town's wards — spread across the whole valley, not one street. */
export const STATIONS: Station[] = [
  { id: "pumpkins", name: "Harvest the pumpkins", x: 760, y: 1080, kind: "pumpkins" },
  { id: "well", name: "Draw water from the old well", x: 1420, y: 2340, kind: "well" },
  { id: "scarecrow", name: "Mend the scarecrow", x: 2020, y: 760, kind: "scarecrow" },
  { id: "beehive", name: "Smoke the beehives", x: 900, y: 3020, kind: "beehive" },
  { id: "woodpile", name: "Split the woodpile", x: 2260, y: 2860, kind: "woodpile" },
  { id: "lantern", name: "Relight the street lanterns", x: 2760, y: 1760, kind: "lantern" },
  { id: "chapel", name: "Light the chapel candles", x: 3280, y: 1620, kind: "chapel" },
  { id: "laundry", name: "Bring in the laundry", x: 4040, y: 1520, kind: "laundry" },
  { id: "mill", name: "Oil the sawmill gears", x: 4960, y: 1760, kind: "mill" },
  { id: "silo", name: "Lock the grain silo", x: 5480, y: 900, kind: "silo" },
  { id: "gate", name: "Bar the north gate", x: 3720, y: 420, kind: "gate" },
  { id: "graves", name: "Cover the open graves", x: 3960, y: 3420, kind: "graves" },
  { id: "bridge", name: "Mend the creek bridge", x: 2440, y: 3760, kind: "bridge" },
  { id: "radio", name: "Retune the radio tower", x: 5760, y: 3220, kind: "radio" },
];

/** Iron cages ringing the square. */
export const CAGES: Vec[] = [
  { x: 2820, y: 1780 },
  { x: 2820, y: 2160 },
  { x: 2820, y: 2540 },
  { x: 4180, y: 1780 },
  { x: 4180, y: 2160 },
  { x: 4180, y: 2540 },
];
/** Kept for the static client / renderer that still read the old shape. */
export const CAGE_XS = CAGES.map((c) => c.x);

export const PLAYER_COLORS = [
  "#c0392b", "#d35400", "#e0a52a", "#6b8e23", "#2e8b57",
  "#3a7ca5", "#5b4b8a", "#8e44ad", "#b0567a", "#7f8c8d",
];

// ---------------------------------------------------------------------------
// Creatures of the night — the identity a player wears.
// ---------------------------------------------------------------------------

export interface Creature {
  id: string;
  name: string;
  latin: string;
  blurb: string;
  sigil: "strigoi" | "wolf" | "wraith" | "banshee" | "moroii" | "vrykolakas";
  accent: string;
  /** Who already wears this face — the identity nobody took is the Strigoi. */
  claimedBy: string | null;
}

export const CREATURES: Creature[] = [
  {
    id: "strigoi",
    name: "Strigoi",
    latin: "Strigoi vivus",
    blurb:
      "A corpse that would not stay buried. It keeps its name, its appetite and its keys to the house it left.",
    sigil: "strigoi",
    accent: "#7B1220",
    claimedBy: null,
  },
  {
    id: "wolf",
    name: "Vârcolac",
    latin: "Canis nocturnus",
    blurb: "The wolf that swallows the moon. Taken by another hand long before you arrived.",
    sigil: "wolf",
    accent: "#6b8e23",
    claimedBy: "SierraA",
  },
  {
    id: "wraith",
    name: "Wraith",
    latin: "Umbra argentea",
    blurb: "Cold light with a grudge. Already spoken for.",
    sigil: "wraith",
    accent: "#3a7ca5",
    claimedBy: "Agent-Hollow",
  },
  {
    id: "banshee",
    name: "Banshee",
    latin: "Fletus mortuus",
    blurb: "She announces the death, she does not cause it. Claimed at the last bell.",
    sigil: "banshee",
    accent: "#8e44ad",
    claimedBy: "ArenaAgent",
  },
  {
    id: "moroii",
    name: "Moroi",
    latin: "Mortuus ambulans",
    blurb: "The restless dead of the parish. Unclaimed — but it is not the one you came for.",
    sigil: "moroii",
    accent: "#b0567a",
    claimedBy: null,
  },
  {
    id: "vrykolakas",
    name: "Vrykolakas",
    latin: "Cadaver inquietus",
    blurb: "Knocks twice on the door at midnight. Unclaimed, and still knocking.",
    sigil: "vrykolakas",
    accent: "#d35400",
    claimedBy: null,
  },
];

export const DEFAULT_CREATURE = "strigoi";

export type Role = "crew" | "hollow";
export type Phase = "lobby" | "playing" | "meeting" | "ended";

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  creature: string;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  alive: boolean;
  caged: boolean;
  hasKey: boolean;
  voted: boolean;
  downed: boolean;
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
  stamina: number; // 0..1
  exhausted: boolean; // hit 0 — must rest to 20% before working again
  blackoutCooldownMs: number;
  canBlackout: boolean;
  teammates: string[]; // other hollow ids (only for hollow)
  myVote: string | null;
  creature: string;
  downed: boolean;
  revive: number; // 0..1 — how far a friend has got in picking you back up
}

export interface TaskView {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: Station["kind"];
  done: boolean;
  progress: number; // 0..1
}

export interface FeedItem {
  text: string;
  at: number;
}

export interface Snapshot {
  code: string;
  mode: GameMode;
  phase: Phase;
  round: number;
  now: number;
  /** ms until dawn — nightwatch only */
  dawnAt: number;
  /** the thing in the fog, when it is abroad */
  stalker: { x: number; y: number } | null;
  self: SelfInfo;
  players: PublicPlayer[];
  bodies: { x: number; y: number; color: string; name: string }[];
  keyPos: Vec | null;
  cages: { x: number; y: number; occupant: string | null }[];
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
  dir?: number; // -1 | 0 | 1 on x (kept for the static client)
  dirX?: number; // -1 | 0 | 1
  dirY?: number; // -1 | 0 | 1
  interactHeld?: boolean;
  action?: "interact" | "ability" | "blackout" | "vote" | "start" | "restart" | "leave" | "creature";
  chat?: string;
  vote?: string; // playerId | "skip" | "free:<id>"
  creature?: string;
}
