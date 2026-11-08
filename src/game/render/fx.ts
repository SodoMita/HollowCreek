// Atmosphere over the scene: falling leaves, fireflies, low fog, the foreground
// reeds, the lantern-light darkness, the past wash, the vignette and grade, the
// horror flicker and the film grain. Only the darkness follows game state (the
// server's vision radius); everything else is decorative.
import { WORLD_MAX, WORLD_MIN, treeX } from "../buildings";
import { light, makeCanvas } from "./paint";
import { LEAF_COLORS } from "./palette";
import { cachedGradient, type View } from "./view";

export interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }

// Deterministic recycling: no Math.random() in the frame loop.
let leafSeed = 1;
const nextRand = () => ((leafSeed = (Math.imul(leafSeed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

/** 110 falling leaves, scattered across the road at construction. */
export function makeLeaves(): Leaf[] {
  const leaves: Leaf[] = [];
  for (let i = 0; i < 110; i++) {
    leaves.push({
      x: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
      y: Math.random() * 600,
      vx: -12 - Math.random() * 25,
      vy: 18 + Math.random() * 30,
      r: Math.random() * Math.PI * 2,
      c: LEAF_COLORS[i % LEAF_COLORS.length],
      s: 3 + Math.random() * 4,
    });
  }
  return leaves;
}

export function drawLeaves(v: View, leaves: Leaf[], count: number) {
  const { ctx, cam, w, h, ground, dt } = v;
  for (let li = 0; li < count && li < leaves.length; li++) {
    const l = leaves[li];
    l.x += l.vx * dt;
    l.y += l.vy * dt;
    l.r += dt * 2;
    if (l.y > ground + 10) { l.y = -20; l.x = cam + nextRand() * w; }
    if (l.x < cam - 60) l.x = cam + w + 40;
    const sx = l.x - cam;
    if (sx < -20 || sx > w + 20) continue;
    ctx.save();
    ctx.translate(sx, l.y * (h / 700));
    ctx.rotate(l.r);
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = l.c;
    ctx.beginPath();
    ctx.ellipse(0, 0, l.s, l.s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(40,18,10,.45)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-l.s, 0);
    ctx.lineTo(l.s, 0);
    ctx.stroke();
    ctx.restore();
  }
}

/** Fireflies drift along the tree line at dusk and give way to the deep night. */
export function drawFireflies(v: View, count: number) {
  const { ctx, cam, w, ground, t, night, glow } = v;
  const season = Math.max(0, 1 - night * 1.15);
  if (season <= 0.02) return;
  for (let i = 0; i < count; i++) {
    const anchor = treeX(i * 5 - 6);
    const fx = anchor + Math.sin(t * (0.21 + (i % 5) * 0.05) + i * 2.4) * (46 + (i % 4) * 22);
    const sx = fx - cam;
    if (sx < -20 || sx > w + 20) continue;
    const fy = ground - 34 - (i % 6) * 16 + Math.sin(t * (0.5 + (i % 3) * 0.2) + i) * 12;
    const blink = Math.pow(Math.max(0, Math.sin(t * (0.9 + (i % 4) * 0.3) + i * 1.7)), 3);
    const a = blink * season * 0.85;
    if (a < 0.03) continue;
    const warm = i % 3 !== 0;
    if (glow) light(ctx, sx, fy, 7, 7, warm ? "255,200,110" : "190,230,140", a * 0.8);
    ctx.fillStyle = warm ? `rgba(255,217,138,${a})` : `rgba(200,232,150,${a})`;
    ctx.beginPath();
    ctx.arc(sx, fy, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Low, layered fog that drifts along the road. */
export function drawFog(v: View, layers: number) {
  const { ctx, w, t, ground } = v;
  for (let i = 0; i < layers; i++) {
    const fy = ground - 24 - i * 25;
    const drift = Math.sin(t * 0.24 + i * 2) * 70;
    const g = cachedGradient(v, `fog|${ground}|${i}`, () => {
      const grad = ctx.createLinearGradient(0, fy - 25, 0, fy + 25);
      grad.addColorStop(0, "rgba(120,110,130,0)");
      grad.addColorStop(0.5, `rgba(145,132,151,${0.075 + i * 0.018})`);
      grad.addColorStop(1, "rgba(120,110,130,0)");
      return grad;
    });
    ctx.fillStyle = g;
    ctx.fillRect(drift - 90, fy - 25, w + 180, 50);
  }
}

/** Foreground reeds and cattails. Three batched passes (blades, heads, stems) built
 *  straight into the context: no Path2D allocation in the frame loop. */
export function drawReeds(v: View) {
  const { ctx, cam, w, h, t } = v;
  const span = 150;
  const off = -((cam * 1.22) % span);
  ctx.fillStyle = "#050308";
  // Blades.
  ctx.beginPath();
  for (let i = -1; i < w / span + 2; i++) {
    const bx = off + i * span;
    const seed = Math.abs(Math.round((cam * 1.22) / span) + i);
    const sway = Math.sin(t * 0.8 + seed * 1.3) * 2.4;
    const count = 4 + (seed % 3);
    for (let b = 0; b < count; b++) {
      const x = bx + b * 7 + (seed % 5);
      const bh = 13 + ((seed * 7 + b * 13) % 17);
      ctx.moveTo(x, h + 2);
      ctx.quadraticCurveTo(x + sway * 0.5, h - bh * 0.6, x + sway + (b % 2 ? 3 : -3), h - bh);
      ctx.quadraticCurveTo(x + sway * 0.5 + 2, h - bh * 0.5, x + 3.4, h + 2);
      ctx.closePath();
    }
  }
  ctx.fill();
  // Cattail heads and their stems.
  ctx.beginPath();
  let stems = 0;
  for (let i = -1; i < w / span + 2; i++) {
    const bx = off + i * span;
    const seed = Math.abs(Math.round((cam * 1.22) / span) + i);
    if (seed % 4 !== 0) continue;
    const sway = Math.sin(t * 0.8 + seed * 1.3) * 2.4;
    const x = bx + 46;
    const ch = 42 + (seed % 12);
    ctx.ellipse(x + sway * 1.6, h - ch - 6, 3.2, 8, sway * 0.02, 0, Math.PI * 2);
    stems++;
  }
  ctx.fill();
  if (stems > 0) {
    ctx.beginPath();
    for (let i = -1; i < w / span + 2; i++) {
      const bx = off + i * span;
      const seed = Math.abs(Math.round((cam * 1.22) / span) + i);
      if (seed % 4 !== 0) continue;
      const sway = Math.sin(t * 0.8 + seed * 1.3) * 2.4;
      const x = bx + 46;
      const ch = 42 + (seed % 12);
      ctx.moveTo(x, h + 2);
      ctx.quadraticCurveTo(x + sway, h - ch * 0.6, x + sway * 1.6, h - ch);
    }
    ctx.strokeStyle = "#050308";
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
}

/** Lantern-light darkness around the viewer, sized by the server's vision radius. Returns the smoothed radius. */
export function drawDarkness(v: View, visionR: number): number {
  const { ctx, snap, dt, t, w, h, cam, ground, meX } = v;
  const targetR = snap.visionRadius;
  if (targetR >= 1500) return 420;
  const vr = visionR + (targetR - visionR) * Math.min(1, dt * 3.5);
  const r = Math.max(80, vr + Math.sin(t * 7.3) * 6); // the lantern breathes
  const cx = meX - cam;
  const cy = ground - 50;
  const dark = ctx.createRadialGradient(cx, cy, r * 0.45, cx, cy, r);
  dark.addColorStop(0, "rgba(4,2,8,0)");
  dark.addColorStop(0.55, "rgba(4,2,8,0.3)");
  dark.addColorStop(0.78, "rgba(4,2,8,0.6)");
  dark.addColorStop(1, "rgba(3,1,6,0.965)");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, w, h);
  // The lantern you carry is warm; the dark beyond it is cold.
  light(ctx, cx, cy, r * 0.7, r * 0.7, "255,178,92", 0.07);
  return vr;
}

/** A restrained blue wash makes the recorded past distinct from the present. */
export function drawPastWash(v: View) {
  v.ctx.fillStyle = "rgba(72,133,151,.10)";
  v.ctx.fillRect(0, 0, v.w, v.h);
}

/** Horror flicker after a lamp event. Decorative only; never changes the authoritative vision. */
export function drawFlicker(v: View) {
  const since = v.now - v.snap.flickerAt;
  if (v.settings.graphics.flicker && !v.reduced && since >= 0 && since < 900) {
    const a = Math.random() < 0.5 ? 0.55 : 0.15;
    v.ctx.fillStyle = `rgba(0,0,0,${a * (1 - since / 900)})`;
    v.ctx.fillRect(0, 0, v.w, v.h);
  }
}

const overlays = new Map<string, HTMLCanvasElement>();
let grainTile: HTMLCanvasElement | null = null;

/** One small reusable noise tile, built lazily. */
function makeGrainTile(): HTMLCanvasElement {
  const c = makeCanvas(128, 128);
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  let s = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const value = 96 + (s % 64);
    img.data[i] = value;
    img.data[i + 1] = value;
    img.data[i + 2] = value;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Vignette, cool-shadow grade and film grain, baked at device resolution. Grain is static:
 *  a drifting full-screen pattern cost more per frame than the rest of the atmosphere. */
function bakeOverlay(cw: number, ch: number, nb: number, vignette: boolean, grade: boolean, grain: boolean): HTMLCanvasElement {
  const canvas = makeCanvas(cw, ch);
  const g = canvas.getContext("2d")!;
  if (grade) {
    const lg = g.createLinearGradient(0, 0, 0, ch);
    lg.addColorStop(0, `rgba(46,92,112,${0.12 + 0.06 * nb})`);
    lg.addColorStop(0.55, "rgba(60,50,70,0.05)");
    lg.addColorStop(1, "rgba(214,130,52,0.14)");
    g.fillStyle = lg;
    g.fillRect(0, 0, cw, ch);
  }
  if (vignette) {
    const vg = g.createRadialGradient(cw / 2, ch / 2, ch * 0.35, cw / 2, ch / 2, ch * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(4,2,7,${0.6 + 0.25 * nb})`);
    g.fillStyle = vg;
    g.fillRect(0, 0, cw, ch);
  }
  if (grain) {
    grainTile ??= makeGrainTile();
    const pattern = g.createPattern(grainTile, "repeat");
    if (pattern) {
      g.globalAlpha = 0.05;
      g.fillStyle = pattern;
      g.fillRect(0, 0, cw, ch);
      g.globalAlpha = 1;
    }
  }
  return canvas;
}

/** One copy of the baked overlay, 1:1 in device pixels. */
export function drawScreenGrade(v: View) {
  const vignette = v.settings.graphics.vignette;
  const grade = v.quality !== "low";
  const grain = v.quality === "high" && !v.reduced;
  if (!vignette && !grade && !grain) return;
  const cw = v.ctx.canvas.width;
  const ch = v.ctx.canvas.height;
  const key = `${cw}x${ch}|${v.nb}|${vignette}|${grade}|${grain}`;
  let canvas = overlays.get(key);
  if (!canvas) {
    if (overlays.size > 8) overlays.clear();
    canvas = bakeOverlay(cw, ch, v.nb, vignette, grade, grain);
    overlays.set(key, canvas);
  }
  const ctx = v.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

