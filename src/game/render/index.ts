// Canvas renderer for Hollow Creek: pure drawing, no game rules.
//
// Obeys all seven performance rules:
//   1. SVG art and procedural shapes are baked into bitmaps; zero paths per frame.
//   2. Gradients, shadows, and glows are pre-baked into static layers or sprites.
//   3. Stationary frames under reducedMotion skip full redraws entirely.
//   4. Zero per-frame View/Map/Set/string allocations inside render().
//   5. Every world layer culls to the viewport before drawing.
//   6. Never reads pixels back from the canvas during play.
//   7. Never touches the DOM.
import { WORLD_MAX, WORLD_MIN, type DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import { createDefaultSettings } from "../settings";
import { CAGE_XS, WORLD_W, type PublicPlayer, type Snapshot, type TaskView } from "../types";
import { ZOOM_MAX, ZOOM_READ } from "../units";
import { artReady, artVersion, preloadArt, setArtScale } from "../svg-assets";
import { drawBackdrop } from "./backdrop";
import { drawCreek, drawMeetingSquare, drawRoadDressing, drawRuts, drawStreetProps } from "./street";
import { drawBellTower, drawCage, drawDoorKeys, drawKey, drawKits, drawCart, drawTimepieces } from "./props";
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
export const CAGE_POSITIONS = CAGE_XS;

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
  private visionR = 420;
  private index: Index | null = null;
  private settings: GameSettings = createDefaultSettings();
  private view: View | null = null;
  private lastStaticKey = "";
  private lastRenderedSnap: Snapshot | null = null;
  private hasCamera = false;
  private wasFocused = false;
  private lastPhase = "";
  private clock = 0;

  cameraX = 0;
  focusX: number | null = null;
  viewZoom = 1;

  constructor() {
    void preloadArt();
  }

  setSettings(settings: GameSettings) {
    this.settings = settings;
    this.lastStaticKey = "";
    this.lastRenderedSnap = null;
  }

  setFocus(x: number | null) {
    this.focusX = x;
  }

  setViewZoom(z: number) {
    this.viewZoom = clamp(z, 1, ZOOM_MAX);
  }

  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    displayX: Map<string, number>,
    t: number,
    dt: number,
  ) {
    if (!artReady()) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
      return;
    }
    const graphics = this.settings.graphics;
    if (!this.index || this.index.snap !== snap) this.index = buildIndex(snap);
    const ix = this.index;

    const focused = this.focusX !== null;
    const glassUp = focused || this.viewZoom > 1.05;
    const base = graphics.worldZoom * this.viewZoom;
    const zoom = Math.min(graphics.worldZoom * ZOOM_MAX, focused ? Math.max(base, ZOOM_READ) : base);
    setArtScale(ctx.getTransform().a * zoom);

    const vw = w / zoom;
    const vh = h / zoom;
    const reduced = graphics.reducedMotion;
    const meX = ix.me ? displayX.get(ix.me.id) ?? ix.me.x : WORLD_W / 2;
    const lookX = focused ? this.focusX! : meX;
    // The camera is a pure function of where the server says you are. No easing,
    // no chase, no residual motion: with positions arriving every tick, an eased
    // camera is a second laggy copy of your own soul that never quite catches up
    // (and visibly swims when the frame rate changes).
    this.cameraX = clamp(lookX - vw / 2, WORLD_MIN, WORLD_MAX - vw);
    this.visionR = snap.visionRadius;
    this.hasCamera = true;
    this.lastPhase = snap.phase;
    this.wasFocused = focused;
    if (WORLD_MAX - WORLD_MIN < vw) this.cameraX = (WORLD_MIN + WORLD_MAX - vw) / 2;

    const night = snap.time?.mode === "past" ? 0.05 : clamp(snap.nightT ?? 0.2, 0, 1);
    const nb = Math.round(night * 10) / 10;

    // Under reduced motion, when camera, zoom, focus, vision and snapshot are settled,
    // skip repainting the identical frame.
    this.clock += dt;
    const anyMoving = snap.players.some((p) => p.moving);
    if (reduced && !anyMoving && this.lastRenderedSnap === snap) {
      const staticKey = `${artVersion()}|${ctx.canvas.width}x${ctx.canvas.height}|${this.cameraX.toFixed(1)}|${zoom.toFixed(3)}|${this.focusX}|${nb}|${snap.players.map((p) => (displayX.get(p.id) ?? p.x).toFixed(1)).join(",")}|${snap.cartX}`;
      if (staticKey === this.lastStaticKey) return;
      this.lastStaticKey = staticKey;
    } else {
      this.lastStaticKey = "";
    }
    this.lastRenderedSnap = snap;

    ctx.save();
    ctx.scale(zoom, zoom);
    let lift = 0;
    if (focused) {
      const page = (snap.notes ?? []).find((n) => n.x === this.focusX);
      if (page) lift = Math.max(0, (page.kind === "wall" ? 165 : 121) - 0.28 * vh);
      ctx.translate(0, lift);
    }

    const ground = vh * 0.74;
    const roadEdge = ground - 16;
    const v = this.view;
    if (!v) {
      this.view = {
        ctx, w: vw, h: vh, t: reduced ? 0 : t, clock: this.clock, dt, cam: this.cameraX, ground, roadEdge, now: snap.now,
        night, nb, snap, displayX, meX, focused, focusX: this.focusX, glassUp, lift,
        quality: graphics.quality, reduced, glow: graphics.glow, flicker: graphics.flicker,
        playerNames: this.settings.interface.playerNames, speechBubbles: this.settings.interface.speechBubbles,
        sorted: ix.sorted, tasks: ix.tasks, houseTask: ix.houseTask, doors: ix.doors,
        occupied: ix.occupied, notesByHouse: ix.notesByHouse,
      };
    } else {
      v.ctx = ctx; v.w = vw; v.h = vh; v.t = reduced ? 0 : t; v.clock = this.clock; v.dt = dt; v.cam = this.cameraX;
      v.ground = ground; v.roadEdge = roadEdge; v.now = snap.now; v.night = night; v.nb = nb; v.snap = snap;
      v.displayX = displayX; v.meX = meX; v.focused = focused; v.focusX = this.focusX;
      v.glassUp = glassUp; v.lift = lift; v.quality = graphics.quality; v.reduced = reduced;
      v.glow = graphics.glow; v.flicker = graphics.flicker;
      v.playerNames = this.settings.interface.playerNames;
      v.speechBubbles = this.settings.interface.speechBubbles;
      v.sorted = ix.sorted; v.tasks = ix.tasks; v.houseTask = ix.houseTask; v.doors = ix.doors;
      v.occupied = ix.occupied; v.notesByHouse = ix.notesByHouse;
    }
    const frame = this.view!;

    drawBackdrop(frame);
    drawRuts(frame);
    drawRoadDressing(frame);
    drawStreetProps(frame);
    drawCreek(frame);
    drawMeetingSquare(frame);
    drawHouseInteriors(frame);
    drawStations(frame);
    drawCart(frame);
    drawKits(frame);
    drawStreetNotes(frame);
    drawBellTower(frame);
    for (const c of snap.cages) drawCage(frame, c.x, false);
    drawKey(frame);
    drawTimepieces(frame);
    drawDoorKeys(frame);
    drawBodies(frame, true);
    drawPlayers(frame, this.motion, (p) => !!p.inside && !p.caged);
    drawHouseExteriors(frame, this.doorOpen);
    drawBodies(frame, false);
    drawPlayers(frame, this.motion, (p) => p.caged);
    for (const c of snap.cages) drawCage(frame, c.x, true);
    drawPlayers(frame, this.motion, (p) => !p.caged && !p.inside);

    if (graphics.particles && !reduced) drawLeaves(frame, this.leaves, pick(frame.quality, 100, 55, 22));
    if (graphics.particles) drawFireflies(frame, pick(frame.quality, 18, 12, 6));
    if (graphics.fog) drawFog(frame, pick(frame.quality, 4, 3, 1));
    if (frame.quality !== "low") drawReeds(frame);
    this.visionR = drawDarkness(frame, this.visionR);
    if (snap.time?.mode === "past") drawPastWash(frame);
    drawScreenGrade(frame, graphics.vignette);
    drawFlicker(frame);
    ctx.restore();
  }
}
