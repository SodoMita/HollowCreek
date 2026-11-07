// Standing props on the road: the bell tower, cages, the key, timepieces and the
// per-house door keys. Each is drawn in its own function so the orchestrator reads as a list.
import { drawSvg } from "../svg-assets";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";

/** The bell tower: two legs, a pitched cap, a swinging bell, and a rope. */
export function drawBellTower(ctx: CanvasRenderingContext2D, x: number, ground: number, t: number, ringing: boolean) {
  ctx.save();
  ctx.strokeStyle = "#241611";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x - 42, ground); ctx.lineTo(x - 14, ground - 150);
  ctx.moveTo(x + 42, ground); ctx.lineTo(x + 14, ground - 150);
  ctx.stroke();
  ctx.fillStyle = "#1c100c";
  ctx.beginPath();
  ctx.moveTo(x - 30, ground - 148); ctx.lineTo(x + 30, ground - 148); ctx.lineTo(x, ground - 178);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(x - 24, ground - 152, 48, 7);
  // bell
  const swing = ringing ? Math.sin(t * 9) * 0.5 : Math.sin(t * 0.8) * 0.04;
  ctx.translate(x, ground - 143);
  ctx.rotate(swing);
  ctx.fillStyle = "#8a6b2a";
  ctx.beginPath();
  ctx.moveTo(-13, 22);
  ctx.quadraticCurveTo(-13, -2, 0, -4);
  ctx.quadraticCurveTo(13, -2, 13, 22);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#6b5220";
  ctx.fillRect(-15, 20, 30, 5);
  ctx.beginPath(); ctx.arc(0, 28, 3.4, 0, Math.PI * 2); ctx.fill();
  if (ringing) {
    ctx.strokeStyle = "rgba(255,215,130,0.5)";
    ctx.lineWidth = 2;
    for (const r of [26, 38]) { ctx.beginPath(); ctx.arc(0, 12, r, -0.6, 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 12, r, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke(); }
  }
  ctx.restore();
  // rope
  ctx.strokeStyle = "#5a4a30";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 6, ground - 120); ctx.lineTo(x + 6 + (ringing ? Math.sin(t * 9) * 6 : 0), ground - 30); ctx.stroke();
}

/** A prisoner's cage. `front` draws the bars in front of the figure; otherwise the back frame. */
export function drawCage(ctx: CanvasRenderingContext2D, x: number, ground: number, front: boolean) {
  const wHalf = 32, top = ground - 96;
  ctx.save();
  if (!front) {
    ctx.fillStyle = "rgba(15,10,14,0.6)";
    ctx.fillRect(x - wHalf, top, wHalf * 2, 96);
    ctx.strokeStyle = "#2e2a33";
    ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(x + i * 12, top + 4); ctx.lineTo(x + i * 12, ground); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "#4a4552";
    ctx.lineWidth = 3.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(x + i * 12 + 5, top + 2); ctx.lineTo(x + i * 12 + 5, ground); ctx.stroke();
    }
    ctx.strokeStyle = "#57515f";
    ctx.lineWidth = 5;
    ctx.strokeRect(x - wHalf, top, wHalf * 2, 96);
    ctx.beginPath(); ctx.moveTo(x - wHalf, top + 30); ctx.lineTo(x + wHalf, top + 30); ctx.stroke();
    // hanging chain
    ctx.strokeStyle = "#3a3542";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top - 16); ctx.stroke();
  }
  ctx.restore();
}

/** The cage key on the road, bobbing. */
export function drawKey(f: Frame, env: DrawEnv) {
  const { ctx, t, cam, ground, snap } = f;
  if (snap.keyX === null) return;
  const kx = snap.keyX - cam;
  const bob = Math.sin(t * 3) * 4;
  ctx.save();
  ctx.shadowColor = "#ffd76a";
  env.glow(ctx, 16);
  ctx.strokeStyle = "#e8b93c";
  ctx.lineWidth = 3.5;
  if (!drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32)) {
    ctx.beginPath(); ctx.arc(kx, ground - 26 + bob, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kx, ground - 20 + bob); ctx.lineTo(kx, ground - 6 + bob);
    ctx.moveTo(kx, ground - 10 + bob); ctx.lineTo(kx + 6, ground - 10 + bob);
    ctx.moveTo(kx, ground - 6 + bob); ctx.lineTo(kx + 5, ground - 6 + bob); ctx.stroke();
  }
  ctx.restore();
}

/** Timepieces are collectibles; several can rest on the road at once. */
export function drawTimepieces(f: Frame, env: DrawEnv) {
  const { ctx, w, t, cam, ground, snap } = f;
  const pieceXs = Array.isArray(snap.timepieces) && snap.timepieces.length ? snap.timepieces
    : (typeof snap.timepieceX === "number" ? [snap.timepieceX] : []);
  for (const px of pieceXs) {
    const tx = px - cam, bob = Math.sin(t * 2.4 + px) * 3;
    if (tx > -50 && tx < w + 50) {
      ctx.save(); ctx.shadowColor = "#9cdad3"; env.glow(ctx, 20);
      if (!drawSvg(ctx, "props/timepiece.svg", tx - 18, ground - 48 + bob, 36, 48)) {
        ctx.fillStyle = "#a8d2cf"; ctx.beginPath(); ctx.arc(tx, ground - 24 + bob, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ebc988"; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/** Each house has its own identifiable key, separate from the cage key. */
export function drawDoorKeys(f: Frame, env: DrawEnv) {
  const { ctx, t, cam, ground, snap } = f;
  for (const d of snap.doors ?? []) {
    if (d.keyX === null) continue;
    const kx = d.keyX - cam;
    if (kx < -30 || kx > f.w + 30) continue;
    ctx.save(); ctx.strokeStyle = "#dfad55"; ctx.lineWidth = 3;
    ctx.shadowColor = "#ffd578"; env.glow(ctx, 12);
    const bob = Math.sin(t * 3) * 3;
    if (!drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32)) {
      ctx.beginPath(); ctx.arc(kx, ground - 25 + bob, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(kx, ground - 20 + bob); ctx.lineTo(kx, ground - 7 + bob);
      ctx.lineTo(kx + 5, ground - 7 + bob); ctx.moveTo(kx, ground - 12 + bob); ctx.lineTo(kx + 5, ground - 12 + bob); ctx.stroke();
    }
    ctx.restore();
  }
}
