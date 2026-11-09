// Pre-rendered painting primitives shared by the scene modules.
//
// Everything that would otherwise build a path, gradient, or shadowBlur per frame
// (light halos, drop shadows, door spills, badges) is baked once into a bitmap.

const lightCache = new Map<string, HTMLCanvasElement>();
const badgeCache = new Map<string, HTMLCanvasElement>();

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function lightSprite(rgb: string): HTMLCanvasElement {
  let canvas = lightCache.get(rgb);
  if (canvas) return canvas;
  canvas = makeCanvas(64, 64);
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.45, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  lightCache.set(rgb, canvas);
  return canvas;
}

/** Soft light centred on (x, y) with radii rx and ry. `a` is the peak strength (0..1). */
export function light(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, a: number) {
  if (a <= 0.004 || rx <= 0 || ry <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.min(1, a);
  ctx.drawImage(lightSprite(rgb), x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prev;
}

let darkOval: HTMLCanvasElement | null = null;
/** Pre-baked dark contact shadow oval (unit size 64x16). */
export function drawShadowOval(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha = 0.36) {
  if (!darkOval) {
    darkOval = makeCanvas(64, 16);
    const g = darkOval.getContext("2d")!;
    g.fillStyle = "#040306";
    g.beginPath();
    g.ellipse(32, 8, 31, 7.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(darkOval, cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prev;
}

let warmOval: HTMLCanvasElement | null = null;
/** Pre-baked warm oval spill (door threshold). */
export function drawWarmOval(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, alpha: number) {
  if (alpha <= 0.004) return;
  if (!warmOval) {
    warmOval = makeCanvas(64, 16);
    const g = warmOval.getContext("2d")!;
    g.fillStyle = "#e6aa69";
    g.beginPath();
    g.ellipse(32, 8, 31, 7.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(warmOval, cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prev;
}

export interface PillSprite { canvas: HTMLCanvasElement; w: number; h: number }
const pillCache = new Map<string, PillSprite>();
let measureCtx: CanvasRenderingContext2D | null = null;

/** Cached pill label (roundRect + text baked at 2x density). Zero path or fillText calls per frame. */
export function getPillBadge(
  key: string, text: string, font: string, bg: string, fg: string, padX: number, h: number,
): PillSprite {
  const hit = pillCache.get(key);
  if (hit) return hit;
  const s = 2;
  const measure = (measureCtx ??= makeCanvas(1, 1).getContext("2d")!);
  measure.font = font;
  const w = Math.ceil(measure.measureText(text).width + padX * 2);
  const canvas = makeCanvas(w * s, h * s);
  const g = canvas.getContext("2d")!;
  g.scale(s, s);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, 5);
  g.fill();
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + 0.5);
  const entry = { canvas, w, h };
  if (pillCache.size >= 512) pillCache.delete(pillCache.keys().next().value as string);
  pillCache.set(key, entry);
  return entry;
}

const BADGE_CAP = 512;

/** Cache any small bitmap by string key (evicts one oldest entry, never wipes the whole cache). */
export function cachedSprite(key: string, cap: number, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = badgeCache.get(key);
  if (!c) {
    const limit = Math.max(cap, BADGE_CAP);
    if (badgeCache.size >= limit) badgeCache.delete(badgeCache.keys().next().value as string);
    c = make();
    badgeCache.set(key, c);
  }
  return c;
}
