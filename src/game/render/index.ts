// Hollow Creek renderer — rewritten as a layered compositor.
//
// The old orchestrator re-issued the whole scene every frame: ~200 SVG blits,
// six shadow passes and four full-screen fills for content that changes only
// when the world does. This renderer splits the scene by *what can change*:
//
//   screen layers   sky → horizon     parallax/screen-space, drawn every frame
//   world tiles     props + interiors + stations + bridge, baked per 1024-unit
//                   world tile and blitted while their scene facts hold
//   actor layers    bodies, souls, caged souls, cages      drawn every frame
//   world tiles     house facades (door swing is part of the key)
//   effects         leaves, fireflies, fog, foreground, lantern darkness,
//                   past wash, vignette, flicker, grade   drawn every frame
//
// Camera maths, tile ranges and cache keys live in ./plan.ts (pure, tested);
// the LRU tile store lives in ./tiles.ts. This file only executes the plan, so
// it stays small enough to read in one sitting.
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
import {
  TILE_W, cameraTarget, drawOrder, flickerBucket, sceneFacts, smoothCamera, swingBucket, tileBudget, tileKey, tileRange, tileStart,
  type SceneFacts,
} from "./plan";
import { TileStore, type TileSurface, type TileStoreStats } from "./tiles";

export { ZOOM_MAX, ZOOM_READ };
/** World x of each cage, for the wider game code that needs cage positions. */
export const CAGE_POSITIONS = CAGE_XS;

interface CachedTile extends TileSurface { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

const makeTile = (width: number, height: number): CachedTile => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d")! };
};

export class Renderer {
  private readonly env = new DrawEnv();
  private readonly leaves: Leaf[] = makeLeaves();
  private readonly tiles = new TileStore<CachedTile>({
    maxTiles: 24,
    maxPixels: 96 * 1024 * 1024,
    create: makeTile,
  });

  // Per-snapshot caches: snapshots are rebuilt every poll, so these turn
  // per-frame finds, sorts and per-tile fact scans into one pass per snapshot.
  private cacheFor: Snapshot | null = null;
  private meCache: PublicPlayer | undefined;
  private sortedCache: PublicPlayer[] = [];
  private doorsCache = new Map<string, DoorState>();
  private tasksCache = new Map<string, TaskView>();
  private factsCache: SceneFacts = { occupied: "", stations: "", doors: "" };

  // Between-frame state.
  private grainTile: HTMLCanvasElement | null | undefined;
  private visionR = 420;
  private readonly doorOpenAmount = new Map<string, number>();
  private readonly motion = new Map<string, Motion>();
  private viewportKey = "";

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

  /** Tile-cache telemetry for the opt-in perf readout. */
  get tileStats(): TileStoreStats { return this.tiles.stats; }

  /** Frees baked tiles (settings or viewport change). */
  clearTileCache() { this.tiles.clear(); }

  private cacheSnap(snap: Snapshot) {
    if (this.cacheFor === snap) return;
    this.cacheFor = snap;
    this.meCache = snap.players.find((p) => p.id === snap.self.id);
    this.sortedCache = drawOrder(snap.players, snap.self.id);
    this.doorsCache = new Map((snap.doors ?? []).map((d) => [d.id, d]));
    this.tasksCache = new Map(snap.tasks.map((t) => [t.id, t]));
    this.factsCache = sceneFacts(snap, BUILDINGS);
  }

  /** Blits the baked tiles of one world layer into the current context. */
  private paintLayer(
    layer: "backdrop" | "facade",
    f: Frame,
    cam: number,
    width: number,
    night: number,
    scale: number,
    phase: number,
    paint: (tileFrame: Frame) => void,
  ) {
    const ctx = f.ctx;
    const quality = f.graphics.quality;
    const range = tileRange(cam, width);
    for (let index = range.first; index <= range.last; index++) {
      const from = tileStart(index);
      if (from >= WORLD_MAX || from + TILE_W <= WORLD_MIN) continue;
      const key = tileKey({ layer, index, h: f.h, night, quality, scale, facts: this.factsCache, phase });
      const tile = this.tiles.paint(key, TILE_W * scale, f.h * scale, (surface) => {
        const target = surface.ctx;
        target.setTransform(1, 0, 0, 1, 0, 0);
        target.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
        // World units → tile pixels: no translation, the paint pass is given cam = tile start.
        target.setTransform(scale, 0, 0, scale, 0, 0);
        paint({ ...f, ctx: target, cam: from, w: TILE_W });
      });
      ctx.drawImage(tile.canvas, from - cam, 0, TILE_W, f.h);
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
    // The device scale was applied by the caller's resize(); read it before we
    // multiply the world zoom on top, so baked tiles land on whole pixels.
    const deviceScale = ctx.getTransform().a || 1;
    const env = this.env;
    const graphics = env.settings.graphics;

    // Zoom the world, not the DOM HUD. Gameplay and server vision stay in world units.
    // A focused page (read-note zoom) overrides both zoom and camera target.
    const focused = this.focusX !== null;
    const glassUp = focused || this.viewZoom > 1.05; // HUD-like labels stay out of the zoomed view
    const base = graphics.worldZoom * this.viewZoom;
    const zoom = Math.min(graphics.worldZoom * ZOOM_MAX, focused ? Math.max(base, ZOOM_READ) : base);
    ctx.save(); ctx.scale(zoom, zoom); w /= zoom; h /= zoom;
    // Through the glass the page, not the road, should sit mid-screen: lift the
    // whole view so the paper is centred (wall pages hang higher than tree pages).
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
    const targetCam = cameraTarget(lookX, w);
    this.cameraX = smoothCamera(this.cameraX, targetCam, dt, graphics.cameraSmoothing);
    const cam = this.cameraX;
    const ground = h * 0.78;
    const now = snap.now;

    // Time travel to the past pins the sky to early dusk and warms the scene.
    const past = snap.time?.mode === "past";
    const night = past ? 0.05 : Math.min(1, Math.max(0, snap.nightT ?? 0.2));
    const nb = Math.round(night * 10) / 10; // bucket: keeps the gradient cache small

    const f: Frame = {
      ctx, w, h, t, dt, cam, ground, now, night, nb, snap, displayX, meX,
      focused, focusX: this.focusX, glassUp, lift, graphics,
      tasks: this.tasksCache, doors: this.doorsCache, sorted: this.sortedCache,
    };

    // Tiles are invalidated wholesale when the viewport shape or the bake scale
    // changes; their keys cannot be reused at a different size.
    const tileScale = Math.min(2, Math.max(0.5, deviceScale * zoom));
    const viewportKey = `${Math.round(w)}:${Math.round(h)}:${tileScale.toFixed(2)}:${graphics.quality}`;
    if (viewportKey !== this.viewportKey) {
      this.viewportKey = viewportKey;
      this.tiles.clear();
      this.tiles.updateLimits(tileBudget(w, h, tileScale));
    }

    // ---- screen layers: parallax and full-screen gradients -----------------
    drawSky(f, env);
    drawHorizon(f, env);
    drawGroundSurface(f, env);

    // ---- baked world: props, bridge, interiors, stations -------------------
    const bakeSnap: Snapshot = { ...snap, notes: [] }; // pages stay live for the spyglass
    const bakeFrame = { ...f, snap: bakeSnap, focused: false, focusX: null, lift: 0 };
    this.paintLayer("backdrop", bakeFrame, cam, w, night, tileScale, 0, (tileFrame) => {
      drawGroundProps(tileFrame);
      drawCreekBridge(tileFrame);
      drawHouseInteriors(tileFrame, env);
      drawStations(tileFrame, env);
    });

    // ---- live world overlay ------------------------------------------------
    drawCreekGlintLayer(f);
    drawMeetingSquare(f);
    drawCartAndKits(f);
    // Pages: street pages here, interior pages normally painted with their house.
    drawPinnedNotes(f, env);
    for (const note of snap.notes ?? []) {
      if (!note.house) continue;
      const sx = note.x - cam;
      if (sx < -100 || sx > w + 100) continue;
      drawNote(ctx, sx, ground, "wall", focused && this.focusX === note.x, t, note, env);
    }
    drawBellTower(ctx, BELL_X - cam, ground, t, now - snap.bellAt < 4000);
    for (const c of snap.cages) drawCage(ctx, c.x - cam, ground, false);
    drawKey(f, env);
    drawTimepieces(f, env);
    drawDoorKeys(f, env);

    // ---- souls inside, then the facade tiles that cut the houses away ------
    for (const b of snap.bodies) if (b.inside) drawBody(f, b);
    for (const p of f.sorted) if (p.inside && !p.caged) drawPlayer(f, env, this.motion, p);

    // Door swing is advanced here, once per frame, and is part of the tile key.
    let swingPhase = 0;
    for (const b of BUILDINGS) {
      const door = f.doors.get(b.id);
      const target = door?.open ? 1 : 0;
      const previous = this.doorOpenAmount.get(b.id) ?? target;
      const amount = graphics.reducedMotion ? target : previous + (target - previous) * Math.min(1, dt * 10);
      this.doorOpenAmount.set(b.id, amount);
      swingPhase += amount * (b.id.length % 5 + 1);
    }
    const facadePhase = swingBucket(swingPhase % 1) + flickerBucket(t) / 50;
    this.paintLayer("facade", { ...bakeFrame, dt: 0 }, cam, w, night, tileScale, facadePhase, (tileFrame) => {
      drawHouseExteriors(tileFrame, this.doorOpenAmount);
    });

    // ---- souls outside, cages, then the weather ----------------------------
    for (const b of snap.bodies) if (!b.inside) drawBody(f, b);
    for (const p of f.sorted) if (p.caged) drawPlayer(f, env, this.motion, p);
    // Only prisoners stand behind the fronts; pedestrians remain on the road.
    for (const c of snap.cages) drawCage(ctx, c.x - cam, ground, true);
    for (const p of f.sorted) if (!p.caged && !p.inside) drawPlayer(f, env, this.motion, p);

    if (graphics.particles && !graphics.reducedMotion) drawLeaves(f, this.leaves, env.qualityCount(100, 55, 22));
    if (graphics.particles) drawFireflyLayer(f, env);
    if (graphics.fog) drawFog(f, env);
    if (graphics.quality !== "low") drawForeground(ctx, cam, w, h, t);

    // lantern-light darkness mask (server-authoritative vision radius)
    this.visionR = drawDarkness(f, this.visionR);
    if (past) drawPastWash(f);
    if (graphics.vignette) drawVignette(f, env);
    drawFlicker(f);

    // cool shadows / warm lantern grade, with fine grain on high detail
    if (graphics.quality !== "low") {
      if (this.grainTile === undefined) this.grainTile = makeGrainTile();
      drawGrade(ctx, w, h, night, graphics.quality === "high" && !graphics.reducedMotion ? this.grainTile : null, t);
    }
    ctx.restore();
  }
}
