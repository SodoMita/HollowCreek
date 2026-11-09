// Per-frame values shared by the scene modules. One View instance is owned by
// the Renderer and updated in place each frame so render() allocates nothing.
import type { DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import type { PublicPlayer, Snapshot, TaskView } from "../types";

export type Quality = GameSettings["graphics"]["quality"];
export type PinnedNote = NonNullable<Snapshot["notes"]>[number];

export interface View {
  ctx: CanvasRenderingContext2D;
  /** Viewport in world units, after the zoom divide. */
  w: number;
  h: number;
  /** Seconds since start; zero under reduced motion (decorative motion). */
  t: number;
  /** Monotonic clock in seconds; always advances (drives walk stride & timing). */
  clock: number;
  dt: number;
  /** Camera x in world units, and the y of the road. */
  cam: number;
  ground: number;
  /** Back edge of the road (horizon where ground starts behind houses/trees/shadows). */
  roadEdge: number;
  /** Server clock in milliseconds. */
  now: number;
  /** Night 0..1 and its 0.1 bucket. */
  night: number;
  nb: number;
  snap: Snapshot;
  /** Authoritative displayed x of every figure this frame, keyed by player id. */
  displayX: Map<string, number>;
  /** Where the viewer's own traveller is drawn. */
  meX: number;
  focused: boolean;
  focusX: number | null;
  /** Current camera zoom factor (worldZoom * viewZoom). */
  zoom: number;
  /** The glass is up (zoomed or reading): HUD-like labels stay out of the view. */
  glassUp: boolean;
  /** Vertical lift applied to the whole view while reading a page. */
  lift: number;
  quality: Quality;
  reduced: boolean;
  glow: boolean;
  flicker: boolean;
  playerNames: boolean;
  speechBubbles: boolean;
  /** Players with the viewer last, so the viewer draws on top. */
  sorted: PublicPlayer[];
  tasks: Map<string, TaskView>;
  houseTask: Map<string, TaskView>;
  doors: Map<string, DoorState>;
  occupied: Set<string>;
  notesByHouse: Map<string, PinnedNote[]>;
}

/** Picks a value for the current quality preset. */
export function pick<T>(quality: Quality, high: T, medium: T, low: T): T {
  return quality === "high" ? high : quality === "medium" ? medium : low;
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
