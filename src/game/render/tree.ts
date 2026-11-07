// One tree on the horizon: a sprite when the art loads, otherwise a drawn fallback.
import { drawSvg } from "../svg-assets";
import type { DrawEnv } from "./env";

export function drawTree(ctx: CanvasRenderingContext2D, x: number, ground: number, height: number, seed: number, env: DrawEnv) {
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
  const clusters = env.qualityCount(8, 6, 4);
  for (let j = 0; j < clusters; j++) {
    const angle = j * 2.4 + seed;
    const cx = x + Math.sin(angle) * (15 + (j % 3) * 6);
    const cy = top + 9 + Math.cos(angle * 1.3) * 15 + j * 2.2;
    const radius = 17 + ((seed * 13 + j * 7) % 13);
    ctx.fillStyle = palette[j % palette.length];
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  }
  if (env.settings.graphics.quality === "high") {
    ctx.fillStyle = "rgba(207,105,43,.22)";
    for (let j = 0; j < 7; j++) {
      const lx = x - 28 + ((seed * 31 + j * 17) % 58);
      const ly = top - 9 + ((seed * 19 + j * 23) % 50);
      ctx.beginPath(); ctx.arc(lx, ly, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
