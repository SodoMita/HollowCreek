// Canvas renderer for Hollow Creek — pure drawing, no game logic.
//
// This module is the orchestrator. It owns the state that survives between
// frames (camera, glass zoom, lookup caches, figure motion, door swing, falling
// leaves, the vision radius) and calls one drawing function per subject, back to
// front. The subjects live beside it: sky, horizon, ground, houses, stations,
// landmarks, players and effects. Per-frame values travel in a Frame object.
//
// Public surface (used by GameClient, useGameRender, TutorialClient, static-src/main.ts):
// Renderer, ZOOM_MAX, ZOOM_READ, CAGE_POSITIONS.
import { CAGE_XS, BELL_X, WORLD_W, type PublicPlayer, type Snapshot, type TaskView } from "../types";
import { WORLD_MAX, WORLD_MIN, type DoorState } from "../buildings";
import type { GameSettings } from "../settings";
import { ZOOM_MAX, ZOOM_READ } from "../units";
import { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { drawSky } from "./sky";
import { drawHorizon } from "./horizon";
import { drawGround, drawCreek, drawMeetingSquare } from "./ground";
import { drawHouseExteriors, drawHouseInteriors } from "./houses";
import { drawStations, drawCartAndKits } from "./stations";
import { drawPinnedNotes } from "./note";
import { drawBellTower, drawCage, drawDoorKeys, drawKey, drawTimepieces } from "./landmarks";
import { drawBody, drawPlayer, type Motion } from "./player";
import { drawDarkness, drawFireflyLayer, drawFlicker, drawFog, drawLeaves, drawPastWash, drawVignette, makeLeaves, type Leaf } from "./effects";
import { drawForeground, drawGrade, makeGrainTile } from "../atmosphere";
import { artReady, preloadArt } from "../svg-assets";

export { ZOOM_MAX, ZOOM_READ };
/** World x of each cage, for the wider game code that needs cage positions. */
export const CAGE_POSITIONS = CAGE_XS;

export class Renderer {
  private readonly env = new DrawEnv();
  private leaves: Leaf[] = makeLeaves();
  // Per-snapshot lookup caches. Snapshots are rebuilt per poll, so these turn
  // 60 fps finds and sorts into one pass per 100 ms snapshot.
  private cacheFor: unknown = null;
  private meCache: PublicPlayer | undefined;
  private sortedCache: PublicPlayer[] = [];
  private doorsCache = new Map<string, DoorState>();
  private tasksCache = new Map<string, TaskView>();
  private grainTile: HTMLCanvasElement | null | undefined;
  private visionR = 420;
  private readonly doorOpenAmount = new Map<string, number>();
  /** Where each figure was drawn last frame (facing and gait follow what is shown). */
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

  setSettings(settings: GameSettings) {
    this.env.settings = settings;
  }

  setFocus(x: number | null) {
    this.focusX = x;
  }

  /** The spyglass / pinch zoom: clamped to [1, ZOOM_MAX]. */
  setViewZoom(z: number) {
    this.viewZoom = Math.max(1, Math.min(ZOOM_MAX, z));
  }

  private cacheSnap(snap: Snapshot) {
    if (this.cacheFor === snap) return;
    this.cacheFor = snap;
    this.meCache = snap.players.find((p) => p.id === snap.self.id);
    this.sortedCache = [...snap.players].sort((a, b) => (a.id === snap.self.id ? 1 : 0) - (b.id === snap.self.id ? 1 : 0));
    this.doorsCache = new Map((snap.doors ?? []).map((d) => [d.id, d]));
    this.tasksCache = new Map(snap.tasks.map((t) => [t.id, t]));
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
    const targetCam = Math.max(WORLD_MIN, Math.min(WORLD_MAX - w, lookX - w / 2));
    if (graphics.cameraSmoothing) this.cameraX += (targetCam - this.cameraX) * Math.min(1, dt * 6);
    else this.cameraX = targetCam;
    if (WORLD_MAX - WORLD_MIN < w) this.cameraX = (WORLD_MIN + WORLD_MAX - w) / 2;
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

    // --- back to front ---
    drawSky(f, env);
    drawHorizon(f, env);
    drawGround(f, env);
    drawCreek(f);
    drawMeetingSquare(f);
    drawHouseInteriors(f, env);
    drawStations(f, env);
    drawCartAndKits(f);
    drawPinnedNotes(f, env);
    drawBellTower(ctx, BELL_X - cam, ground, t, now - snap.bellAt < 4000);
    for (const c of snap.cages) drawCage(ctx, c.x - cam, ground, false);
    drawKey(f, env);
    drawTimepieces(f, env);
    drawDoorKeys(f, env);
    for (const b of snap.bodies) if (b.inside) drawBody(f, b);
    for (const p of f.sorted) if (p.inside && !p.caged) drawPlayer(f, env, this.motion, p);
    drawHouseExteriors(f, this.doorOpenAmount);
    for (const b of snap.bodies) if (!b.inside) drawBody(f, b);
    for (const p of f.sorted) if (p.caged) drawPlayer(f, env, this.motion, p);
    // Only prisoners stand behind the fronts; pedestrians remain on the road.
    for (const c of snap.cages) drawCage(ctx, c.x - cam, ground, true);
    for (const p of f.sorted) if (!p.caged && !p.inside) drawPlayer(f, env, this.motion, p);

    // --- falling leaves (quantity follows the detail preset), fireflies, fog ---
    if (graphics.particles && !graphics.reducedMotion) drawLeaves(f, this.leaves, env.qualityCount(100, 55, 22));
    if (graphics.particles) drawFireflyLayer(f, env);
    if (graphics.fog) drawFog(f, env);
    // near-field reeds sweep past faster than the road — parallax depth
    if (graphics.quality !== "low") drawForeground(ctx, cam, w, h, t);

    // lantern-light darkness mask (server-authoritative vision radius)
    this.visionR = drawDarkness(f, this.visionR);
    if (snap.time?.mode === "past") drawPastWash(f);
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
