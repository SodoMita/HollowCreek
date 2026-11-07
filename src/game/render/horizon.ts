// Horizon layer: two rows of hills, the wooded treeline, and street props.
import { drawStreetDressing } from "../atmosphere";
import { WORLD_MIN } from "../buildings";
import { drawTree } from "./tree";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";

export function drawHorizon(f: Frame, env: DrawEnv) {
  const { ctx, w, cam, ground } = f;

  // --- two layers of hills, then an irregular wooded horizon ---
  ctx.fillStyle = "#2a1828";
  ctx.beginPath(); ctx.moveTo(0, ground);
  for (let sx = 0; sx <= w + 20; sx += 20) {
    const wx = sx + cam * 0.09;
    ctx.lineTo(sx, ground - 135 - Math.sin(wx * 0.0021 + 1) * 48 - Math.sin(wx * 0.006) * 22);
  }
  ctx.lineTo(w, ground); ctx.fill();
  ctx.fillStyle = "#1b121d";
  ctx.beginPath(); ctx.moveTo(0, ground);
  for (let sx = 0; sx <= w + 20; sx += 20) {
    const wx = sx + cam * 0.15;
    ctx.lineTo(sx, ground - 82 - Math.sin(wx * 0.004) * 38 - Math.sin(wx * 0.0013 + 3) * 48);
  }
  ctx.lineTo(w, ground); ctx.fill();

  for (let i = 0; i < 92; i++) {
    const wx = WORLD_MIN + i * 155 + ((i * 97) % 60);
    const sx = wx - cam * 0.45;
    if (sx < -150 || sx > w + 150) continue;
    const th = 74 + ((i * 53) % 56);
    drawTree(ctx, sx, ground, th, i, env);
    // the fen and the ridge grow wild: doubled groves where the village ends
    if (wx < -2650 || wx > 7350) drawTree(ctx, sx + 62, ground, th * 0.82, i + 7, env);
  }

  // The horizon is wilderness: no backdrop village, only woods and props.
  drawStreetDressing(ctx, cam, w, ground);
}
