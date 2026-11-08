// Per-frame values shared by the scene modules. One View object is created per
// Renderer and mutated in place each frame — the frame loop allocates nothing.
import type { DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import type { PublicPlayer, Snapshot, TaskView } from "../types";

export type Quality = GameSettings["graphics"]["quality"];
export type PinnedNote = NonNullable<Snapshot["notes"]>[number];

export interface View {
  /** Viewport in CSS pixels (stage coordinates). */
  cssW: number;
  cssH: number;
  /** Viewport in world units (CSS size divided by the zoom). */
  w: number;
  h: number;
  zoom: number;
  /** Renderer resolution (device px per CSS px); sizes the screen-space bakes. */
  res: number;
  /** Seconds since start; zero under reduced motion. */
  t: number;
  dt: number;
  /** Camera x (left edge) in world units. */
  cam: number;
  /** Server clock in milliseconds. */
  now: number;
  /** Night 0..1 and its 0.1 bucket (used as a bake cache key). */
  night: number;
  nb: number;
  snap: Snapshot;
  /** Smoothed x of every figure this frame, keyed by player id. */
  displayX: Map<string, number>;
  /** Where the viewer's own traveller is drawn (world x). */
  meX: number;
  focused: boolean;
  focusX: number | null;
  /** The glass is up (zoomed or reading): HUD-like labels stay out of the view. */
  glassUp: boolean;
  /** Vertical lift in world units while reading a page. */
  lift: number;
  quality: Quality;
  reduced: boolean;
  glow: boolean;
  settings: GameSettings;
  /** Players with the viewer last, so the viewer draws on top. */
  sorted: PublicPlayer[];
  /** Tasks by id (outdoor stations and indoor work alike). */
  tasks: Map<string, TaskView>;
  /** The first indoor task of each house, by house id. */
  houseTask: Map<string, TaskView>;
  doors: Map<string, DoorState>;
  /** Houses with a living occupant. */
  occupied: Set<string>;
  notesByHouse: Map<string, PinnedNote[]>;
}

/** Picks a value for the current quality preset. */
export function pick<T>(quality: Quality, high: T, medium: T, low: T): T {
  return quality === "high" ? high : quality === "medium" ? medium : low;
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
