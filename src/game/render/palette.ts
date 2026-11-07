// Colour palettes for the sky, ground and falling leaves. The sky and ground
// lerp from dusk to deep night by the round's night value (0..1).

export const LEAF_COLORS = ["#b4552a", "#c9762f", "#8f3b1f", "#d99a3d", "#7a4a21"];

/** Dusk and deep-night sky palettes (top -> horizon). */
export const SKY_DUSK = ["#090b1b", "#211329", "#512534", "#9a4c2c", "#c0743c"];
export const SKY_NIGHT = ["#030309", "#0b0817", "#141021", "#241423", "#3a2030"];
export const GROUND_DUSK = ["#2b1a12", "#1d120c", "#0d0806"];
export const GROUND_NIGHT = ["#17100b", "#100a07", "#070403"];

/** Linear blend of two #rrggbb colours. */
export function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
