// Per-frame values shared by the draw functions. Built once per render() call.
import type { DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import type { PublicPlayer, Snapshot, TaskView } from "../types";

export interface Frame {
  ctx: CanvasRenderingContext2D;
  /** Viewport size in world units (after the zoom divide). */
  w: number;
  h: number;
  /** Seconds since start; zeroed under reduced motion. */
  t: number;
  dt: number;
  /** Camera x in world units, and the y of the road. */
  cam: number;
  ground: number;
  /** Server clock (ms) from the snapshot. */
  now: number;
  /** Night 0..1 and its 0.1 bucket (used as a gradient cache key). */
  night: number;
  nb: number;
  snap: Snapshot;
  /** Smoothed x of every figure this frame, keyed by player id. */
  displayX: Map<string, number>;
  /** Where the viewer's own traveller is drawn. */
  meX: number;
  /** A page is focused or the view is zoomed in: HUD labels are hidden. */
  focused: boolean;
  focusX: number | null;
  glassUp: boolean;
  /** Vertical lift applied to the whole view while reading a page. */
  lift: number;
  graphics: GameSettings["graphics"];
  tasks: Map<string, TaskView>;
  doors: Map<string, DoorState>;
  /** Players with the viewer last, so the viewer draws on top. */
  sorted: PublicPlayer[];
}
