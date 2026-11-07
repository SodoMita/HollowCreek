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
  // Rutted road (patterned, kept in code), then stumps, leaf piles, and a broken fence rhythm (SVG).
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
    drawSvg(ctx, "scenery/stump.svg", sx - 30, ground + 2, 60, 12);
    drawSvg(ctx, "scenery/leaf-pile.svg", sx - 24, ground + 1, 44, 8);
  }
  if (graphics.quality !== "low") {
    for (let i = 0; i < 34; i++) {
      const fx = WORLD_MIN + i * 320 - cam;
      if (fx < -80 || fx > w + 80) continue;
      const fy = ground + 48 + (i % 3) * 3;
      drawSvg(ctx, "props/broken-fence.svg", fx - 6, fy - 34, 86, 38);
    }
    for (let i = 0; i < 42; i++) {
      const sx = WORLD_MIN + i * 260 + 60 - cam;
      if (sx < 0 || sx > w) continue;
      const rx = 4 + i % 5;
      drawSvg(ctx, "scenery/pebble.svg", sx - rx, ground + 25, rx * 2, 4);
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
  ctx.save();
  ctx.globalAlpha = a;
  drawSvg(ctx, "scenery/meeting-square.svg", MEETING_FROM - cam, ground - 200, MEETING_TO - MEETING_FROM, 240);
  ctx.restore();
}
