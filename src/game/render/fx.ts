// Atmosphere over the scene: pre-baked falling leaves, firefly glow sprites,
// pre-baked fog bands, reed cluster sprites, pre-baked darkness ring + 4 outer
// strips (replacing the 23 ms/frame radial gradient), past wash, baked grade +
// vignette + grain, and horror flicker. Zero per-frame gradients or path builds.
import { WORLD_MAX, WORLD_MIN, treeX } from "../buildings";
import { makeCanvas } from "./paint";
import { LEAF_COLORS } from "./palette";
import type { View } from "./view";

export interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: number; s: number }

let leafSeed = 1;
const nextRand = () => ((leafSeed = (Math.imul(leafSeed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

export function makeLeaves(): Leaf[] {
  const leaves: Leaf[] = [];
  for (let i = 0; i < 110; i++) {
    leaves.push({
      x: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
      y: Math.random() * 600,
      vx: -12 - Math.random() * 25,
      vy: 18 + Math.random() * 30,
      r: Math.random() * Math.PI * 2,
      c: i % LEAF_COLORS.length,
      s: 3 + Math.random() * 4,
    });
  }
  return leaves;
}

// 5 colours x 8 quantized angles = 40 tiny 20x20 sprites: one drawImage per leaf, no save/rotate/restore.
const LEAF_ANGLES = 8;
let leafSprites: HTMLCanvasElement[][] | null = null;
function getLeafSprites(): HTMLCanvasElement[][] {
  if (leafSprites) return leafSprites;
  leafSprites = LEAF_COLORS.map((color) => {
    const row: HTMLCanvasElement[] = [];
    for (let a = 0; a < LEAF_ANGLES; a++) {
      const c = makeCanvas(20, 20);
      const g = c.getContext("2d")!;
      g.translate(10, 10);
      g.rotate((a / LEAF_ANGLES) * Math.PI * 2);
      g.fillStyle = color;
      g.globalAlpha = 0.72;
      g.beginPath();
      g.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(40,18,10,.45)";
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(-7, 0);
      g.lineTo(7, 0);
      g.stroke();
      row.push(c);
    }
    return row;
  });
  return leafSprites;
}

export function drawLeaves(v: View, leaves: Leaf[], count: number) {
  const { ctx, cam, w, h, ground, lift, dt } = v;
  const sprites = getLeafSprites();
  const yMax = 556; // fixed 700 * 0.78 + 10 so zooming never collapses leaves onto one line
  const yScale = (ground + lift) / yMax;
  const inv2Pi = LEAF_ANGLES / (Math.PI * 2);
  for (let li = 0; li < count && li < leaves.length; li++) {
    const l = leaves[li];
    l.x += l.vx * dt;
    l.y += l.vy * dt;
    l.r += dt * 2;
    if (l.y > yMax) { l.y = -20; l.x = cam + nextRand() * w; }
    if (l.x < cam - 60) l.x = cam + w + 40;
    else if (l.x > cam + w + 60) l.x = cam - 40;
    const sx = l.x - cam;
    if (sx < -20 || sx > w + 20) continue;
    const sy = l.y * yScale - lift;
    if (sy < -lift - 20 || sy > h - lift + 20) continue;
    const size = l.s * 2.6;
    const ang = ((Math.floor(l.r * inv2Pi) % LEAF_ANGLES) + LEAF_ANGLES) % LEAF_ANGLES;
    ctx.drawImage(sprites[l.c][ang], sx - size * 0.5, sy - size * 0.5, size, size);
  }
}

let fireflySprites: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
function getFireflySprites(): [HTMLCanvasElement, HTMLCanvasElement] {
  if (fireflySprites) return fireflySprites;
  const make = (rgb: string, core: string) => {
    const c = makeCanvas(16, 16);
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, core);
    grad.addColorStop(0.25, `rgba(${rgb},0.85)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 16);
    return c;
  };
  fireflySprites = [make("255,200,110", "#ffd98a"), make("190,230,140", "#c8e896")];
  return fireflySprites;
}

export function drawFireflies(v: View, count: number) {
  const { ctx, cam, w, ground, t, night, glow } = v;
  const season = Math.max(0, 1 - night * 1.15);
  if (season <= 0.02) return;
  const [warmSprite, coolSprite] = getFireflySprites();
  const prev = ctx.globalAlpha;
  const size = glow ? 14 : 4;
  const half = size * 0.5;
  for (let i = 0; i < count; i++) {
    const anchor = treeX(i * 5 - 6);
    const fx = anchor + Math.sin(t * (0.21 + (i % 5) * 0.05) + i * 2.4) * (46 + (i % 4) * 22);
    const sx = fx - cam;
    if (sx < -20 || sx > w + 20) continue;
    const fy = ground - 34 - (i % 6) * 16 + Math.sin(t * (0.5 + (i % 3) * 0.2) + i) * 12;
    const blink = Math.pow(Math.max(0, Math.sin(t * (0.9 + (i % 4) * 0.3) + i * 1.7)), 3);
    const a = blink * season * 0.85;
    if (a < 0.03) continue;
    ctx.globalAlpha = prev * a;
    ctx.drawImage(i % 3 !== 0 ? warmSprite : coolSprite, sx - half, fy - half, size, size);
  }
  ctx.globalAlpha = prev;
}

const fogBands: HTMLCanvasElement[] = [];
function getFogBand(i: number): HTMLCanvasElement {
  if (fogBands[i]) return fogBands[i];
  const c = makeCanvas(2, 50);
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 50);
  grad.addColorStop(0, "rgba(120,110,130,0)");
  grad.addColorStop(0.5, `rgba(145,132,151,${0.075 + i * 0.018})`);
  grad.addColorStop(1, "rgba(120,110,130,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 50);
  fogBands[i] = c;
  return c;
}

export function drawFog(v: View, layers: number) {
  const { ctx, w, ground } = v;
  for (let i = 0; i < layers; i++) {
    const fy = ground - 24 - i * 25;
    ctx.drawImage(getFogBand(i), 0, fy - 25, w, 50);
  }
}

const reedClusters: HTMLCanvasElement[] = [];
function getReedCluster(variant: number): HTMLCanvasElement {
  if (reedClusters[variant]) return reedClusters[variant];
  const c = makeCanvas(156, 72);
  const g = c.getContext("2d")!;
  g.fillStyle = "#050308";
  g.strokeStyle = "#050308";
  g.lineWidth = 2.4;
  const blades = 4 + (variant % 3);
  for (let b = 0; b < blades; b++) {
    const x = 6 + b * 7 + (variant % 5);
    const bh = 13 + ((variant * 7 + b * 13) % 17);
    g.beginPath();
    g.moveTo(x, 72);
    g.quadraticCurveTo(x + 1, 72 - bh * 0.6, x + 2 + (b % 2 ? 3 : -3), 72 - bh);
    g.quadraticCurveTo(x + 3, 72 - bh * 0.5, x + 3.4, 72);
    g.closePath();
    g.fill();
  }
  if (variant % 4 === 0) {
    const x = 52;
    const ch = 42 + (variant % 12);
    g.beginPath();
    g.moveTo(x, 72);
    g.quadraticCurveTo(x + 2, 72 - ch * 0.6, x + 3.5, 72 - ch);
    g.stroke();
    g.beginPath();
    g.ellipse(x + 3.5, 72 - ch - 6, 3.2, 8, 0.04, 0, Math.PI * 2);
    g.fill();
  }
  reedClusters[variant] = c;
  return c;
}

export function drawReeds(v: View) {
  const { ctx, cam, w, h, t } = v;
  const span = 150;
  const base = Math.floor((cam * 1.22) / span) - 1;
  const off = -((cam * 1.22) % span);
  const count = Math.ceil(w / span) + 3;
  for (let k = -1; k < count; k++) {
    const seed = Math.abs(base + k);
    const sway = Math.sin(t * 0.8 + seed * 1.3) * 2.2;
    const bx = off + k * span - 6 + sway;
    if (bx > w || bx + 156 < 0) continue;
    ctx.drawImage(getReedCluster(seed % 12), bx, h - 70);
  }
}

// Pre-baked 512x512 radial darkness square: transparent lantern circle in the
// center fading seamlessly to rgba(3,1,6,0.992) so objects outside server
// vision cannot faintly ghost into view on wide aspect ratios.
let darkRing: HTMLCanvasElement | null = null;
function getDarkRing(): HTMLCanvasElement {
  if (darkRing) return darkRing;
  const size = 512;
  const half = size / 2;
  const c = makeCanvas(size, size);
  const g = c.getContext("2d")!;
  const dark = g.createRadialGradient(half, half, half * 0.45, half, half, half - 2);
  dark.addColorStop(0, "rgba(4,2,8,0)");
  dark.addColorStop(0.55, "rgba(4,2,8,0.34)");
  dark.addColorStop(0.78, "rgba(4,2,8,0.72)");
  dark.addColorStop(1, "rgba(3,1,6,0.992)");
  g.fillStyle = dark;
  g.fillRect(0, 0, size, size);
  const warm = g.createRadialGradient(half, half, 4, half, half, half * 0.7);
  warm.addColorStop(0, "rgba(255,178,92,0.07)");
  warm.addColorStop(1, "rgba(255,178,92,0)");
  g.fillStyle = warm;
  g.fillRect(0, 0, size, size);
  darkRing = c;
  return c;
}

export function drawDarkness(v: View, _visionR: number): number {
  const { ctx, snap, t, cam, ground, meX } = v;
  const targetR = snap.visionRadius;
  if (targetR >= 1500) return 420;
  const r = Math.max(80, targetR + Math.sin(t * 7.3) * 6);
  const m = ctx.getTransform();
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const dcx = m.a * (meX - cam) + m.e;
  const dcy = m.d * (ground - 50) + m.f;
  const dr = r * m.a;
  // Exact integer device-pixel bounds so outer strips and ring sprite never subpixel-overlap.
  const rx0 = Math.round(dcx - dr);
  const ry0 = Math.round(dcy - dr);
  const rx1 = Math.round(dcx + dr);
  const ry1 = Math.round(dcy + dr);
  const x0 = Math.max(0, rx0);
  const y0 = Math.max(0, ry0);
  const x1 = Math.min(cw, rx1);
  const y1 = Math.min(ch, ry1);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "rgba(3,1,6,0.992)";
  if (y0 > 0) ctx.fillRect(0, 0, cw, y0);
  if (y1 < ch) ctx.fillRect(0, y1, cw, ch - y1);
  if (x0 > 0 && y1 > y0) ctx.fillRect(0, y0, x0, y1 - y0);
  if (x1 < cw && y1 > y0) ctx.fillRect(x1, y0, cw - x1, y1 - y0);
  ctx.drawImage(getDarkRing(), rx0, ry0, rx1 - rx0, ry1 - ry0);
  ctx.restore();
  return targetR;
}

export function drawPastWash(v: View) {
  v.ctx.fillStyle = "rgba(72,133,151,.10)";
  v.ctx.fillRect(0, -v.lift, v.w, v.h);
}

let overlayCanvas: HTMLCanvasElement | null = null;
let ovW = 0, ovH = 0, ovNb = -1, ovVig = false, ovGrade = false, ovGrain = false;
let grainTile: HTMLCanvasElement | null = null;

function makeGrainTile(): HTMLCanvasElement {
  // Use high bits of the PRNG (the low bits of an LCG have short period and cause stripes).
  const c = makeCanvas(128, 128);
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  let s = 0x13579bdf;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z ^= z + Math.imul(z ^ (z >>> 7), 61 | z);
    const value = 96 + (((z ^ (z >>> 14)) >>> 26) & 63);
    img.data[i] = value; img.data[i + 1] = value; img.data[i + 2] = value; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

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

export function drawScreenGrade(v: View, vignette: boolean) {
  const grade = v.quality !== "low";
  const grain = v.quality === "high" && !v.reduced;
  if (!vignette && !grade && !grain) return;
  const cw = v.ctx.canvas.width;
  const ch = v.ctx.canvas.height;
  if (!overlayCanvas || ovW !== cw || ovH !== ch || ovNb !== v.nb || ovVig !== vignette || ovGrade !== grade || ovGrain !== grain) {
    overlayCanvas = bakeOverlay(cw, ch, v.nb, vignette, grade, grain);
    ovW = cw; ovH = ch; ovNb = v.nb; ovVig = vignette; ovGrade = grade; ovGrain = grain;
  }
  const ctx = v.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(overlayCanvas, 0, 0);
  ctx.restore();
}

export function drawFlicker(v: View) {
  const since = v.now - v.snap.flickerAt;
  if (v.flicker && !v.reduced && since >= 0 && since < 900) {
    const a = Math.random() < 0.5 ? 0.55 : 0.15;
    v.ctx.fillStyle = `rgba(0,0,0,${a * (1 - since / 900)})`;
    v.ctx.fillRect(0, -v.lift, v.w, v.h);
  }
}
