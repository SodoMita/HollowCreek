// GPU texture registry for the Pixi renderer.
//
// Every canvas the baking side produces (rasterised SVG art, baked sky/overlay,
// text labels) is uploaded to the GPU exactly once and then reused. Lookups use
// nested numeric maps so the frame loop builds no cache-key strings and
// allocates nothing. When the raster density (zoom/device pixels) changes, the
// renderer bumps the density epoch and stale textures are destroyed and
// re-uploaded from their fresh canvases — once per entity, not per frame.
import { CanvasSource, Texture } from "pixi.js";
import { getArtScale, spriteFor, travelerCanvas } from "../svg-assets";
import { lightCanvas, makeCanvas, measureTextWidth } from "./paint";

interface Entry { canvas: HTMLCanvasElement | null; tex: Texture | null; epoch: number }

let epoch = 0;
let lastScale = -1;

/** Called by the Renderer each frame; a scale change invalidates raster caches. */
export function syncDensity(): void {
  const scale = getArtScale();
  if (scale !== lastScale) {
    lastScale = scale;
    epoch++;
  }
}

const byCanvas = new WeakMap<HTMLCanvasElement, { res: number; tex: Texture }>();

/** Releases a texture this module created. The GPU source is shared by every texture made
 *  from the same canvas, so the source itself is kept alive (destroying it leaves live
 *  sprites with a null source, which crashes Pixi's batcher). */
export function releaseTexture(tex: Texture): void {
  tex.destroy(false);
}

/** The texture for a canvas at a display resolution, uploaded once per canvas. */
export function textureOf(canvas: HTMLCanvasElement, resolution: number): Texture {
  const hit = byCanvas.get(canvas);
  if (hit && hit.res === resolution) return hit.tex;
  if (hit) releaseTexture(hit.tex);
  const tex = new Texture({ source: new CanvasSource({ resource: canvas, resolution }) });
  byCanvas.set(canvas, { res: resolution, tex });
  return tex;
}

// path -> width -> height -> entry
const artCache = new Map<string, Map<number, Map<number, Entry>>>();

/** The GPU texture for an SVG at a world size, or null until the file has loaded. */
export function artTexture(path: string, w: number, h: number): Texture | null {
  let byW = artCache.get(path);
  if (!byW) { byW = new Map(); artCache.set(path, byW); }
  let byH = byW.get(w);
  if (!byH) { byH = new Map(); byW.set(w, byH); }
  let entry = byH.get(h);
  if (!entry) { entry = { canvas: null, tex: null, epoch: -1 }; byH.set(h, entry); }
  if (entry.epoch !== epoch || !entry.canvas) {
    const canvas = spriteFor(path, w, h);
    if (!canvas) return null;
    if (canvas !== entry.canvas) {
      entry.canvas = canvas;
      entry.tex = textureOf(canvas, canvas.width / w);
    }
    entry.epoch = epoch;
  }
  return entry.tex;
}

// colour -> flag bits (redEyes | ghost<<1 | poseStep+3 <<2) -> entry
const travelerCache = new Map<string, Map<number, Entry>>();

/** The GPU texture for a traveller in its own colours, or null while it bakes. */
export function travelerTexture(color: string, redEyes: boolean, ghost: boolean, pose: number): Texture | null {
  const cloak = /^#[0-9a-f]{6}$/i.test(color) ? color : "#3a7ca5";
  const step = pose > 0 ? 3 : pose < 0 ? -3 : 0;
  const flags = (redEyes ? 1 : 0) | (ghost ? 2 : 0) | ((step + 3) << 2);
  let byFlags = travelerCache.get(cloak);
  if (!byFlags) { byFlags = new Map(); travelerCache.set(cloak, byFlags); }
  let entry = byFlags.get(flags);
  if (!entry) { entry = { canvas: null, tex: null, epoch: -1 }; byFlags.set(flags, entry); }
  if (entry.epoch !== epoch || !entry.canvas) {
    const canvas = travelerCanvas(color, redEyes, ghost, pose);
    if (!canvas) return null;
    if (canvas !== entry.canvas) {
      entry.canvas = canvas;
      entry.tex = textureOf(canvas, canvas.width / 40);
    }
    entry.epoch = epoch;
  }
  return entry.tex;
}

// Baked one-off canvases (sky, hills, overlay, labels...), keyed by the caller.
const bakedCache = new Map<string, Texture>();

/**
 * A cached baked texture. `make` draws the canvas at pixel size (pw, ph); the
 * texture's display resolution maps it back to (pw/resolution) stage units.
 * Rebuilt only when the caller changes the key.
 */
export function bakedTexture(
  key: string, pw: number, ph: number, resolution: number,
  make: (g: CanvasRenderingContext2D, pw: number, ph: number) => void,
): Texture {
  const hit = bakedCache.get(key);
  if (hit) return hit;
  const tex = bakeTextureUncached(pw, ph, resolution, make);
  // Never mass-destroy here: cached glyphs/labels may be on screen right now.
  // The few large bakes (sky, hills, overlay) use bakeTextureUncached and are
  // destroyed explicitly by their owners when replaced.
  bakedCache.set(key, tex);
  return tex;
}

/** A one-off bake with no cache. The caller owns the texture (destroy on swap). */
export function bakeTextureUncached(
  pw: number, ph: number, resolution: number,
  make: (g: CanvasRenderingContext2D, pw: number, ph: number) => void,
): Texture {
  const canvas = makeCanvas(pw, ph);
  make(canvas.getContext("2d")!, pw, ph);
  return textureOf(canvas, resolution);
}

let white: Texture | null = null;

/** A 1×1 white texture for tinted rectangles (bars, washes, the darkness fill). */
export function whiteTexture(): Texture {
  if (!white) {
    const canvas = makeCanvas(1, 1);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 1, 1);
    white = textureOf(canvas, 1);
  }
  return white;
}

/** A radial light falloff sprite texture in one rgb colour. */
export function lightTexture(rgb: string): Texture {
  return textureOf(lightCanvas(rgb), 1);
}

/** A soft white ellipse (contact shadows, the creek pool). Tint it at the sprite. */
export function ellipseTexture(): Texture {
  return bakedTexture("ellipse", 64, 32, 1, (g) => {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(32, 16, 31, 15, 0, 0, Math.PI * 2);
    g.fill();
  });
}

/** A soft white circle (radio lamp, firefly core). */
export function circleTexture(): Texture {
  return bakedTexture("circle", 32, 32, 1, (g) => {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
  });
}

/** A white diamond (the ward marker). Tint it at the sprite. */
export function diamondTexture(): Texture {
  return bakedTexture("diamond", 28, 28, 1, (g) => {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(14, 1);
    g.lineTo(27, 14);
    g.lineTo(14, 27);
    g.lineTo(1, 14);
    g.closePath();
    g.fill();
  });
}

/** The vertical gradient of a lit window pane (warm top, ember bottom). */
export function windowGlowTexture(): Texture {
  return bakedTexture("winglow", 16, 32, 1, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, "rgba(255,210,120,1)");
    grad.addColorStop(1, "rgba(210,91,35,0.82)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 32);
  });
}

/** The darkness falloff: transparent at the lantern, near-opaque at the edge. */
export function darknessTexture(): Texture {
  return bakedTexture("darkness", 256, 256, 1, (g) => {
    const grad = g.createRadialGradient(128, 128, 57, 128, 128, 128);
    grad.addColorStop(0, "rgba(4,2,8,0)");
    grad.addColorStop(0.55, "rgba(4,2,8,0.3)");
    grad.addColorStop(0.78, "rgba(4,2,8,0.6)");
    grad.addColorStop(1, "rgba(4,2,8,0.965)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
}

/** A vertical fog band: transparent at both edges, mist in the middle. */
export function fogTexture(): Texture {
  return bakedTexture("fog", 16, 64, 1, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "rgba(145,132,151,0)");
    grad.addColorStop(0.5, "rgba(145,132,151,1)");
    grad.addColorStop(1, "rgba(145,132,151,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 64);
  });
}

export interface LabelTex { tex: Texture; w: number; h: number }

/**
 * A baked text label (optionally on a rounded plate). The world size is derived
 * from the measured text so the sprite needs no scaling. Rebuilt per key.
 */
export function labelTexture(
  key: string, text: string, font: string, color: string,
  opts: { bg?: string; h: number; padX: number },
): LabelTex {
  const asc = getArtScale();
  const w = measureTextWidth(text, font) + opts.padX * 2;
  const h = opts.h;
  const tex = bakedTexture(`label|${key}|${asc}`, Math.ceil(w * asc), Math.ceil(h * asc), asc, (g, pw, ph) => {
    if (opts.bg) {
      g.fillStyle = opts.bg;
      g.beginPath();
      g.roundRect(0, 0, pw, ph, 5 * asc);
      g.fill();
    }
    g.font = font.replace(/(\d+(?:\.\d+)?)px/, (_, n) => `${Number(n) * asc}px`);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, pw / 2, ph / 2 + asc * 0.5, pw - 4 * asc);
  });
  return { tex, w, h };
}

/** Word-wrap for notes and bubbles: at most `maxLines` lines within `width`. */
export function wrapText(text: string, width: number, font: string, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (measureTextWidth(test, font) > width && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && measureTextWidth(`${lines[maxLines - 1]}…`, font) > width) {
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1);
  }
  if (lines.length === maxLines) lines[maxLines - 1] += "…";
  return lines;
}
