// Ground layer: the road surface, ruts, stumps, fences and leaf piles, then the
// creek bridge and the meeting-square highlight.
import { drawCreekGlints } from "../atmosphere";
import { TREE_MAX, TREE_MIN, WORLD_MIN, treeX } from "../buildings";
import { drawSvg } from "../svg-assets";
import { MEETING_FROM, MEETING_TO } from "../types";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { GROUND_DUSK, GROUND_NIGHT, lerpHex } from "./palette";

export function drawGround(f: Frame, env: DrawEnv) {
  const { ctx, w, h, cam, ground, night, nb, graphics } = f;

  // --- ground ---
  const gg = env.grad(`ground:${ground}:${h}:${nb}`, () => {
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
}

/** Hollow Creek crosses the road's west end; drawn after the ground so the water
 *  and plank bridge sit in the foreground, in front of the road surface. */
export function drawCreek(f: Frame) {
  const { ctx, w, t, cam, ground } = f;
  const sx = -2660 - cam;
  if (sx > -300 && sx < w + 300) drawSvg(ctx, "props/creek-bridge.svg", sx, ground - 6, 260, 64);
  drawCreekGlints(ctx, cam, w, ground, t);
}

/** Pulsing highlight over the meeting square, only during a meeting. */
export function drawMeetingSquare(f: Frame) {
  const { ctx, t, cam, ground, snap } = f;
  if (snap.phase !== "meeting") return;
  const a = 0.08 + Math.sin(t * 3) * 0.03;
  ctx.fillStyle = `rgba(255,200,100,${a})`;
  ctx.fillRect(MEETING_FROM - cam, ground - 200, MEETING_TO - MEETING_FROM, 200 + 40);
}
