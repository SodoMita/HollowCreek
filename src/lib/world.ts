// Shared world definition used by both the authoritative server sim and the client renderer.

export const WORLD_WIDTH = 6400;
export const GROUND_Y = 420;
export const BASE_SPEED = 215; // units per second
export const MEETING_SPEED = 320; // auto-walk speed when the bell tolls

export type LandmarkKind =
  | "orchard"
  | "busstop"
  | "chapel"
  | "graveyard"
  | "pumpkins"
  | "square"
  | "sawmill"
  | "dock"
  | "forest";

export type Landmark = {
  id: string;
  name: string;
  x: number;
  w: number;
  kind: LandmarkKind;
};

export const LANDMARKS: Landmark[] = [
  { id: "forest", name: "Forest Edge", x: 60, w: 620, kind: "forest" },
  { id: "orchard", name: "The Old Orchard", x: 720, w: 700, kind: "orchard" },
  { id: "lanterns", name: "Lantern Row", x: 1460, w: 560, kind: "busstop" },
  { id: "chapel", name: "Ashen Chapel", x: 2060, w: 620, kind: "chapel" },
  { id: "graveyard", name: "The Graveyard", x: 2720, w: 560, kind: "graveyard" },
  { id: "pumpkins", name: "Pumpkin Hollow", x: 3320, w: 560, kind: "pumpkins" },
  { id: "square", name: "Harvest Square", x: 3920, w: 840, kind: "square" },
  { id: "sawmill", name: "The Sawmill", x: 4820, w: 640, kind: "sawmill" },
  { id: "dock", name: "Black Lake Dock", x: 5520, w: 820, kind: "dock" },
];

export function landmarkAt(x: number): Landmark {
  let best = LANDMARKS[0];
  for (const l of LANDMARKS) {
    const c = l.x + l.w / 2;
    if (x >= l.x && x <= l.x + l.w) return l;
    if (Math.abs(x - c) < Math.abs(x - (best.x + best.w / 2))) best = l;
  }
  return best;
}

export type TaskDef = {
  id: string;
  name: string;
  x: number;
  dur: number; // seconds to hold interact
  icon: string;
  where: string;
};

export const TASKS: TaskDef[] = [
  { id: "apples", name: "Gather windfall apples", x: 880, dur: 4.5, icon: "🍎", where: "Old Orchard" },
  { id: "lanterns", name: "Light the lanterns", x: 1620, dur: 5.0, icon: "🕯️", where: "Lantern Row" },
  { id: "bell", name: "Oil the chapel bell", x: 2260, dur: 6.0, icon: "🔔", where: "Ashen Chapel" },
  { id: "graves", name: "Lay flowers on the graves", x: 2900, dur: 6.0, icon: "🪦", where: "Graveyard" },
  { id: "gate", name: "Chain the graveyard gate", x: 3140, dur: 5.0, icon: "⛓️", where: "Graveyard" },
  { id: "pumpkins", name: "Carve hollow lanterns", x: 3500, dur: 5.5, icon: "🎃", where: "Pumpkin Hollow" },
  { id: "leaves", name: "Rake the square", x: 4020, dur: 4.5, icon: "🍂", where: "Harvest Square" },
  { id: "posters", name: "Nail up missing posters", x: 4240, dur: 4.0, icon: "📄", where: "Harvest Square" },
  { id: "well", name: "Draw water from the well", x: 4620, dur: 5.0, icon: "🕳️", where: "Harvest Square" },
  { id: "timber", name: "Stack the sawn timber", x: 5080, dur: 6.0, icon: "🪵", where: "Sawmill" },
  { id: "nets", name: "Mend the fishing nets", x: 5860, dur: 5.5, icon: "🕸️", where: "Black Lake Dock" },
  { id: "signs", name: "Repaint the trail signs", x: 6260, dur: 4.0, icon: "🪧", where: "Forest Edge" },
];

export const TASKS_BY_ID: Record<string, TaskDef> = Object.fromEntries(
  TASKS.map((t) => [t.id, t]),
);

export const TASKS_PER_CREW = 5;

/** Hedge tunnels - the 1D equivalent of vents. Impostors slip between them. */
export const HEDGES: number[] = [540, 1180, 2400, 3600, 4700, 5700];

/** The cages in Harvest Square. Index matters: cage 0/1/2. */
export const CAGES = [
  { x: 4400, id: 0 },
  { x: 4520, id: 1 },
  { x: 4640, id: 2 },
];

export const MEETING_CENTER = 4300;
export const MEETING_SPOTS = [4020, 4065, 4110, 4155, 4200, 4245, 4290, 4335];

export const COLORS = [
  { name: "Rust", hex: "#c2410c" },
  { name: "Moss", hex: "#4d7c0f" },
  { name: "Ash", hex: "#94a3b8" },
  { name: "Plum", hex: "#7e22ce" },
  { name: "Blood", hex: "#b91c1c" },
  { name: "Bone", hex: "#e7e5e4" },
  { name: "Cider", hex: "#ea9a10" },
  { name: "Dusk", hex: "#1e3a8a" },
  { name: "Fungus", hex: "#0f766e" },
  { name: "Rose", hex: "#be185d" },
  { name: "Mud", hex: "#78350f" },
  { name: "Fog", hex: "#64748b" },
];

// ---- gameplay tuning ----
export const KILL_RANGE = 95;
export const KILL_COOLDOWN = 24_000;
export const REPORT_RANGE = 130;
export const TASK_RANGE = 110;
export const CAGE_RANGE = 150;
export const SNUFF_COOLDOWN = 46_000;
export const SNUFF_DURATION = 13_000;
export const HEDGE_COOLDOWN = 9_000;
export const FLARE_COOLDOWN = 42_000;
export const FLARE_DURATION = 7_000;
export const FLARE_RADIUS = 620;
export const VISION_CREW = 580;
export const VISION_IMPOSTOR = 760;
export const VISION_DARK = 190;
export const VISION_IMPOSTOR_DARK = 460;
export const DISCUSS_MS = 26_000;
export const VOTE_MS = 26_000;
export const REVEAL_MS = 9_000;
export const TRAVEL_MS = 26_000;
export const KEY_RESPAWN_MS = 45_000;
export const BUBBLE_MS = 6500;
