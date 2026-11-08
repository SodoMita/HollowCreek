// Painting primitives shared by the scene modules.
//
// Light is a pre-rendered radial sprite, not shadowBlur. The browser recomputes a
// shadow blur for every glowing object on every frame; a sprite is one bitmap copy
// with the same falloff.

const lightCache = new Map<string, HTMLCanvasElement>();
const widthCache = new Map<string, number>();

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

/** Width of a string in a font. Labels repeat every frame, so widths are cached. */
export function textWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  let width = widthCache.get(key);
  if (width === undefined) {
    ctx.font = font;
    width = ctx.measureText(text).width;
    if (widthCache.size > 800) widthCache.clear();
    widthCache.set(key, width);
  }
  return width;
}
