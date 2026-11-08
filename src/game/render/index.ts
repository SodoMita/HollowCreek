// Hollow Creek renderer — a retained display list.
//
// The scene is described once per snapshot as bounded nodes (`./scene.ts`) in
// depth bands. Each frame the compositor culls by camera, orders by band, then
// runs one generic draw loop. Nothing in the frame path knows what a house, a
// tree or a soul is, so there is no per-object optimisation to maintain: a new
// visual is one `scene.add(...)`, and culling/ordering come for free.
//
// Camera maths and ordering helpers live in ./plan.ts and are unit-tested.
import { BELL_X, CAGE_XS, WORLD_W, type PublicPlayer, type Snapshot, type TaskView } from "../types";
import { BUILDINGS, WORLD_MAX, WORLD_MIN, type DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import { ZOOM_MAX, ZOOM_READ } from "../units";
import { drawForeground, drawGrade, makeGrainTile } from "../atmosphere";
import { artReady, preloadArt } from "../svg-assets";
import { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { drawSky } from "./sky";
import { drawHorizon } from "./horizon";
import { drawCreekBridge, drawCreekGlintLayer, drawGroundProps, drawGroundSurface, drawMeetingSquare } from "./ground";
import { drawHouseExteriors, drawHouseInteriors } from "./houses";
import { drawCartAndKits, drawStations } from "./stations";
import { drawNote, drawPinnedNotes } from "./note";
import { drawBellTower, drawCage, drawDoorKeys, drawKey, drawTimepieces } from "./landmarks";
import { drawBody, drawPlayer, type Motion } from "./player";
import { drawDarkness, drawFireflyLayer, drawFlicker, drawFog, drawLeaves, drawPastWash, drawVignette, makeLeaves, type Leaf } from "./effects";
import { cameraTarget, drawOrder, smoothCamera } from "./plan";
import { Scene, type SceneStats } from "./scene";

export { ZOOM_MAX, ZOOM_READ };
/** World x of each cage, for the wider game code that needs cage positions. */
export const CAGE_POSITIONS = CAGE_XS;

/** Anything further than this outside the view never reaches the draw loop. */
const CULL_SLACK = 120;

export class Renderer {
  private readonly env = new DrawEnv();
  private readonly leaves: Leaf[] = makeLeaves();
  private readonly scene = new Scene();

  // Per-snapshot state.
  private sceneFor: Snapshot | null = null;
  private notesLess: Snapshot | null = null;
  private meCache: PublicPlayer | undefined;
  private sortedCache: PublicPlayer[] = [];
  private doorsCache = new Map<string, DoorState>();
  private tasksCache = new Map<string, TaskView>();

  // Between-frame state.
  private grainTile: HTMLCanvasElement | null | undefined;
  private visionR = 420;
  private readonly doorOpenAmount = new Map<string, number>();
  private readonly motion = new Map<string, Motion>();

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

  setSettings(settings: GameSettings) { this.env.settings = settings; }

  setFocus(x: number | null) { this.focusX = x; }

  /** The spyglass / pinch zoom: clamped to [1, ZOOM_MAX]. */
  setViewZoom(z: number) { this.viewZoom = Math.max(1, Math.min(ZOOM_MAX, z)); }

  /** Scene composition of the last frame, for the opt-in perf readout. */
  get sceneStats(): SceneStats { return this.scene.stats(this.cameraX, 1); }

  private cacheSnap(snap: Snapshot) {
    if (this.sceneFor === snap) return;
    this.sceneFor = snap;
    this.notesLess = { ...snap, notes: [] };
    this.meCache = snap.players.find((p) => p.id === snap.self.id);
    this.sortedCache = drawOrder(snap.players, snap.self.id);
    this.doorsCache = new Map((snap.doors ?? []).map((d) => [d.id, d]));
    this.tasksCache = new Map(snap.tasks.map((t) => [t.id, t]));
    this.buildScene(snap);
  }

  /**
   * Describe the room once per snapshot. Every node carries a band, a world x
   * and a cull span; the frame loop only executes them.
   */
  private buildScene(snap: Snapshot) {
    const scene = this.scene;
    const env = this.env;
    const notesLess = this.notesLess ?? snap;
    scene.clear();

    // --- screen-wide layers -------------------------------------------------
    scene.add({ band: "sky", x: 0, span: 0, screen: true, draw: (f) => drawSky(f, env) });
    scene.add({ band: "horizon", x: 0, span: 0, screen: true, draw: (f) => drawHorizon(f, env) });
    scene.add({ band: "ground", x: 0, span: 0, screen: true, draw: (f) => drawGroundSurface(f, env) });
    scene.add({ band: "groundProps", x: 0, span: 0, screen: true, draw: (f) => drawGroundProps(f) });
    scene.add({ band: "creek", x: -2660, span: 320, draw: (f) => drawCreekBridge(f) });
    scene.add({ band: "creek", x: 0, span: 0, screen: true, draw: (f) => drawCreekGlintLayer(f) });
    scene.add({ band: "square", x: 0, span: 0, screen: true, draw: (f) => drawMeetingSquare(f) });

    // --- structures ---------------------------------------------------------
    scene.add({
      band: "interior", x: 0, span: 0, screen: true, label: "interiors",
      // Pages stay live (focus zoom, flutter): the interior pass skips them.
      draw: (f) => drawHouseInteriors({ ...f, snap: notesLess }, env),
    });
    scene.add({ band: "station", x: 0, span: 0, screen: true, label: "wards", draw: (f) => drawStations(f, env) });
    scene.add({ band: "station", x: 0, span: 0, screen: true, label: "cart", draw: (f) => drawCartAndKits(f) });
    scene.add({ band: "bell", x: BELL_X, span: 140, draw: (f) => drawBellTower(f.ctx, BELL_X - f.cam, f.ground, f.t, f.now - f.snap.bellAt < 4000) });

    for (const cage of snap.cages) {
      scene.add({ band: "cageBack", x: cage.x, span: 110, label: "cage", draw: (f) => drawCage(f.ctx, cage.x - f.cam, f.ground, false) });
    }

    // --- loose props and pages ---------------------------------------------
    scene.add({ band: "overlay", x: 0, span: 0, screen: true, label: "pages", draw: (f) => drawPinnedNotes(f, env) });
    for (const note of snap.notes ?? []) {
      if (!note.house) continue;
      scene.add({
        band: "overlay", x: note.x, span: 180, label: "wall page",
        draw: (f) => drawNote(f.ctx, note.x - f.cam, f.ground, "wall", f.focused && f.focusX === note.x, f.t, note, env),
      });
    }
    if (snap.keyX !== null) {
      const keyX = snap.keyX;
      scene.add({ band: "overlay", x: keyX, span: 90, label: "iron key", draw: (f) => drawKey(f, env) });
    }
    scene.add({ band: "overlay", x: 0, span: 0, screen: true, label: "timepieces", draw: (f) => drawTimepieces(f, env) });
    scene.add({ band: "overlay", x: 0, span: 0, screen: true, label: "house keys", draw: (f) => drawDoorKeys(f, env) });

    // --- bodies and souls ---------------------------------------------------
    for (const b of snap.bodies) {
      scene.add({
        band: b.inside ? "insideBody" : "outsideBody", x: b.x, span: 120, label: "body",
        draw: (f) => drawBody(f, b),
      });
    }
    for (const p of this.sortedCache) {
      const band = p.caged ? "cagedActor" : p.inside ? "insideActor" : "outsideActor";
      scene.add({
        band, x: 0, span: 0, screen: true, label: "soul",
        draw: (f) => drawPlayer(f, env, this.motion, f.snap.players.find((q) => q.id === p.id) ?? p),
      });
    }

    // --- facades, then the front cages and the weather ----------------------
    scene.add({
      band: "facade", x: 0, span: 0, screen: true, label: "facades",
      draw: (f) => {
        this.advanceDoors(f);
        drawHouseExteriors(f, this.doorOpenAmount);
      },
    });
    for (const cage of snap.cages) {
      scene.add({ band: "cageFront", x: cage.x, span: 110, label: "cage front", draw: (f) => drawCage(f.ctx, cage.x - f.cam, f.ground, true) });
    }
    scene.add({
      band: "weather", x: 0, span: 0, screen: true, label: "weather",
      draw: (f) => {
        const g = f.graphics;
        if (g.particles && !g.reducedMotion) drawLeaves(f, this.leaves, env.qualityCount(100, 55, 22));
        if (g.particles) drawFireflyLayer(f, env);
        if (g.fog) drawFog(f, env);
      },
    });
    scene.add({
      band: "foreground", x: 0, span: 0, screen: true,
      draw: (f) => { if (f.graphics.quality !== "low") drawForeground(f.ctx, f.cam, f.w, f.h, f.t); },
    });
    scene.add({
      band: "mask", x: 0, span: 0, screen: true, label: "mask + grade",
      draw: (f) => {
        const past = f.snap.time?.mode === "past";
        this.visionR = drawDarkness(f, this.visionR);
        if (past) drawPastWash(f);
        if (f.graphics.vignette) drawVignette(f, env);
        drawFlicker(f);
        if (f.graphics.quality !== "low") {
          if (this.grainTile === undefined) this.grainTile = makeGrainTile();
          drawGrade(f.ctx, f.w, f.h, f.night, f.graphics.quality === "high" && !f.graphics.reducedMotion ? this.grainTile : null, f.t);
        }
      },
    });
  }

  /** Door swing lives on the renderer (it is the only state the scene mutates). */
  private advanceDoors(f: Frame) {
    for (const b of BUILDINGS) {
      const door = f.doors.get(b.id);
      const target = door?.open ? 1 : 0;
      const previous = this.doorOpenAmount.get(b.id) ?? target;
      const amount = f.graphics.reducedMotion ? target : previous + (target - previous) * Math.min(1, f.dt * 10);
      this.doorOpenAmount.set(b.id, amount);
    }
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
    if (!artReady()) {
      // Blank frame while the SVG art loads, so no scene is drawn half-dressed.
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
      return;
    }
    const env = this.env;
    const graphics = env.settings.graphics;
    const focused = this.focusX !== null;
    const glassUp = focused || this.viewZoom > 1.05;
    const base = graphics.worldZoom * this.viewZoom;
    const zoom = Math.min(graphics.worldZoom * ZOOM_MAX, focused ? Math.max(base, ZOOM_READ) : base);
    ctx.save(); ctx.scale(zoom, zoom); w /= zoom; h /= zoom;
    let lift = 0;
    if (focused) {
      const fn = (snap.notes ?? []).find((n) => n.x === this.focusX);
      if (fn) lift = Math.max(0, (fn.kind === "wall" ? 165 : 121) - 0.28 * h);
      ctx.translate(0, lift);
    }
    if (graphics.reducedMotion) t = 0;

    this.cacheSnap(snap);
    const me = this.meCache;
    const meX = me ? displayX.get(me.id) ?? me.x : WORLD_W / 2;
    const lookX = focused ? this.focusX! : meX;
    this.cameraX = smoothCamera(this.cameraX, cameraTarget(lookX, w), dt, graphics.cameraSmoothing);
    const cam = this.cameraX;
    const ground = h * 0.78;
    const past = snap.time?.mode === "past";
    const night = past ? 0.05 : Math.min(1, Math.max(0, snap.nightT ?? 0.2));

    const frame: Frame = {
      ctx, w, h, t, dt, cam, ground, now: snap.now, night, nb: Math.round(night * 10) / 10, snap, displayX, meX,
      focused, focusX: this.focusX, glassUp, lift, graphics,
      tasks: this.tasksCache, doors: this.doorsCache, sorted: this.sortedCache,
    };

    // One generic pass. No object-specific branching: cull → order → draw.
    for (const node of this.scene.visible(cam - CULL_SLACK, w + CULL_SLACK * 2)) node.draw(frame);
    ctx.restore();
  }
}
