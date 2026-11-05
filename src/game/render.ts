// Canvas renderer for Hollow Creek — pure drawing, no game logic.
import {
  BELL_X, CAGE_XS, MEETING_FROM, MEETING_TO, STATIONS, WORLD_W,
} from "./types";
import type { PublicPlayer, Snapshot, Station, TaskView } from "./types";
import { createDefaultSettings, type GameSettings } from "./settings";
import { drawBrokenWard, drawKit, drawSupplyCart } from "./ward-art";
import { BUILDINGS, TREE_MAX, TREE_MIN, treeX, WORLD_MIN, WORLD_MAX, type DoorState } from "./buildings";
import { drawHouseExterior, drawHouseInterior } from "./house-art";
import { drawSvg, drawTraveler } from "./svg-assets";
import { drawCreekGlints, drawFireflies, drawForeground, drawGrade, drawMoonRays, drawStreetDressing, makeGrainTile } from "./atmosphere";
import { CHAPEL_SCALE, NOTE_FAR, NOTE_NEAR, ZOOM_READ } from "./units";

interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }

// Tiny deterministic PRNG for effect recycling — avoids Math.random() in the frame loop.
let leafSeed = 1;
const nextRand = () => ((leafSeed = (Math.imul(leafSeed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

const LEAF_COLORS = ["#b4552a", "#c9762f", "#8f3b1f", "#d99a3d", "#7a4a21"];

// Dusk and deep-night sky palettes (top -> horizon); lerped by nightT.
const SKY_DUSK = ["#090b1b", "#211329", "#512534", "#9a4c2c", "#c0743c"];
const SKY_NIGHT = ["#030309", "#0b0817", "#141021", "#241423", "#3a2030"];
const GROUND_DUSK = ["#2b1a12", "#1d120c", "#0d0806"];
const GROUND_NIGHT = ["#17100b", "#100a07", "#070403"];

function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export class Renderer {
  private leaves: Leaf[] = [];
  // per-snapshot lookup caches — snap objects are rebuilt per poll, so these
  // turn 60fps finds/sorts into one pass per 100ms snapshot
  private cacheFor: unknown = null;
  private meCache: PublicPlayer | undefined;
  private sortedCache: PublicPlayer[] = [];
  private doorsCache = new Map<string, DoorState>();
  private tasksCache = new Map<string, TaskView>();
  private cacheSnap(snap: Snapshot) {
    if (this.cacheFor === snap) return;
    this.cacheFor = snap;
    this.meCache = snap.players.find((p) => p.id === snap.self.id);
    this.sortedCache = [...snap.players].sort((a, b) => (a.id === snap.self.id ? 1 : 0) - (b.id === snap.self.id ? 1 : 0));
    this.doorsCache = new Map((snap.doors ?? []).map((d) => [d.id, d]));
    this.tasksCache = new Map(snap.tasks.map((t) => [t.id, t]));
  }
  private grads = new Map<string, CanvasGradient>();
  private bubbleWrap = new Map<string, { lines: string[]; bw: number }>();

  /** Canvas gradients are immutable once built; cache them by the dims that define them. */
  /** LRU read: a hit is re-inserted so hot entries survive eviction. */
  private lruGet<V>(map: Map<string, V>, key: string): V | undefined {
    const v = map.get(key);
    if (v !== undefined) { map.delete(key); map.set(key, v); }
    return v;
  }
  /** LRU write: evicts only the oldest entry when at capacity. */
  private lruSet<V>(map: Map<string, V>, key: string, value: V, cap: number) {
    map.delete(key);
    while (map.size >= cap) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
    map.set(key, value);
  }

  private grad(key: string, make: () => CanvasGradient): CanvasGradient {
    let g = this.lruGet(this.grads, key);
    if (!g) {
      g = make();
      this.lruSet(this.grads, key, g, 256);
    }
    return g;
  }
  private settings: GameSettings = createDefaultSettings();
  private grainTile: HTMLCanvasElement | null | undefined;
  cameraX = 0;
  /** When set, the camera centers on this world x and zooms in to read a page. */
  focusX: number | null = null;
  setFocus(x: number | null) { this.focusX = x; }
  /** The spyglass: zoom in anywhere, centred on the traveller (no page needed). */
  zoomOnly = false;
  setZoomOnly(on: boolean) { this.zoomOnly = on; }
  private visionR = 420;
  private doorOpenAmount = new Map<string, number>();

  constructor() {
    for (let i = 0; i < 110; i++) {
      this.leaves.push({
        x: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
        y: Math.random() * 600,
        vx: -12 - Math.random() * 25,
        vy: 18 + Math.random() * 30,
        r: Math.random() * Math.PI * 2,
        c: LEAF_COLORS[i % LEAF_COLORS.length],
        s: 3 + Math.random() * 4,
      });
    }
  }

  setSettings(settings: GameSettings) {
    this.settings = settings;
  }

  private qualityCount(high: number, medium: number, low: number) {
    return this.settings.graphics.quality === "high" ? high : this.settings.graphics.quality === "medium" ? medium : low;
  }

  private glow(ctx: CanvasRenderingContext2D, blur: number) {
    ctx.shadowBlur = this.settings.graphics.glow ? blur : 0;
  }

  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    snap: Snapshot,
    displayX: Map<string, number>,
    t: number, // seconds
    dt: number
  ) {
    const graphics = this.settings.graphics;
    // Zoom the world, not the DOM HUD. Gameplay and server vision stay in world units.
    // A focused page (read-note zoom) overrides both zoom and camera target.
    const focused = this.focusX !== null;
    const zoom = (focused || this.zoomOnly) ? Math.max(graphics.worldZoom, ZOOM_READ) : graphics.worldZoom;
    ctx.save(); ctx.scale(zoom, zoom); w /= zoom; h /= zoom;
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

    // --- day-night sky: dusk palette lerps into deep night as the round goes on ---
    // (time travel to the past pins the sky to early dusk and warms the scene)
    const past = snap.time?.mode === "past";
    const night = past ? 0.05 : Math.min(1, Math.max(0, snap.nightT ?? 0.2));
    const nb = Math.round(night * 10) / 10; // bucket: keeps the gradient cache small
    const sky = this.grad(`sky:${ground}:${nb}`, () => {
      const g = ctx.createLinearGradient(0, 0, 0, ground);
      g.addColorStop(0, lerpHex(SKY_DUSK[0], SKY_NIGHT[0], night));
      g.addColorStop(0.38, lerpHex(SKY_DUSK[1], SKY_NIGHT[1], night));
      g.addColorStop(0.72, lerpHex(SKY_DUSK[2], SKY_NIGHT[2], night));
      g.addColorStop(0.9, lerpHex(SKY_DUSK[3], SKY_NIGHT[3], night));
      g.addColorStop(1, lerpHex(SKY_DUSK[4], SKY_NIGHT[4], night));
      return g;
    });
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, ground);

    // Deterministic stars: no shimmering random layout between frames.
    const starCount = this.qualityCount(95, 48, 18);
    ctx.save();
    for (let i = 0; i < starCount; i++) {
      const sx = ((i * 197.3 + 41) % (w + 160)) - 80 - (cam * 0.008) % 40;
      const sy = 18 + ((i * 83.7) % Math.max(60, ground * 0.52));
      const radius = 0.45 + (i % 7 === 0 ? 0.85 : 0.25);
      ctx.globalAlpha = (0.25 + (i % 5) * 0.1) * (0.3 + 0.7 * night);
      ctx.fillStyle = i % 9 === 0 ? "#ffd9a0" : "#d9d8ed";
      ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Moon with a broad atmospheric halo and crisp crater detail.
    const mx = w * 0.78 - cam * 0.03;
    const my = h * 0.18;
    ctx.save();
    if (graphics.glow) {
      const halo = ctx.createRadialGradient(mx, my, 32, mx, my, 145);
      halo.addColorStop(0, `rgba(244,222,181,${0.18 + 0.12 * night})`);
      halo.addColorStop(0.45, "rgba(222,191,170,.08)");
      halo.addColorStop(1, "rgba(222,191,170,0)");
      ctx.fillStyle = halo; ctx.fillRect(mx - 150, my - 150, 300, 300);
    }
    ctx.shadowColor = "rgba(240,225,190,0.8)";
    this.glow(ctx, 34);
    const moon = ctx.createRadialGradient(mx - 13, my - 15, 4, mx, my, 45);
    moon.addColorStop(0, "#fff4d8"); moon.addColorStop(0.7, "#e8ddc0"); moon.addColorStop(1, "#bcae98");
    ctx.fillStyle = moon;
    ctx.beginPath(); ctx.arc(mx, my, 42, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(128,119,112,0.25)";
    for (const [dx, dy, r] of [[-12, -8, 7], [10, 10, 5], [14, -14, 4], [-20, 16, 3]] as const) {
      ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    if (graphics.glow && graphics.quality !== "low") drawMoonRays(ctx, mx, my, t, night);

    // Long, slow cloud banks crossing the moon and horizon.
    if (graphics.quality !== "low") {
      ctx.save();
      ctx.fillStyle = "rgba(27,19,36,.22)";
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 410 + t * (3 + i)) % (w + 500)) - 250;
        const cy = 80 + i * 58;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 150, 17, -0.05, 0, Math.PI * 2);
        ctx.ellipse(cx + 95, cy + 5, 105, 12, 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // --- two layers of hills, then an irregular wooded horizon ---
    ctx.fillStyle = "#2a1828";
    ctx.beginPath(); ctx.moveTo(0, ground);
    for (let sx = 0; sx <= w + 20; sx += 20) {
      const wx = sx + cam * 0.09;
      ctx.lineTo(sx, ground - 135 - Math.sin(wx * 0.0021 + 1) * 48 - Math.sin(wx * 0.006) * 22);
    }
    ctx.lineTo(w, ground); ctx.fill();
    ctx.fillStyle = "#1b121d";
    ctx.beginPath(); ctx.moveTo(0, ground);
    for (let sx = 0; sx <= w + 20; sx += 20) {
      const wx = sx + cam * 0.15;
      ctx.lineTo(sx, ground - 82 - Math.sin(wx * 0.004) * 38 - Math.sin(wx * 0.0013 + 3) * 48);
    }
    ctx.lineTo(w, ground); ctx.fill();

    for (let i = 0; i < 92; i++) {
      const wx = WORLD_MIN + i * 155 + ((i * 97) % 60);
      const sx = wx - cam * 0.45;
      if (sx < -150 || sx > w + 150) continue;
      const th = 74 + ((i * 53) % 56);
      this.drawTree(ctx, sx, ground, th, i);
      // the fen and the ridge grow wild: doubled groves where the village ends
      if (wx < -2650 || wx > 7350) this.drawTree(ctx, sx + 62, ground, th * 0.82, i + 7);
    }

    // The horizon is wilderness: no backdrop village, only woods and props.
    // --- New England street dressing lives in atmosphere.ts (props only) ---
    drawStreetDressing(ctx, cam, w, ground);

    // --- ground ---
    const gg = this.grad(`ground:${ground}:${h}:${nb}`, () => {
      const g = ctx.createLinearGradient(0, ground, 0, h);
      g.addColorStop(0, lerpHex(GROUND_DUSK[0], GROUND_NIGHT[0], night));
      g.addColorStop(0.12, lerpHex(GROUND_DUSK[1], GROUND_NIGHT[1], night));
      g.addColorStop(1, lerpHex(GROUND_DUSK[2], GROUND_NIGHT[2], night));
      return g;
    });
    ctx.fillStyle = gg;
    ctx.fillRect(0, ground, w, h - ground);
    // Rutted road, scattered stones, leaf piles, and a broken fence rhythm.
    ctx.strokeStyle = "rgba(218,164,100,0.13)";
    ctx.lineWidth = 2;
    for (const offset of [19, 34]) {
      ctx.beginPath();
      for (let sx = 0; sx <= w; sx += 30) {
        const y = ground + offset + Math.sin((sx + cam) * 0.017) * 2;
        if (sx === 0) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
      }
      ctx.stroke();
    }
    for (let i = TREE_MIN; i <= TREE_MAX; i++) {
      const sx = treeX(i) - cam;
      if (sx < -60 || sx > w + 60) continue;
      ctx.fillStyle = "rgba(160,90,40,0.28)";
      ctx.beginPath(); ctx.ellipse(sx, ground + 8, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(205,129,55,.28)";
      for (let j = 0; j < 4; j++) {
        ctx.beginPath(); ctx.ellipse(sx - 18 + j * 11, ground + 4 + (j % 2) * 3, 5, 2, j * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (graphics.quality !== "low") {
      ctx.strokeStyle = "rgba(107,75,50,.55)"; ctx.lineWidth = 4;
      for (let i = 0; i < 34; i++) {
        const fx = WORLD_MIN + i * 320 - cam;
        if (fx < -80 || fx > w + 80) continue;
        const fy = ground + 48 + (i % 3) * 3;
        ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - 2, fy - 31); ctx.moveTo(fx + 74, fy); ctx.lineTo(fx + 72, fy - 28);
        ctx.moveTo(fx - 5, fy - 23); ctx.lineTo(fx + 78, fy - 17); ctx.moveTo(fx - 4, fy - 9); ctx.lineTo(fx + 77, fy - 5); ctx.stroke();
      }
      ctx.fillStyle = "rgba(93,103,111,.18)";
      for (let i = 0; i < 42; i++) {
        const sx = WORLD_MIN + i * 260 + 60 - cam;
        if (sx < 0 || sx > w) continue;
        ctx.beginPath(); ctx.ellipse(sx, ground + 27, 4 + i % 5, 2, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    { // Hollow Creek crosses the road's west end; drawn after the ground so the water
      // and plank bridge sit in the foreground, in front of the road surface
      const sx = -2660 - cam;
      if (sx > -300 && sx < w + 300) drawSvg(ctx, "props/creek-bridge.svg", sx, ground - 6, 260, 64);
      drawCreekGlints(ctx, cam, w, ground, t);
    }

    // meeting square highlight
    if (snap.phase === "meeting") {
      const a = 0.08 + Math.sin(t * 3) * 0.03;
      ctx.fillStyle = `rgba(255,200,100,${a})`;
      ctx.fillRect(MEETING_FROM - cam, ground - 200, MEETING_TO - MEETING_FROM, 200 + 40);
    }

    // House backdrops share the street's world coordinates. Occupied houses
    // become a cutaway only after their occupants have been painted.
    for (const b of BUILDINGS) {
      const sx = b.x - cam;
      if (sx < -b.width || sx > w + b.width) continue;
      const occupied = snap.players.some((p) => p.inside === b.id && p.alive);
      drawHouseInterior(ctx, b, sx, ground, t, [...this.tasksCache.values()].find((task) => task.inside === b.id), occupied);
      // Pages pinned on this house's interior wall (only visible to souls inside).
      for (const note of snap.notes ?? []) {
        if (note.house !== b.id) continue;
        const nx = note.x - cam;
        if (nx < -100 || nx > w + 100) continue;
        this.drawNote(ctx, nx, ground, "wall", this.focusX === note.x, t, note);
      }
    }

    // --- stations / buildings ---
    for (const st of STATIONS) {
      if (st.inside) continue; // house work is painted as part of its interior
      const sx = st.x - cam;
      if (sx > -280 && sx < w + 280) this.drawStation(ctx, st, sx, ground, t, now, snap);
    }
    const cartScreenX = snap.cartX - cam;
    if (cartScreenX > -90 && cartScreenX < w + 90) {
      drawSupplyCart(ctx, cartScreenX, ground);
      if (snap.cartPushers > 0) {
        ctx.save();
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#e9dfcf";
        ctx.fillText(`${snap.cartPushers} PUSHING`, cartScreenX, ground - 89);
        ctx.restore();
      }
    }
    for (const drop of snap.supplyDrops) {
      const sx = drop - cam;
      if (sx > -45 && sx < w + 45) drawKit(ctx, sx, ground);
    }

    // --- pinned pages on walls and tree trunks ---
    for (const note of snap.notes ?? []) {
      if (note.house) continue; // interior pages are drawn with their house
      const sx = note.x - cam;
      if (sx < -100 || sx > w + 100) continue;
      const big = focused && this.focusX === note.x;
      this.drawNote(ctx, sx, ground, note.kind, big, t, note);
    }

    // --- bell tower ---
    this.drawBellTower(ctx, BELL_X - cam, ground, t, now - snap.bellAt < 4000);

    // --- cages (back frame) ---
    for (const c of snap.cages) this.drawCage(ctx, c.x - cam, ground, false);

    // --- key ---
    if (snap.keyX !== null) {
      const kx = snap.keyX - cam;
      const bob = Math.sin(t * 3) * 4;
      ctx.save();
      ctx.shadowColor = "#ffd76a";
      this.glow(ctx, 16);
      ctx.strokeStyle = "#e8b93c";
      ctx.lineWidth = 3.5;
      if (!drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32)) {
        ctx.beginPath(); ctx.arc(kx, ground - 26 + bob, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(kx, ground - 20 + bob); ctx.lineTo(kx, ground - 6 + bob);
        ctx.moveTo(kx, ground - 10 + bob); ctx.lineTo(kx + 6, ground - 10 + bob);
        ctx.moveTo(kx, ground - 6 + bob); ctx.lineTo(kx + 5, ground - 6 + bob); ctx.stroke();
      }
      ctx.restore();
    }

    // Timepieces are collectibles; several can rest on the road at once.
    const pieceXs = Array.isArray(snap.timepieces) && snap.timepieces.length ? snap.timepieces
      : (typeof snap.timepieceX === "number" ? [snap.timepieceX] : []);
    for (const px of pieceXs) {
      const tx = px - cam, bob = Math.sin(t * 2.4 + px) * 3;
      if (tx > -50 && tx < w + 50) {
        ctx.save(); ctx.shadowColor = "#9cdad3"; this.glow(ctx, 20);
        if (!drawSvg(ctx, "props/timepiece.svg", tx - 18, ground - 48 + bob, 36, 48)) {
          ctx.fillStyle = "#a8d2cf"; ctx.beginPath(); ctx.arc(tx, ground - 24 + bob, 12, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#ebc988"; ctx.lineWidth = 3; ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Each house has its own identifiable key, separate from the cage key.
    for (const d of snap.doors ?? []) {
      if (d.keyX === null) continue;
      const kx = d.keyX - cam;
      if (kx < -30 || kx > w + 30) continue;
      ctx.save(); ctx.strokeStyle = "#dfad55"; ctx.lineWidth = 3;
      ctx.shadowColor = "#ffd578"; this.glow(ctx, 12);
      const bob = Math.sin(t * 3) * 3;
      if (!drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32)) {
        ctx.beginPath(); ctx.arc(kx, ground - 25 + bob, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(kx, ground - 20 + bob); ctx.lineTo(kx, ground - 7 + bob);
        ctx.lineTo(kx + 5, ground - 7 + bob); ctx.moveTo(kx, ground - 12 + bob); ctx.lineTo(kx + 5, ground - 12 + bob); ctx.stroke();
      }
      ctx.restore();
    }

    // --- bodies (crows gather above the dead) ---
    const drawBody = (b: Snapshot["bodies"][number]) => {
      const bx = b.x - cam;
      const age = b.at ? now - b.at : 9999;
      if (age >= 0 && age < 950 && !graphics.reducedMotion) {
        const progress = age / 950;
        ctx.save();
        ctx.globalAlpha = (1 - progress) * 0.7;
        const flash = ctx.createRadialGradient(bx, ground - 45, 3, bx, ground - 45, 70 + progress * 80);
        flash.addColorStop(0, "rgba(220,40,28,.9)"); flash.addColorStop(1, "rgba(110,0,0,0)");
        ctx.fillStyle = flash; ctx.fillRect(bx - 160, ground - 200, 320, 220);
        if (progress < 0.55) {
          ctx.strokeStyle = "#f1b1a0"; ctx.lineWidth = 4 * (1 - progress);
          for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.moveTo(bx - 35 + i * 12, ground - 105);
            ctx.quadraticCurveTo(bx + 8 + i * 12, ground - 65, bx + 35 + i * 12, ground - 25); ctx.stroke();
          }
        }
        ctx.restore();
      }
      ctx.fillStyle = "rgba(90,10,10,0.7)";
      ctx.beginPath(); ctx.ellipse(bx, ground - 2, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(bx, ground - 10);
      ctx.rotate(Math.PI / 2);
      this.drawFigure(ctx, 0, 0, b.color, 1, false, false, false, t, 1);
      ctx.restore();
      // circling crows
      ctx.strokeStyle = "#0a0608";
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const a = t * (0.9 + i * 0.2) + i * 2.1;
        const cx2 = bx + Math.cos(a) * (34 + i * 14);
        const cy2 = ground - 120 - i * 16 + Math.sin(a * 1.7) * 10;
        const flap = Math.sin(t * 9 + i * 2) * 4;
        ctx.beginPath();
        ctx.moveTo(cx2 - 7, cy2 - flap);
        ctx.quadraticCurveTo(cx2, cy2 + 3, cx2 + 7, cy2 - flap);
        ctx.stroke();
      }
    };
    for (const b of snap.bodies) if (b.inside) drawBody(b);

    // --- players ---
    const sorted = this.sortedCache;
    const drawPlayer = (p: Snapshot["players"][number]) => {
      const px = (displayX.get(p.id) ?? p.x) - cam;
      if (px < -100 || px > w + 100) return;
      const ghost = !p.alive;
      if (ghost && snap.self.alive) return; // living can't see ghosts
      const isMate = snap.self.teammates.includes(p.id);
      const floatY = ghost ? -14 + Math.sin(t * 2 + p.x) * 5 : 0;
      ctx.save();
      if (ghost) ctx.globalAlpha = 0.45;
      else if (p.echo) ctx.globalAlpha = 0.52;
      if (!ghost) {
        ctx.fillStyle = "rgba(0,0,0,.35)";
        ctx.beginPath(); ctx.ellipse(px, ground + 2, 17, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
      this.drawFigure(ctx, px, ground + floatY, p.color, p.facing, p.moving, ghost, isMate || (p.id === snap.self.id && snap.self.role === "hollow"), t, 1);
      ctx.restore();
      // A kit stays visible on its carrier until someone delivers it.
      if (p.hasSupply) drawKit(ctx, px - 23, ground - 16 + floatY);
      // key icon
      if (p.hasKey || (p.doorKeys?.length ?? 0) > 0) {
        ctx.fillStyle = "#e8b93c";
        ctx.font = "12px serif";
        ctx.textAlign = "center";
        ctx.fillText("🗝", px + 16, ground - 52 + floatY);
      }
      if (p.hasTimepiece) {
        ctx.save(); ctx.shadowColor = "#9cdad3"; this.glow(ctx, 8);
        if (!drawSvg(ctx, "props/timepiece.svg", px + 12, ground - 62 + floatY, 15, 20)) {
          ctx.fillStyle = "#a8d2cf"; ctx.beginPath(); ctx.arc(px + 19, ground - 52 + floatY, 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      // name and speech are optional HUD layers; the figures remain identifiable by color.
      if (this.settings.interface.playerNames) {
        ctx.font = "600 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        const label = p.name + (p.echo ? " · echo" : snap.phase === "meeting" && p.voted ? " ✓" : "");
        const width = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(5,3,8,.55)";
        ctx.beginPath(); ctx.roundRect(px - width / 2 - 5, ground - 75 + floatY, width + 10, 17, 5); ctx.fill();
        ctx.fillStyle = p.id === snap.self.id ? "#ffd98a" : p.echo ? "#b9d9d5" : isMate ? "#ff7a6a" : "rgba(245,235,220,.96)";
        ctx.fillText(label, px, ground - 62 + floatY);
      }
      if (p.action && p.action.until > now) {
        ctx.save(); ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center";
        const label = p.action.text, width = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(20,27,29,.9)"; ctx.beginPath(); ctx.roundRect(px - width / 2 - 6, ground - 98 + floatY, width + 12, 16, 5); ctx.fill();
        ctx.fillStyle = p.echo ? "#bde6dc" : "#f2d1a2"; ctx.fillText(label, px, ground - 87 + floatY); ctx.restore();
      }
      if (p.bubble && this.settings.interface.speechBubbles) this.drawBubble(ctx, px, ground - (p.action ? 100 : 72) + floatY, p.bubble.text, Math.min(1, (p.bubble.until - now) / 800));
    };

    for (const p of sorted) if (p.inside && !p.caged) drawPlayer(p);
    for (const b of BUILDINGS) {
      const sx = b.x - cam;
      const occupied = snap.players.some((p) => p.inside === b.id && p.alive);
      if (sx > -b.width && sx < w + b.width) {
        const door = this.doorsCache.get(b.id);
        const target = door?.open ? 1 : 0;
        const previous = this.doorOpenAmount.get(b.id) ?? target;
        const amount = graphics.reducedMotion ? target : previous + (target - previous) * Math.min(1, dt * 10);
        this.doorOpenAmount.set(b.id, amount);
        drawSvg(ctx, "furniture/barrel.svg", sx - b.width / 2 - 30, ground - 34, 26, 34);
        drawSvg(ctx, "furniture/crate.svg", sx + b.width / 2 + 8, ground - 26, 30, 26);
        drawHouseExterior(ctx, b, sx, ground, t, door, occupied, amount);
      }
    }
    for (const b of snap.bodies) if (!b.inside) drawBody(b);
    for (const p of sorted) if (p.caged) drawPlayer(p);
    // Only prisoners stand behind the fronts; pedestrians remain on the road.
    for (const c of snap.cages) this.drawCage(ctx, c.x - cam, ground, true);
    for (const p of sorted) if (!p.caged && !p.inside) drawPlayer(p);

    // --- falling leaves (quantity follows the detail preset) ---
    if (graphics.particles) {
      const count = this.qualityCount(100, 55, 22);
      for (let li = 0; li < count && li < this.leaves.length; li++) {
        const l = this.leaves[li];
        if (!graphics.reducedMotion) { l.x += l.vx * dt; l.y += l.vy * dt; l.r += dt * 2; }
        if (l.y > ground + 10) { l.y = -20; l.x = cam + nextRand() * w; } // deterministic recycle, no per-frame Math.random()
        if (l.x < cam - 60) l.x = cam + w + 40;
        const sx = l.x - cam;
        if (sx < -20 || sx > w + 20) continue;
        ctx.save();
        ctx.translate(sx, l.y * (h / 700));
        ctx.rotate(l.r);
        ctx.fillStyle = l.c;
        ctx.globalAlpha = 0.72;
        ctx.beginPath(); ctx.ellipse(0, 0, l.s, l.s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(40,18,10,.45)"; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-l.s, 0); ctx.lineTo(l.s, 0); ctx.stroke();
        ctx.restore();
      }
    }

    // --- fireflies at dusk, then the low, layered fog ---
    if (graphics.particles) drawFireflies(ctx, cam, w, ground, t, night, this.qualityCount(18, 12, 6), treeX);
    if (graphics.fog) {
      const layers = this.qualityCount(4, 3, 1);
      for (let i = 0; i < layers; i++) {
        const fy = ground - 24 - i * 25;
        const drift = Math.sin(t * 0.24 + i * 2) * 70;
        const fog = this.grad(`fog:${ground}:${i}`, () => {
          const g = ctx.createLinearGradient(0, fy - 25, 0, fy + 25);
          g.addColorStop(0, "rgba(120,110,130,0)");
          g.addColorStop(0.5, `rgba(145,132,151,${0.075 + i * 0.018})`);
          g.addColorStop(1, "rgba(120,110,130,0)");
          return g;
        });
        ctx.fillStyle = fog;
        ctx.fillRect(drift - 90, fy - 25, w + 180, 50);
      }
    }

    // near-field reeds sweep past faster than the road — parallax depth
    if (graphics.quality !== "low") drawForeground(ctx, cam, w, h, t);

    // --- lantern-light darkness mask (server-authoritative vision radius) ---
    const targetR = snap.visionRadius;
    if (targetR < 1500) {
      this.visionR += (targetR - this.visionR) * Math.min(1, dt * 3.5);
      const r = Math.max(80, this.visionR + Math.sin(t * 7.3) * 6); // lantern breathing
      const cx2 = meX - cam;
      const cy2 = ground - 50;
      const dark = ctx.createRadialGradient(cx2, cy2, r * 0.45, cx2, cy2, r);
      dark.addColorStop(0, "rgba(4,2,8,0)");
      dark.addColorStop(0.55, "rgba(4,2,8,0.3)");
      dark.addColorStop(0.78, "rgba(4,2,8,0.6)");
      dark.addColorStop(1, "rgba(3,1,6,0.965)");
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, w, h);
      // the lantern you carry is warm; the dark beyond it is cold
      const warm = ctx.createRadialGradient(cx2, cy2, 6, cx2, cy2, r * 0.7);
      warm.addColorStop(0, "rgba(255,178,92,0.07)");
      warm.addColorStop(1, "rgba(255,178,92,0)");
      ctx.fillStyle = warm;
      ctx.fillRect(cx2 - r, cy2 - r, r * 2, r * 2);
    } else {
      this.visionR = 420;
    }

    // A restrained blue wash makes the recorded past distinct from the present.
    if (snap.time?.mode === "past") {
      ctx.fillStyle = "rgba(72,133,151,.10)"; ctx.fillRect(0, 0, w, h);
    }

    // --- vignette ---
    if (graphics.vignette) {
      const vg = this.grad(`vg:${w}:${h}:${nb}`, () => {
        const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(4,2,7,${0.6 + 0.25 * night})`); // deep night closes in harder
        return g;
      });
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    // --- horror flicker (decorative only; never changes authoritative vision) ---
    const since = now - snap.flickerAt;
    if (graphics.flicker && !graphics.reducedMotion && since >= 0 && since < 900) {
      const a = Math.random() < 0.5 ? 0.55 : 0.15;
      ctx.fillStyle = `rgba(0,0,0,${a * (1 - since / 900)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // cool shadows / warm lantern grade, with fine grain on high detail
    if (graphics.quality !== "low") {
      if (this.grainTile === undefined) this.grainTile = makeGrainTile();
      drawGrade(ctx, w, h, night, graphics.quality === "high" && !graphics.reducedMotion ? this.grainTile : null, t);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  /** A handwritten page pinned to a wall face or leaning on a trunk.
   *  Up close the real words are legible on the paper itself — no pop-out. */
  private drawNote(ctx: CanvasRenderingContext2D, x: number, ground: number, kind: "wall" | "tree", big: boolean, t: number, note?: { author: string; text: string }) {
    const { w, h } = big ? NOTE_NEAR : NOTE_FAR;
    const y = kind === "wall" ? ground - 118 - h : ground - 74 - h;
    const sway = Math.sin(t * 1.7 + x * 0.05) * (big ? 1.2 : 1.1);
    ctx.save();
    ctx.translate(x, y + h);
    ctx.rotate((kind === "tree" ? 0.10 : -0.05) + sway * 0.012);
    ctx.translate(-w / 2, -h);
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = big ? 14 : 6; ctx.shadowOffsetY = big ? 5 : 2;
    ctx.fillStyle = big ? "#f4ead2" : "#e9dfc4";
    ctx.strokeStyle = "#8a6f4d"; ctx.lineWidth = big ? 1.6 : 1;
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // folded corner
    ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(w, h * 0.2); ctx.lineTo(w - w * 0.2, 0); ctx.closePath();
    ctx.fillStyle = "#d8c9a8"; ctx.fill(); ctx.stroke();
    if (big && note?.text) {
      ctx.fillStyle = "#43301f";
      ctx.font = "italic 6.5px Georgia, serif";
      ctx.textAlign = "left";
      const lines = this.wrapNote(ctx, note.text, w - 14);
      lines.forEach((line, i) => ctx.fillText(line, 7, 15 + i * 8));
      ctx.font = "italic 5.5px Georgia, serif";
      ctx.fillStyle = "#6e5638";
      ctx.textAlign = "right";
      ctx.fillText(`— ${note.author}`, w - 7, h - 6, w - 14);
    } else {
      // far away the hand is only a scribble
      ctx.strokeStyle = "#7a6a52"; ctx.lineWidth = big ? 1.4 : 1;
      const lines = big ? 8 : 3;
      for (let i = 1; i <= lines; i++) {
        const ly = (h / (lines + 1)) * i;
        ctx.beginPath(); ctx.moveTo(w * 0.16, ly); ctx.lineTo(w * (0.84 - (i % 3) * 0.08), ly); ctx.stroke();
      }
    }
    ctx.restore();
  }

  private noteWrap = new Map<string, string[]>();
  private wrapNote(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    const hit = this.lruGet(this.noteWrap, text);
    if (hit) return hit;
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > width && line) {
        lines.push(line); line = word;
        if (lines.length === 10) break;
      } else line = test;
    }
    if (lines.length < 10 && line) lines.push(line);
    if (lines.length === 10 && ctx.measureText(lines[9] + "…").width > width) lines[9] = lines[9].slice(0, -1);
    if (lines.length === 10) lines[9] += "…";
    this.lruSet(this.noteWrap, text, lines, 64);
    return lines;
  }

  private drawTree(ctx: CanvasRenderingContext2D, x: number, ground: number, height: number, seed: number) {
    ctx.save(); ctx.translate(x, ground); ctx.scale(seed % 2 ? -1 : 1, 1);
    const drawn = drawSvg(ctx, "scenery/autumn-tree.svg", -height * 0.375, -height, height * 0.75, height);
    ctx.restore();
    if (drawn) return;
    const top = ground - height;
    ctx.save();
    ctx.strokeStyle = seed % 2 ? "#241718" : "#2c1918";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, ground); ctx.lineTo(x + (seed % 3 - 1) * 3, top + 18);
    ctx.moveTo(x, top + 45); ctx.lineTo(x - 19, top + 23);
    ctx.moveTo(x + 1, top + 35); ctx.lineTo(x + 23, top + 10);
    if (seed % 4 === 0) { ctx.moveTo(x - 8, top + 35); ctx.lineTo(x - 30, top + 39); }
    ctx.stroke();
    const palettes = [
      ["#3a1d1b", "#56251d", "#74321f"],
      ["#3a2118", "#5c301b", "#85411f"],
      ["#291a1b", "#43231d", "#613020"],
    ];
    const palette = palettes[seed % palettes.length];
    const clusters = this.qualityCount(8, 6, 4);
    for (let j = 0; j < clusters; j++) {
      const angle = j * 2.4 + seed;
      const cx = x + Math.sin(angle) * (15 + (j % 3) * 6);
      const cy = top + 9 + Math.cos(angle * 1.3) * 15 + j * 2.2;
      const radius = 17 + ((seed * 13 + j * 7) % 13);
      ctx.fillStyle = palette[j % palette.length];
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
    }
    if (this.settings.graphics.quality === "high") {
      ctx.fillStyle = "rgba(207,105,43,.22)";
      for (let j = 0; j < 7; j++) {
        const lx = x - 28 + ((seed * 31 + j * 17) % 58);
        const ly = top - 9 + ((seed * 19 + j * 23) % 50);
        ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawFigure(
    ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
    facing: number, moving: boolean, ghost: boolean, redEyes: boolean, t: number, scale: number
  ) {
    const gait = Math.sin(t * 11 + x * 0.1);
    const bob = moving ? gait * 1.8 : Math.sin(t * 1.7 + x) * 0.35;
    const y = groundY + bob;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing * scale, scale);
    const pose = moving ? (gait > 0.25 ? 1 : gait < -0.25 ? -1 : 0) : 0;
    if (drawTraveler(ctx, color, redEyes, ghost, pose)) { ctx.restore(); return; }
    ctx.lineCap = "round";

    if (!ghost) {
      const swing = moving ? gait * 5 : 0;
      ctx.strokeStyle = "#100d13"; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-4, -14); ctx.lineTo(-4 + swing, -1); ctx.lineTo(-1 + swing, 0);
      ctx.moveTo(4, -14); ctx.lineTo(4 - swing, -1); ctx.lineTo(7 - swing, 0);
      ctx.stroke();
    }

    // Rear sleeve and arm make the walking direction legible at small sizes.
    ctx.strokeStyle = color; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-6, -33); ctx.lineTo(-12 - (moving ? gait * 3 : 0), -18); ctx.stroke();

    // Cloak silhouette, hem, and a shaded fold down the trailing side.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-12, -12);
    ctx.quadraticCurveTo(-15, -32, -8, -41);
    ctx.quadraticCurveTo(0, -49, 9, -41);
    ctx.quadraticCurveTo(15, -30, 12, -12);
    if (ghost) { ctx.lineTo(8, -5); ctx.lineTo(3, -12); ctx.lineTo(-2, -5); ctx.lineTo(-7, -12); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(5,3,9,.3)";
    ctx.beginPath();
    ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-15, -32, -8, -41);
    ctx.quadraticCurveTo(-4, -34, -5, -12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,235,210,.13)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(5, -28); ctx.quadraticCurveTo(8, -20, 7, -12); ctx.stroke();

    // Front sleeve and a small metal clasp break up the single-color body.
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(7, -33); ctx.lineTo(13 + (moving ? gait * 3 : 0), -20); ctx.stroke();
    ctx.fillStyle = "#c5a56a"; ctx.beginPath(); ctx.arc(3, -29, 1.4, 0, Math.PI * 2); ctx.fill();

    // Raised hood rim around a genuinely dark face opening.
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(2, -38, 11, 10, -0.1, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(240,215,190,.16)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(3, -37, 8.5, 7.5, -0.1, Math.PI * 0.75, Math.PI * 2.15); ctx.stroke();
    ctx.fillStyle = "#09070d";
    ctx.beginPath(); ctx.ellipse(4, -36.5, 7.2, 6.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = redEyes ? "#ff5142" : "#eee6ce";
    ctx.shadowColor = redEyes ? "#ff4a3a" : "#e8e0c8";
    this.glow(ctx, 5);
    ctx.beginPath(); ctx.arc(3, -37, 1.5, 0, Math.PI * 2); ctx.arc(8, -37, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private drawBubble(ctx: CanvasRenderingContext2D, x: number, topY: number, text: string, alpha: number) {
    ctx.save();
    ctx.globalAlpha = Math.max(0.15, alpha);
    ctx.font = "12px system-ui, sans-serif";
    if (!text) { ctx.restore(); return; } // empty bubble: keep save/restore balanced
    let wrapped = this.lruGet(this.bubbleWrap, text);
    if (!wrapped) {
      const words = text.split(" ");
      const lines: string[] = [];
      let line = "";
      let truncated = false;
      for (const wd of words) {
        const test = line ? line + " " + wd : wd;
        if (ctx.measureText(test).width > 150 && line) { lines.push(line); line = wd; }
        else line = test;
        if (lines.length >= 4) { truncated = true; break; } // keep wrapping visible, mark with ellipsis below
      }
      if (line && lines.length < 4) lines.push(line);
      else if (line) truncated = true;
      if (truncated && lines.length > 0) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + "…";
      const bw = (lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0) + 16;
      wrapped = { lines, bw };
      this.lruSet(this.bubbleWrap, text, wrapped, 512);
    }
    const { lines, bw } = wrapped;
    const bh = lines.length * 15 + 10;
    const bx = x - bw / 2, by = topY - bh;
    ctx.fillStyle = "rgba(245,240,228,0.95)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.moveTo(x - 5, by + bh); ctx.lineTo(x + 5, by + bh); ctx.lineTo(x, by + bh + 7);
    ctx.fill();
    ctx.fillStyle = "#241a14";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, x, by + 17 + i * 15));
    ctx.restore();
  }

  private drawCage(ctx: CanvasRenderingContext2D, x: number, ground: number, front: boolean) {
    const wHalf = 32, top = ground - 96;
    ctx.save();
    if (!front) {
      ctx.fillStyle = "rgba(15,10,14,0.6)";
      ctx.fillRect(x - wHalf, top, wHalf * 2, 96);
      ctx.strokeStyle = "#2e2a33";
      ctx.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * 12, top + 4); ctx.lineTo(x + i * 12, ground); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "#4a4552";
      ctx.lineWidth = 3.5;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(x + i * 12 + 5, top + 2); ctx.lineTo(x + i * 12 + 5, ground); ctx.stroke();
      }
      ctx.strokeStyle = "#57515f";
      ctx.lineWidth = 5;
      ctx.strokeRect(x - wHalf, top, wHalf * 2, 96);
      ctx.beginPath(); ctx.moveTo(x - wHalf, top + 30); ctx.lineTo(x + wHalf, top + 30); ctx.stroke();
      // hanging chain
      ctx.strokeStyle = "#3a3542";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top - 16); ctx.stroke();
    }
    ctx.restore();
  }

  private drawBellTower(ctx: CanvasRenderingContext2D, x: number, ground: number, t: number, ringing: boolean) {
    ctx.save();
    ctx.strokeStyle = "#241611";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(x - 42, ground); ctx.lineTo(x - 14, ground - 150);
    ctx.moveTo(x + 42, ground); ctx.lineTo(x + 14, ground - 150);
    ctx.stroke();
    ctx.fillStyle = "#1c100c";
    ctx.beginPath();
    ctx.moveTo(x - 30, ground - 148); ctx.lineTo(x + 30, ground - 148); ctx.lineTo(x, ground - 178);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 24, ground - 152, 48, 7);
    // bell
    const swing = ringing ? Math.sin(t * 9) * 0.5 : Math.sin(t * 0.8) * 0.04;
    ctx.translate(x, ground - 143);
    ctx.rotate(swing);
    ctx.fillStyle = "#8a6b2a";
    ctx.beginPath();
    ctx.moveTo(-13, 22);
    ctx.quadraticCurveTo(-13, -2, 0, -4);
    ctx.quadraticCurveTo(13, -2, 13, 22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#6b5220";
    ctx.fillRect(-15, 20, 30, 5);
    ctx.beginPath(); ctx.arc(0, 28, 3.4, 0, Math.PI * 2); ctx.fill();
    if (ringing) {
      ctx.strokeStyle = "rgba(255,215,130,0.5)";
      ctx.lineWidth = 2;
      for (const r of [26, 38]) { ctx.beginPath(); ctx.arc(0, 12, r, -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 12, r, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke(); }
    }
    ctx.restore();
    // rope
    ctx.strokeStyle = "#5a4a30";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, ground - 120); ctx.lineTo(x + 6 + (ringing ? Math.sin(t * 9) * 6 : 0), ground - 30); ctx.stroke();
  }

  private drawStation(
    ctx: CanvasRenderingContext2D, st: Station, x: number, ground: number,
    t: number, now: number, snap: Snapshot
  ) {
    const blackout = now < snap.blackoutUntil;
    // lanterns and lit windows burn brighter as the night deepens
    const night = snap.time?.mode === "past" ? 0.05 : Math.min(1, Math.max(0, snap.nightT ?? 0.2));
    const task = this.tasksCache.get(st.id);
    const broken = snap.phase === "lobby" || (!!task && !task.done);
    const supplied = !!task?.delivered;
    const flick = this.settings.graphics.flicker && !this.settings.graphics.reducedMotion && now - snap.flickerAt < 900 ? Math.random() * 0.6 : 0;
    const win = (wx: number, wy: number, ww: number, wh: number) => {
      const a = blackout || broken ? 0.02 : Math.max(0.05, (0.75 - flick) * (0.45 + 0.55 * night));
      ctx.save();
      ctx.shadowColor = "rgba(255,151,55,.75)"; this.glow(ctx, broken || blackout ? 0 : Math.round(5 + 10 * night));
      const glass = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      glass.addColorStop(0, `rgba(255,210,120,${a})`);
      glass.addColorStop(1, `rgba(210,91,35,${a * 0.82})`);
      ctx.fillStyle = glass;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(31,17,15,.9)"; ctx.lineWidth = 2;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
      ctx.restore();
    };
    ctx.save();
    ctx.translate(x, ground);
    ctx.fillStyle = "#1e1310";
    switch (st.kind) {
      case "pumpkins": {
        ctx.fillStyle = "#241511";
        ctx.fillRect(-70, -70, 140, 70); // shed
        if (!broken) {
          ctx.beginPath(); ctx.moveTo(-80, -70); ctx.lineTo(0, -105); ctx.lineTo(80, -70); ctx.closePath(); ctx.fill();
        }
        win(-20, -50, 18, 20);
        for (const [px, pr] of (broken ? [] : [[-45, 12], [-20, 15], [8, 11], [34, 14], [55, 10]]) as readonly (readonly [number, number])[]) {
          ctx.fillStyle = "#b05a1a";
          ctx.beginPath(); ctx.ellipse(px, -pr * 0.7, pr, pr * 0.8, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#7a3c10"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, -pr * 1.5); ctx.lineTo(px, 0); ctx.stroke();
          ctx.fillStyle = "#3a5a20"; ctx.fillRect(px - 2, -pr * 1.7, 4, 6);
        }
        break;
      }
      case "well": {
        ctx.fillStyle = "#3a3230";
        ctx.fillRect(-26, -30, 52, 30);
        ctx.fillStyle = "#241511";
        ctx.fillRect(-30, -78, 6, 50); ctx.fillRect(24, -78, 6, 50);
        if (!broken) { ctx.beginPath(); ctx.moveTo(-38, -76); ctx.lineTo(0, -98); ctx.lineTo(38, -76); ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle = "#5a4a30"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -76); ctx.lineTo(0, -44); ctx.stroke();
        ctx.fillStyle = "#4a3a28"; ctx.fillRect(-7, -46, 14, 12);
        break;
      }
      case "scarecrow": {
        ctx.strokeStyle = "#3a2a18"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -85); ctx.moveTo(-30, -62); ctx.lineTo(30, -62); ctx.stroke();
        ctx.fillStyle = "#6b5433";
        ctx.beginPath(); ctx.moveTo(-14, -60); ctx.lineTo(14, -60); ctx.lineTo(9, -25); ctx.lineTo(-9, -25); ctx.closePath(); ctx.fill();
        if (!broken) {
          ctx.fillStyle = "#c9a86a";
          ctx.beginPath(); ctx.arc(0, -92, 11, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#241511";
          ctx.beginPath(); ctx.moveTo(-16, -98); ctx.lineTo(16, -98); ctx.lineTo(0, -116); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#1a0f0a";
          ctx.beginPath(); ctx.arc(-4, -93, 1.8, 0, Math.PI * 2); ctx.arc(4, -93, 1.8, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case "lantern": {
        if (!blackout && !broken && this.settings.graphics.glow) {
          const light = ctx.createRadialGradient(0, -92, 4, 0, -72, 112);
          light.addColorStop(0, `rgba(255,187,83,${0.10 + 0.18 * night})`); light.addColorStop(1, "rgba(255,145,45,0)");
          ctx.fillStyle = light; ctx.fillRect(-115, -205, 230, 220);
        }
        ctx.fillStyle = "#191420";
        if (broken) {
          ctx.strokeStyle = "#191420"; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -72); ctx.lineTo(-19, -103); ctx.stroke();
        } else {
          ctx.fillRect(-3, -110, 6, 110);
          ctx.fillRect(-14, -112, 28, 5);
        }
        const glow = blackout || broken ? 0.03 : (0.3 + 0.45 * night) + Math.sin(t * 5) * 0.1 - flick;
        ctx.fillStyle = `rgba(255,190,90,${Math.max(0.03, glow)})`;
        ctx.shadowColor = "rgba(255,180,80,0.9)"; this.glow(ctx, blackout || broken ? 0 : Math.round(10 + 16 * night));
        ctx.fillRect(-8, -106, 16, 18);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#191420"; ctx.fillRect(-10, -108, 20, 3);
        break;
      }
      case "chapel": {
        // the chapel is the town's landmark — drawn at nave-and-steeple scale
        ctx.save();
        ctx.scale(CHAPEL_SCALE, CHAPEL_SCALE);
        ctx.fillStyle = "#221419";
        ctx.fillRect(-65, -90, 130, 90);
        ctx.beginPath(); ctx.moveTo(-72, -90); ctx.lineTo(0, -128); ctx.lineTo(72, -90); ctx.closePath(); ctx.fill();
        ctx.fillRect(-16, -170, 32, 84);
        ctx.beginPath(); ctx.moveTo(-20, -168); ctx.lineTo(0, -206); ctx.lineTo(20, -168); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#c9b98a"; ctx.fillRect(-2, -228, 4, 24); ctx.fillRect(-8, -221, 16, 4);
        win(-44, -66, 14, 28); win(30, -66, 14, 28); win(-6, -156, 12, 20);
        ctx.fillStyle = "#120a0e"; ctx.fillRect(-12, -44, 24, 44);
        ctx.restore();
        break;
      }
      case "mill": {
        ctx.fillStyle = "#20140f";
        ctx.fillRect(-80, -85, 160, 85);
        ctx.beginPath(); ctx.moveTo(-88, -85); ctx.lineTo(88, -85); ctx.lineTo(60, -115); ctx.lineTo(-60, -115); ctx.closePath(); ctx.fill();
        win(-50, -60, 20, 22); win(28, -60, 20, 22);
        ctx.save();
        ctx.translate(0, -50); ctx.rotate(broken ? 0 : t * 0.6);
        ctx.strokeStyle = "#4a3826"; ctx.lineWidth = 7;
        for (let i = 0; i < (broken ? 2 : 4); i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -44); ctx.stroke(); }
        ctx.restore();
        ctx.fillStyle = "#0f0a08"; ctx.fillRect(-14, -40, 28, 40);
        break;
      }
      case "graves": {
        for (const [gx, gh, tilt] of [[-55, 34, -0.28], [-20, 42, 0.3], [18, 30, -0.36], [52, 38, 0.24]] as const) {
          ctx.save(); ctx.translate(gx, 0); ctx.rotate(broken ? tilt : 0);
          ctx.fillStyle = "#3d3a42";
          ctx.beginPath(); ctx.roundRect(-11, -gh, 22, gh, [10, 10, 0, 0]); ctx.fill();
          ctx.restore();
        }
        if (broken) {
          ctx.fillStyle = "#0a0605";
          ctx.beginPath(); ctx.ellipse(85, -2, 26, 7, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#2a1c12";
          ctx.beginPath(); ctx.ellipse(108, -8, 14, 9, 0.3, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = "#493120";
          ctx.beginPath(); ctx.ellipse(85, -2, 28, 6, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case "radio": {
        ctx.strokeStyle = "#2c2833"; ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(-34, 0); ctx.lineTo(broken ? -16 : 0, broken ? -102 : -190);
        ctx.lineTo(broken ? 38 : 34, broken ? -72 : 0);
        ctx.moveTo(-24, -55); ctx.lineTo(24, -55);
        ctx.moveTo(-15, -110); ctx.lineTo(15, -110);
        ctx.moveTo(-24, -55); ctx.lineTo(15, -110); ctx.moveTo(24, -55); ctx.lineTo(-15, -110);
        ctx.stroke();
        const blink = broken ? 0.03 : Math.sin(t * 3) > 0 ? 0.9 : 0.2;
        ctx.fillStyle = `rgba(255,60,50,${blink})`;
        ctx.shadowColor = "#ff3c32"; this.glow(ctx, broken ? 0 : 12);
        ctx.beginPath(); ctx.arc(0, -194, 4, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      case "silo": {
        ctx.fillStyle = "#332622";
        ctx.fillRect(-34, -140, 68, 140);
        ctx.beginPath(); ctx.arc(0, -140, 34, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 2;
        for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-34, -i * 28); ctx.lineTo(34, -i * 28); ctx.stroke(); }
        ctx.fillStyle = "#17100c"; ctx.fillRect(-12, -36, 24, 36);
        break;
      }
    }
    if (broken) drawBrokenWard(ctx, st.kind);
    ctx.restore();

    // A kit on the ground marks a ward that is ready for hands-on repair.
    if (task && !task.done && supplied) drawKit(ctx, x + 85, ground);

    // State marker for unfinished wards: missing kit or ready for repair.
    if (task && !task.done && snap.phase === "playing") {
      const bob = Math.sin(t * 3 + st.x) * 4;
      const markerY = st.kind === "chapel" ? ground - 372 : ground - 235;
      ctx.save();
      ctx.fillStyle = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
      ctx.shadowColor = supplied ? "#729a65" : "#ffcd5a"; this.glow(ctx, 8);
      ctx.translate(x, markerY + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "rgba(12,8,16,.78)";
      ctx.fillRect(x - 48, markerY - 24, 96, 16);
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = supplied ? "#b3d59a" : task.sabotaged ? "#d87762" : "#ffcd5a";
      ctx.fillText(supplied ? "PUZZLE" : task.sabotaged ? "SABOTAGED" : "NEEDS KIT", x, markerY - 12);
      ctx.restore();
      if (task.progress > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(x - 30, markerY + 20, 60, 8);
        ctx.fillStyle = "#ffcd5a";
        ctx.fillRect(x - 29, markerY + 21, 58 * task.progress, 6);
      }
    }
  }
}

export const CAGE_POSITIONS = CAGE_XS;