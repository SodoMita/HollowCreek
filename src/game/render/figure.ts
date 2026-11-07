// A hooded traveller: the sprite when it loads, otherwise the drawn figure.
import { drawTraveler } from "../svg-assets";
import type { DrawEnv } from "./env";

export function drawFigure(
  ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
  facing: number, moving: boolean, ghost: boolean, redEyes: boolean, t: number, scale: number, env: DrawEnv,
) {
  const gait = Math.sin(t * 11 + x * 0.1);
  const bob = moving ? gait * 1.8 : Math.sin(t * 1.7 + x) * 0.35;
  const y = groundY + bob;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);
  const pose = moving ? (gait > 0.25 ? 1 : gait < -0.25 ? -1 : 0) : 0;
  if (drawTraveler(ctx, color, redEyes, ghost, pose)) { ctx.restore(); return; }
  ctx.lineCap = "round";

  if (!ghost) {
    const swing = moving ? gait * 5 : 0;
    ctx.strokeStyle = "#100d13"; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-4, -14); ctx.lineTo(-4 + swing, -1); ctx.lineTo(-1 + swing, 0);
    ctx.moveTo(4, -14); ctx.lineTo(4 - swing, -1); ctx.lineTo(7 - swing, 0);
    ctx.stroke();
  }

  // Rear sleeve and arm make the walking direction legible at small sizes.
  ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-6, -33); ctx.lineTo(-12 - (moving ? gait * 3 : 0), -18); ctx.stroke();

  // Cloak silhouette, hem, and a shaded fold down the trailing side.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-12, -12);
  ctx.quadraticCurveTo(-15, -32, -8, -41);
  ctx.quadraticCurveTo(0, -49, 9, -41);
  ctx.quadraticCurveTo(15, -30, 12, -12);
  if (ghost) { ctx.lineTo(8, -5); ctx.lineTo(3, -12); ctx.lineTo(-2, -5); ctx.lineTo(-7, -12); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(5,3,9,.3)";
  ctx.beginPath();
  ctx.moveTo(-12, -12); ctx.quadraticCurveTo(-15, -32, -8, -41);
  ctx.quadraticCurveTo(-4, -34, -5, -12); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,235,210,.13)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(5, -28); ctx.quadraticCurveTo(8, -20, 7, -12); ctx.stroke();

  // Front sleeve and a small metal clasp break up the single-color body.
  ctx.strokeStyle = color; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(7, -33); ctx.lineTo(13 + (moving ? gait * 3 : 0), -20); ctx.stroke();
  ctx.fillStyle = "#c5a56a"; ctx.beginPath(); ctx.arc(3, -29, 1.4, 0, Math.PI * 2); ctx.fill();

  // Raised hood rim around a genuinely dark face opening.
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(2, -38, 11, 10, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(240,215,190,.16)"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(3, -37, 8.5, 7.5, -0.1, Math.PI * 0.75, Math.PI * 2.15); ctx.stroke();
  ctx.fillStyle = "#09070d";
  ctx.beginPath(); ctx.ellipse(4, -36.5, 7.2, 6.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = redEyes ? "#ff5142" : "#eee6ce";
  ctx.shadowColor = redEyes ? "#ff4a3a" : "#e8e0c8";
  env.glow(ctx, 5);
  ctx.beginPath(); ctx.arc(3, -37, 1.5, 0, Math.PI * 2); ctx.arc(8, -37, 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
