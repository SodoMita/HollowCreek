// ONE place for the game's scale.
//
// The street is a 1D road measured in "world units" (integers on the wire, see
// types.ts `ix`). Nothing else in the code should invent a scale: express a
// size in metres and convert with `m()`, or read the reference table below
// when judging whether an existing number is sensible.
//
// Chosen so the traveler sprite (≈71 world units tall) is a 1.7 m person.

export const METRE = 42; // world units per metre
export const m = (metres: number) => Math.round(metres * METRE);
export const toMetres = (units: number) => units / METRE;

// What is drawn and balanced today, in metres (world units in brackets):
//   person height            1.7 m   [71]
//   house (Tollhouse etc.)   7.1 m   [300]   wall 2.7 m [112], ridge 3.8 m [158]
//   meeting house nave       6 m     [252]   — see MEETING_HOUSE below
//   street lantern reach     1.9 m   [80]    INTERACT_RANGE
//   the Hollow's reach       1.8 m   [75]    KILL_RANGE
//   crew vision              10 m    [420]   VISION_CREW
//   Hollow vision            14.8 m  [620]   VISION_HOLLOW
//   walking                  4.5 m/s [190/s] SPEED (brisk — the night is short)
//   carrying a kit           2.9 m/s [122/s] CARRY_SPEED
//   the whole road           310 m   [-4200…8800]
//
// Vertical budget: the camera shows ≈ 13 m above the road at zoom 1, so tall
// things (the spire) are drawn compressed rather than to scale. Keep that in
// mind before making anything taller than MAX_DRAWN_HEIGHT_M.
export const MAX_DRAWN_HEIGHT_M = 11.5;

/** The meeting house, the one building drawn to these dimensions in render.ts. */
export const MEETING_HOUSE = {
  width: m(6),       // nave, gable to the road
  wallHeight: m(3.6),
  roofRise: m(1.7),
  towerWidth: m(1.25),
  towerBase: m(2.4),  // from the ridge to the belfry floor
  belfryHeight: m(1.2),
  spireHeight: m(2.1),
  windowWidth: m(0.67),
  windowHeight: m(1.33),
  doorWidth: m(0.9),
  doorHeight: m(1.7),
};
