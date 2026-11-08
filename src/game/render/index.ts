// Canvas renderer for Hollow Creek: pure drawing, no game rules.
//
// A frame is a fixed sequence of layers, drawn back to front. Each layer is a
// function over a View (the frame's values). State that must survive between
// frames lives here: the camera, the falling leaves, door swing, traveller motion,
// the darkness radius, and the per-snapshot indexes.
//
// Rules the layers follow:
//   - SVG art is rasterised once per size and device density; a frame copies bitmaps.
//   - Light is a pre-rendered sprite, never shadowBlur.
//   - No blend modes. Full-screen passes are few: the grade+vignette overlay, the
//     darkness mask, the flicker and the grain.
//   - Gradients are cached by the values that define them; text widths are cached.
//   - Lookups (players, tasks, doors, notes, occupancy) are built once per snapshot.
//   - Objects outside the viewport are skipped before any state is touched.
import { WORLD_MAX, WORLD_MIN, type DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import { createDefaultSettings } from "../settings";
import { BELL_X, CAGE_XS, WORLD_W, type PublicPlayer, type Snapshot, type TaskView } from "../types";
import { ZOOM_MAX, ZOOM_READ } from "../units";
import { artReady, preloadArt, setArtScale } from "../svg-assets";
import { drawBackdrop } from "./backdrop";
import { drawCreek, drawRuts, drawMeetingSquare, drawRoadDressing, drawStreetProps } from "./street";
import { drawBellTower, drawCage, drawCart, drawDoorKeys, drawKey, drawKits, drawTimepieces } from "./props";
import { drawHouseExteriors, drawHouseInteriors } from "./houses";
import { drawStations } from "./stations";
import { drawStreetNotes } from "./notes";
import { drawBodies, drawPlayers, type Motion } from "./actors";
import {
  drawDarkness, drawFireflies, drawFlicker, drawFog, drawLeaves, drawPastWash,
  drawReeds, drawScreenGrade, makeLeaves, type Leaf,
} from "./fx";
import { clamp, pick, type PinnedNote, type View } from "./view";

export { ZOOM_MAX, ZOOM_READ };
/** World x of each cage, for the wider game code that needs cage positions. */
export const CAGE_POSITIONS = CAGE_XS;

/** Lookups built once per snapshot, so a frame never searches the lists. */
interface Index {
  snap: Snapshot;
  me: PublicPlayer | undefined;
  sorted: PublicPlayer[];
  tasks: Map<string, TaskView>;
  houseTask: Map<string, TaskView>;
  doors: Map<string, DoorState>;
  occupied: Set<string>;
  notesByHouse: Map<string, PinnedNote[]>;
}

function buildIndex(snap: Snapshot): Index {
  const me = snap.players.find((p) => p.id === snap.self.id);
  // The viewer is drawn last, on top of everyone else.
  const sorted = [...snap.players].sort((a, b) => (a.id === snap.self.id ? 1 : 0) - (b.id === snap.self.id ? 1 : 0));
  const tasks = new Map(snap.tasks.map((t) => [t.id, t]));
  const houseTask = new Map<string, TaskView>();
  for (const t of snap.tasks) if (t.inside && !houseTask.has(t.inside)) houseTask.set(t.inside, t);
  const occupied = new Set<string>();
  for (const p of snap.players) if (p.inside && p.alive) occupied.add(p.inside);
  const notesByHouse = new Map<string, PinnedNote[]>();
  for (const n of snap.notes ?? []) {
    if (!n.house) continue;
    const list = notesByHouse.get(n.house);
    if (list) list.push(n);
    else notesByHouse.set(n.house, [n]);
  }
  const doors = new Map((snap.doors ?? []).map((d) => [d.id, d]));
  return { snap, me, sorted, tasks, houseTask, doors, occupied, notesByHouse };
}

export class Renderer {
  private leaves: Leaf[] = makeLeaves();
  private readonly motion = new Map<string, Motion>();
  private readonly doorOpen = new Map<string, number>();
  private readonly grads = new Map<string, CanvasGradient>();
  private visionR = 420;
  private index: Index | null = null;
  // One View instance, mutated per frame: the render path allocates nothing.
  private view: View | null = null;
  private primed = false;
  private readonly createdAt = performance.now();
  private settings: GameSettings = createDefaultSettings();

  /** Smoothed camera x in world units. */
  cameraX = 0;
  /** When set, the camera centres on this world x and zooms in to read a page. */
  focusX: number | null = null;
  /** A multiplier on the settings' world zoom (1 = lowered). */
  viewZoom = 1;

  constructor() {
    // Art starts loading as soon as a renderer exists; render() holds frames until it is ready.
    void preloadArt();
  }

  setSettings(settings: GameSettings) {
    this.settings = settings;
  }

  setFocus(x: number | null) {
    this.focusX = x;
  }

  /** The spyglass / pinch zoom, clamped to [1, ZOOM_MAX]. */
  setViewZoom(z: number) {
    this.viewZoom = clamp(z, 1, ZOOM_MAX);
  }

  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    displayX: Map<string, number>,
    t: number, // seconds
    dt: number,
  ) {
    // Draw immediately: every layer has a fallback (drawn trees, cloak silhouettes) and
    // art appears as it loads. Holding a blank canvas until *all* art settled made the
    // opening seconds flicker black. Only the very first frames wait for the traveller
    // template, which every figure needs.
    if (!this.primed) {
      if (!artReady() && performance.now() - this.createdAt < 600) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
        return;
      }
      this.primed = true;
    }
    const graphics = this.settings.graphics;
    if (!this.index || this.index.snap !== snap) this.index = buildIndex(snap);
    const ix = this.index;

    // Zoom the world, not the DOM HUD. Gameplay and server vision stay in world units.
    const focused = this.focusX !== null;
    const glassUp = focused || this.viewZoom > 1.05;
    const base = graphics.worldZoom * this.viewZoom;
    const zoom = Math.min(graphics.worldZoom * ZOOM_MAX, focused ? Math.max(base, ZOOM_READ) : base);
    // Device pixels per CSS pixel, times the zoom, decides the sprite density.
    setArtScale(ctx.getTransform().a * zoom);

    ctx.save();
    ctx.scale(zoom, zoom);
    const vw = w / zoom;
    const vh = h / zoom;
    // A page under the glass sits mid-screen: the whole view lifts by the page's height.
    let lift = 0;
    if (focused) {
      const page = (snap.notes ?? []).find((n) => n.x === this.focusX);
      if (page) lift = Math.max(0, (page.kind === "wall" ? 165 : 121) - 0.28 * vh);
      ctx.translate(0, lift);
    }
    const reduced = graphics.reducedMotion;
    const meX = ix.me ? displayX.get(ix.me.id) ?? ix.me.x : WORLD_W / 2;
    const lookX = focused ? this.focusX! : meX;
    const targetCam = clamp(lookX - vw / 2, WORLD_MIN, WORLD_MAX - vw);
    // Follow the viewer tightly (the camera must not add lag to your own input);
    // only the glass focus keeps a soft ease.
    const ease = focused ? 6 : 18;
    if (graphics.cameraSmoothing) this.cameraX += (targetCam - this.cameraX) * Math.min(1, dt * ease);
    else this.cameraX = targetCam;
    if (WORLD_MAX - WORLD_MIN < vw) this.cameraX = (WORLD_MIN + WORLD_MAX - vw) / 2;

    // Time travel to the past pins the sky to early dusk.
    const night = snap.time?.mode === "past" ? 0.05 : clamp(snap.nightT ?? 0.2, 0, 1);
    const v = this.view ?? (this.view = {} as View);
    v.ctx = ctx; v.w = vw; v.h = vh; v.t = reduced ? 0 : t; v.dt = dt; v.cam = this.cameraX;
    v.ground = vh * 0.78; v.now = snap.now; v.night = night; v.nb = Math.round(night * 10) / 10;
    v.snap = snap; v.displayX = displayX; v.meX = meX; v.focused = focused; v.focusX = this.focusX;
    v.glassUp = glassUp; v.lift = lift; v.quality = graphics.quality; v.reduced = reduced;
    v.glow = graphics.glow; v.settings = this.settings; v.sorted = ix.sorted; v.tasks = ix.tasks;
    v.houseTask = ix.houseTask; v.doors = ix.doors; v.occupied = ix.occupied;
    v.notesByHouse = ix.notesByHouse; v.grads = this.grads;

    // --- the world, back to front ---
    drawBackdrop(v);
    drawRuts(v);
    drawRoadDressing(v);
    drawStreetProps(v);
    drawCreek(v);
    drawMeetingSquare(v);
    drawHouseInteriors(v);
    drawStations(v);
    drawCart(v);
    drawKits(v);
    drawStreetNotes(v);
    drawBellTower(v);
    for (const c of snap.cages) drawCage(v, c.x, false);
    drawKey(v);
    drawTimepieces(v);
    drawDoorKeys(v);
    drawBodies(v, true);
    drawPlayers(v, this.motion, (p) => !!p.inside && !p.caged);
    drawHouseExteriors(v, this.doorOpen);
    drawBodies(v, false);
    drawPlayers(v, this.motion, (p) => p.caged);
    for (const c of snap.cages) drawCage(v, c.x, true);
    drawPlayers(v, this.motion, (p) => !p.caged && !p.inside);

    // --- atmosphere and screen passes ---
    if (graphics.particles && !reduced) drawLeaves(v, this.leaves, pick(v.quality, 100, 55, 22));
    if (graphics.particles) drawFireflies(v, pick(v.quality, 18, 12, 6));
    if (graphics.fog) drawFog(v, pick(v.quality, 4, 3, 1));
    if (v.quality !== "low") drawReeds(v);
    this.visionR = drawDarkness(v, this.visionR);
    if (snap.time?.mode === "past") drawPastWash(v);
    drawScreenGrade(v);
    drawFlicker(v);
    ctx.restore();
  }
}
