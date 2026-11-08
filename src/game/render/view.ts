// Per-frame values shared by the scene modules. Built once per render() call.
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
  /** Seconds since start; zero under reduced motion. */
  t: number;
  dt: number;
  /** Camera x in world units, and the y of the road. */
  cam: number;
  ground: number;
  /** Server clock in milliseconds. */
  now: number;
  /** Night 0..1 and its 0.1 bucket (used as a cache key). */
  night: number;
  nb: number;
  snap: Snapshot;
  /** Smoothed x of every figure this frame, keyed by player id. */
  displayX: Map<string, number>;
  /** Where the viewer's own traveller is drawn. */
  meX: number;
  focused: boolean;
  focusX: number | null;
  /** The glass is up (zoomed or reading): HUD-like labels stay out of the view. */
  glassUp: boolean;
  /** Vertical lift applied to the whole view while reading a page. */
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
  /** Gradients rebuilt only when their key changes. Owned by the Renderer. */
  grads: Map<string, CanvasGradient>;
}

/** Picks a value for the current quality preset. */
export function pick<T>(quality: Quality, high: T, medium: T, low: T): T {
  return quality === "high" ? high : quality === "medium" ? medium : low;
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Canvas gradients are immutable once built, so they are cached by the values that define them. */
export function cachedGradient(v: View, key: string, make: () => CanvasGradient): CanvasGradient {
  let g = v.grads.get(key);
  if (!g) {
    if (v.grads.size > 256) v.grads.clear();
    g = make();
    v.grads.set(key, g);
  }
  return g;
}
