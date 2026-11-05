// THE SINGLE SOURCE OF SPATIAL TRUTH for Hollow Creek.
// Every world dimension, on-screen size and zoom factor lives here so the
// street, the houses, the folk and the spyglass all agree on one metric.
// Gameplay *rates* (speeds, cooldowns, vigor) stay in balance.ts; this file is
// about *size and scale* only.
//
// Metric: one world unit is one centimetre. A grown traveller is ~1.7 m tall,
// drawn FIGURE_H units high, so distances shown to players convert cleanly.

/** centimetres per metre — the world is authored in cm. */
export const CM_PER_M = 100;
/** A traveller's drawn height in world units (~1.7 m). */
export const FIGURE_H = 48;
/** World units per metre, derived from the figure so scale stays human. */
export const UNITS_PER_M = FIGURE_H / 1.7;

/** The road's ends, in world units (cm). The town sits roughly 0…4200. */
export const WORLD_MIN = -3600;
export const WORLD_MAX = 8600;
export const WORLD_SPAN = WORLD_MAX - WORLD_MIN;

/** Convert a world distance to whole metres for player-facing text. */
export const metres = (units: number) => Math.round(Math.abs(units) / UNITS_PER_M);
/** Convert metres to world units (for authoring props/rooms by real size). */
export const units = (m: number) => Math.round(m * UNITS_PER_M);

// ---- Camera / spyglass -----------------------------------------------------
/** Default world zoom (1 = authored scale). */
export const ZOOM_DEFAULT = 1;
/** The spyglass / reading zoom — works anywhere, centres on its target. */
export const ZOOM_READ = 3.2;

// ---- Pinned pages ----------------------------------------------------------
export const NOTE_FAR = { w: 18, h: 24 };   // a scribble from the road
export const NOTE_NEAR = { w: 84, h: 108 }; // legible under the glass

// ---- Landmarks -------------------------------------------------------------
/** The meeting house is the tallest thing on the street. */
export const CHAPEL_SCALE = 1.55;
/** Foreground tree spacing (world units). */
export const TREE_SPACING = 190;

// ---- Vision (re-exported so size queries have one home) --------------------
export { VISION_CREW, VISION_HOLLOW, VISION_BLACKOUT } from "./balance";
