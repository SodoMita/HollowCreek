// Pixi (WebGL) renderer for Hollow Creek: pure drawing, no game rules.
//
// The scene is a retained display list built once — baked sky/hills/overlay
// textures, one sprite per structure, house, station and traveller — and each
// frame only updates transforms, alphas, visibility and the occasional texture
// swap on state change. Rules the scene follows:
//   - SVG art is rasterised to bitmaps once at load (svg-assets) and uploaded
//     as GPU textures; nothing parses SVG or builds paths per frame.
//   - Gradients, shadows and glows are baked into static layers/sprites.
//   - No per-frame full-canvas copies or pixel readbacks on the CPU; the GPU
//     composites the retained scene.
//   - No allocations in the frame loop: one View object, pooled rigs, numeric
//     cache keys.
//   - Off-screen groups are hidden (culled) before any child work.
//   - The DOM is never touched per frame; Pixi owns the one canvas.
import { Application, Container, Sprite } from "pixi.js";
import { WORLD_MAX, WORLD_MIN, type DoorState } from "../buildings";
import { createDefaultSettings, type GameSettings } from "../settings";
import { CAGE_XS, WORLD_W, type PublicPlayer, type Snapshot, type TaskView } from "../types";
import { ZOOM_MAX, ZOOM_READ } from "../units";
import { artReady, preloadArt, setArtScale } from "../svg-assets";
import { Actors, type Motion } from "./actors";
import { Fx, makeLeaves, type Leaf } from "./fx";
import { Statics } from "./statics";
import { syncDensity, whiteTexture } from "./textures";
import { clamp, type PinnedNote, type View } from "./view";

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
  private readonly canvasEl: HTMLCanvasElement;
  private app: Application | null = null;
  private appReady = false;
  private starting: Promise<void> | null = null;
  private leaves: Leaf[] = makeLeaves();
  private readonly motion = new Map<string, Motion>();
  private visionR = 420;
  private index: Index | null = null;
  private settings: GameSettings = createDefaultSettings();
  private view: View | null = null;
  private statics: Statics | null = null;
  private actors: Actors | null = null;
  private fx: Fx | null = null;
  private layers: {
    sky: Sprite; far: Container; hillsFar: Container; hillsNear: Container; trees: Container;
    world: Container; fog: Container; reeds: Container; dark: Container;
  } | null = null;
  private appliedW = 0;
  private appliedH = 0;
  private appliedRes = 0;
  private wantW = 0;
  private wantH = 0;

  /** Smoothed camera x in world units. */
  cameraX = 0;
  /** When set, the camera centres on this world x and zooms in to read a page. */
  focusX: number | null = null;
  /** A multiplier on the settings' world zoom (1 = lowered). */
  viewZoom = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvasEl = canvas;
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

  /** Records the desired CSS size; the Pixi surface follows on the next frame. */
  resize(w: number, h: number) {
    this.wantW = Math.max(1, Math.round(w));
    this.wantH = Math.max(1, Math.round(h));
  }

  private resolution(): number {
    const g = this.settings.graphics;
    const cap = g.quality === "high" ? 2 : g.quality === "medium" ? 1.5 : 1;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * g.resolution);
  }

  private startApp(): void {
    if (this.starting) return;
    const app = new Application();
    this.app = app;
    this.starting = app.init({
      canvas: this.canvasEl,
      width: this.wantW || 960,
      height: this.wantH || 540,
      resolution: this.resolution(),
      autoDensity: true,
      antialias: true,
      backgroundAlpha: 0,
      preference: "webgl",
      powerPreference: "high-performance",
    }).then(() => {
      this.buildScene(app);
      this.appReady = true;
    }).catch((err) => {
      // WebGL unavailable: stay blank rather than take the page down with us.
      console.warn("Hollow Creek: WebGL renderer unavailable", err);
    });
  }

  private buildScene(app: Application): void {
    const stage = app.stage;
    const sky = new Sprite();
    stage.addChild(sky);
    const far = new Container();
    const hillsFar = new Container();
    const hillsNear = new Container();
    const trees = new Container();
    const world = new Container();
    const group = () => {
      const c = new Container();
      world.addChild(c);
      return c;
    };
    const dressing = group();
    const interiors = group();
    const stations = group();
    const cart = group();
    const kits = group();
    const notes = group();
    const bell = group();
    const cageBacks = group();
    const keys = group();
    const bodiesIn = group();
    const playersIn = group();
    const exteriors = group();
    const bodiesOut = group();
    const playersCaged = group();
    const cageFronts = group();
    const playersOut = group();
    const fxWorld = group();
    stage.addChild(far, hillsFar, hillsNear, trees, world);
    const fog = new Container();
    const reeds = new Container();
    const dark = new Container();
    const past = new Sprite(whiteTexture());
    past.tint = 0x488597;
    past.alpha = 0.1;
    past.visible = false;
    const overlay = new Sprite();
    const flicker = new Sprite(whiteTexture());
    flicker.tint = 0x000000;
    flicker.visible = false;
    stage.addChild(fog, reeds, dark, past, overlay, flicker);
    this.layers = { sky, far, hillsFar, hillsNear, trees, world, fog, reeds, dark };
    this.statics = new Statics({
      sky, far, hillsFar, hillsNear, trees, dressing, interiors, stations, cart, kits,
      notes, bell, cageBacks, keys, exteriors, cageFronts,
    });
    this.actors = new Actors({ bodiesIn, playersIn, bodiesOut, playersCaged, playersOut });
    this.fx = new Fx({ world: fxWorld, fog, reeds, dark, past, overlay, flicker }, this.leaves);
  }

  render(
    w: number,
    h: number,
    snap: Snapshot,
    displayX: Map<string, number>,
    t: number, // seconds
    dt: number,
  ) {
    this.resize(w, h);
    if (!artReady()) return; // blank while the art loads, as before
    if (!this.app) {
      this.startApp();
      return;
    }
    if (!this.appReady || !this.statics || !this.actors || !this.fx || !this.layers) return;
    const app = this.app;
    const res = this.resolution();
    if (this.wantW !== this.appliedW || this.wantH !== this.appliedH || res !== this.appliedRes) {
      this.appliedW = this.wantW;
      this.appliedH = this.wantH;
      this.appliedRes = res;
      app.renderer.resize(this.wantW, this.wantH, res);
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
    setArtScale(res * zoom);
    syncDensity();

    const vw = w / zoom;
    const vh = h / zoom;
    // A page under the glass sits mid-screen: the whole view lifts by the page's height.
    let lift = 0;
    if (focused) {
      const page = (snap.notes ?? []).find((n) => n.x === this.focusX);
      if (page) lift = Math.max(0, (page.kind === "wall" ? 165 : 121) - 0.28 * vh);
    }
    const reduced = graphics.reducedMotion;
    const meX = ix.me ? displayX.get(ix.me.id) ?? ix.me.x : WORLD_W / 2;
    const lookX = focused ? this.focusX! : meX;
    const targetCam = clamp(lookX - vw / 2, WORLD_MIN, WORLD_MAX - vw);
    if (graphics.cameraSmoothing) this.cameraX += (targetCam - this.cameraX) * Math.min(1, dt * 6);
    else this.cameraX = targetCam;
    if (WORLD_MAX - WORLD_MIN < vw) this.cameraX = (WORLD_MIN + WORLD_MAX - vw) / 2;

    // Time travel to the past pins the sky to early dusk.
    const night = snap.time?.mode === "past" ? 0.05 : clamp(snap.nightT ?? 0.2, 0, 1);
    const cam = this.cameraX;
    if (!this.view) {
      this.view = {
        cssW: w, cssH: h, w: vw, h: vh, zoom, res, t: reduced ? 0 : t, dt, cam, now: snap.now,
        night, nb: Math.round(night * 10) / 10, snap, displayX, meX, focused, focusX: this.focusX,
        glassUp, lift, quality: graphics.quality, reduced, glow: graphics.glow, settings: this.settings,
        sorted: ix.sorted, tasks: ix.tasks, houseTask: ix.houseTask, doors: ix.doors,
        occupied: ix.occupied, notesByHouse: ix.notesByHouse,
      };
    } else {
      const v = this.view;
      v.cssW = w; v.cssH = h; v.w = vw; v.h = vh; v.zoom = zoom; v.res = res;
      v.t = reduced ? 0 : t; v.dt = dt; v.cam = cam; v.now = snap.now;
      v.night = night; v.nb = Math.round(night * 10) / 10; v.snap = snap; v.displayX = displayX;
      v.meX = meX; v.focused = focused; v.focusX = this.focusX; v.glassUp = glassUp; v.lift = lift;
      v.quality = graphics.quality; v.reduced = reduced; v.glow = graphics.glow; v.settings = this.settings;
      v.sorted = ix.sorted; v.tasks = ix.tasks; v.houseTask = ix.houseTask; v.doors = ix.doors;
      v.occupied = ix.occupied; v.notesByHouse = ix.notesByHouse;
    }
    const v = this.view;

    // Layer transforms: parallax factors match the canvas renderer's math.
    const groundCss = h * 0.78 + lift * zoom;
    const L = this.layers;
    L.far.scale.set(zoom, zoom);
    L.far.position.set(0, lift * zoom);
    L.hillsFar.scale.set(zoom, zoom);
    L.hillsFar.position.set(-cam * 0.09 * zoom, groundCss);
    L.hillsNear.scale.set(zoom, zoom);
    L.hillsNear.position.set(-cam * 0.15 * zoom, groundCss);
    L.trees.scale.set(zoom, zoom);
    L.trees.position.set(-cam * 0.45 * zoom, groundCss);
    L.world.scale.set(zoom, zoom);
    L.world.position.set(-cam * zoom, groundCss);
    L.fog.scale.set(zoom, zoom);
    L.fog.position.set(0, groundCss);
    L.reeds.scale.set(zoom, zoom);
    L.reeds.position.set(-((cam * 1.22) % 150) * zoom, h);

    this.statics.update(v);
    this.actors.update(v, this.motion);
    this.visionR = this.fx.update(v, this.visionR);
    app.render();
  }
}
