// THE SINGLE SOURCE OF SPATIAL TRUTH for Hollow Creek.
// Every world dimension, on-screen size and zoom factor lives here so the
// street, the houses, the folk and the spyglass all agree on one metric.
// Gameplay *rates* (speeds, cooldowns, vigor) stay in balance.ts; this file is
// about *size and scale* only.
//
// Metric: a grown traveller is ~1.7 m tall and is drawn FIGURE_H units high
// (measured on characters/traveler.svg: hood top to boot sole), so distances
// shown to players convert cleanly. Express new sizes in metres with m() or
// units() instead of inventing pixel numbers.

/** A traveller's drawn height in world units (~1.7 m). */
export const FIGURE_H = 48;
/** World units per metre, derived from the figure so scale stays human (≈28.2). */
export const UNITS_PER_M = FIGURE_H / 1.7;
/** Alias used by art authored in metres. */
export const METRE = UNITS_PER_M;

/** The road's ends, in world units. The old town sits roughly 0…4200. */
export const WORLD_MIN = -3600;
export const WORLD_MAX = 8600;
export const WORLD_SPAN = WORLD_MAX - WORLD_MIN;

/** Convert a world distance to whole metres for player-facing text. */
export const metres = (units: number) => Math.round(Math.abs(units) / UNITS_PER_M);
/** Convert metres to world units (for authoring props/rooms by real size). */
export const units = (m: number) => Math.round(m * UNITS_PER_M);
/** Same as units(); reads well inline: m(1.7). */
export const m = units;
export const toMetres = (u: number) => u / UNITS_PER_M;

// What is drawn and balanced today, in metres (world units in brackets).
// Balance values are locked; this table only names them in human sizes:
//   person height            1.7 m    [48]
//   house (Tollhouse etc.)   10.6 m   [300]   wall 4 m [112], ridge 5.6 m [158]
//   meeting house nave       8.5 m    [240]   — MEETING_HOUSE below
//   lantern / tool reach     2.8 m    [80]    INTERACT_RANGE
//   the Hollow's reach       2.7 m    [75]    KILL_RANGE
//   crew vision              14.9 m   [420]   VISION_CREW
//   Hollow vision            22 m     [620]   VISION_HOLLOW
//   walking                  6.7 m/s  [190/s] SPEED (brisk — the night is short)
//   carrying a kit           4.3 m/s  [122/s] CARRY_SPEED
//   the whole road           432 m    [-3600…8600]
//
// Vertical budget: the camera shows ≈ 20 m above the road at zoom 1, so very
// tall things (the spire) are compressed rather than to scale.
export const MAX_DRAWN_HEIGHT_M = 16;

// ---- Camera / spyglass -----------------------------------------------------
/** Default world zoom (1 = authored scale). */
export const ZOOM_DEFAULT = 1;
/** The spyglass / reading zoom — works anywhere, centres on its target. */
export const ZOOM_READ = 3.2;
/** The most any pinch or wheel allows. */
export const ZOOM_MAX = 4;

// ---- Pinned pages ----------------------------------------------------------
export const NOTE_FAR = { w: 18, h: 24 };   // a scribble from the road
export const NOTE_NEAR = { w: 84, h: 108 }; // legible under the glass

// ---- Landmarks -------------------------------------------------------------
/** The meeting house, the one building drawn from metric dimensions in render.ts. */
export const MEETING_HOUSE = {
  width: m(8.5),      // nave, gable to the road
  wallHeight: m(5),
  roofRise: m(2.4),
  towerWidth: m(1.8),
  towerBase: m(3.4),   // from the ridge to the belfry floor
  belfryHeight: m(1.7),
  spireHeight: m(3),
  windowWidth: m(0.95),
  windowHeight: m(1.9),
  doorWidth: m(1.3),
  doorHeight: m(2.4),
};
/** Foreground tree spacing (world units). */
export const TREE_SPACING = 190;

// ---- Vision (re-exported so size queries have one home) --------------------
export { VISION_CREW, VISION_HOLLOW, VISION_BLACKOUT } from "./balance";
