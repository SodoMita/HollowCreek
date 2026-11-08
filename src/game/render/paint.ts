// Canvas helpers for the baking side of the renderer. Everything here runs at
// load time or when a cached layer is rebuilt — never inside the frame loop.
// The Pixi renderer uploads the resulting canvases as GPU textures once.

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

const lightCanvases = new Map<string, HTMLCanvasElement>();

/** A radial light falloff (opaque core → transparent edge) in one rgb colour. */
export function lightCanvas(rgb: string): HTMLCanvasElement {
  let canvas = lightCanvases.get(rgb);
  if (canvas) return canvas;
  canvas = makeCanvas(128, 128);
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${rgb},1)`);
  grad.addColorStop(0.45, `rgba(${rgb},0.35)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  lightCanvases.set(rgb, canvas);
  return canvas;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/** Width of a string in a font. Labels are baked once, so widths are cached. */
export function measureTextWidth(text: string, font: string): number {
  const key = `${font}\u0000${text}`;
  let width = widthCache.get(key);
  if (width === undefined) {
    measureCtx ??= makeCanvas(4, 4).getContext("2d");
    if (!measureCtx) return text.length * 6;
    measureCtx.font = font;
    width = measureCtx.measureText(text).width;
    if (widthCache.size > 800) widthCache.clear();
    widthCache.set(key, width);
  }
  return width;
}
