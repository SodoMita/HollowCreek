// Structures and standing props: station frames, bell tower, cages, supply cart,
// kits, cage key, timepieces and door keys. Zero per-frame paths or text layout.
import { BELL_X } from "../types";
import { drawSvg } from "../svg-assets";
import { getPillBadge, light } from "./paint";
import type { View } from "./view";

export const STRUCTURE_BOX = {
  "pumpkin-shed": [-90, -110, 180, 116],
  well: [-60, -100, 120, 106],
  scarecrow: [-60, -120, 120, 124],
  lantern: [-40, -115, 80, 119],
  chapel: [-140, -470, 280, 476],
  mill: [-95, -120, 190, 124],
  "mill-sails": [-46, -46, 92, 92],
  graves: [-75, -50, 200, 60],
  radio: [-70, -210, 140, 214],
  silo: [-45, -180, 90, 184],
  "cage-back": [-40, -112, 80, 112],
  "cage-front": [-40, -112, 80, 112],
  "bell-tower": [-50, -186, 100, 190],
  bell: [-18, -8, 36, 40],
} as const;

export type StructureName = keyof typeof STRUCTURE_BOX;

export function drawStructure(ctx: CanvasRenderingContext2D, name: StructureName, variant?: "broken" | "trim"): boolean {
  const [x, y, w, h] = STRUCTURE_BOX[name];
  return drawSvg(ctx, `structures/${variant ? `${name}-${variant}` : name}.svg`, x, y, w, h);
}

export function drawKit(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  drawSvg(ctx, "props/supply-kit.svg", x - 19, ground - 28, 38, 28);
}

export function drawCart(v: View) {
  const { ctx, w, cam, ground, snap } = v;
  const x = snap.cartX - cam;
  if (x <= -90 || x >= w + 90) return;
  if (drawSvg(ctx, "props/supply-cart.svg", x - 50, ground - 82, 100, 82)) {
    const sign = getPillBadge("cart:SUPPLIES", "SUPPLIES", "bold 11px Georgia, serif", "rgba(0,0,0,0)", "#e4cba8", 4, 15);
    ctx.drawImage(sign.canvas, x - sign.w / 2, ground - 86, sign.w, sign.h);
  }
  if (snap.cartPushers > 0) {
    const label = `${snap.cartPushers} PUSHING`;
    const badge = getPillBadge(`push:${label}`, label, "bold 10px system-ui, sans-serif", "rgba(0,0,0,0)", "#e9dfcf", 4, 14);
    ctx.drawImage(badge.canvas, x - badge.w / 2, ground - 100, badge.w, badge.h);
  }
}

export function drawKits(v: View) {
  const { ctx, w, cam, ground, snap } = v;
  for (const drop of snap.supplyDrops) {
    const sx = drop - cam;
    if (sx > -45 && sx < w + 45) drawKit(ctx, sx, ground);
  }
}

export function drawBellTower(v: View) {
  const { ctx, t, ground, now, snap, w, cam } = v;
  const x = BELL_X - cam;
  if (x < -200 || x > w + 200) return;
  const ringing = now - snap.bellAt < 4000;
  const swing = ringing ? Math.sin(t * 9) * 0.5 : Math.sin(t * 0.8) * 0.04;
  drawSvg(ctx, "structures/bell-tower.svg", x - 50, ground - 186, 100, 190);
  ctx.save();
  ctx.translate(x, ground - 143);
  ctx.rotate(swing);
  drawStructure(ctx, "bell");
  if (ringing) {
    ctx.strokeStyle = "rgba(255,215,130,0.5)";
    ctx.lineWidth = 2;
    for (const r of [26, 38]) {
      ctx.beginPath(); ctx.arc(0, 12, r, -0.6, 0.6); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 12, r, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke();
    }
  }
  ctx.restore();
  // Rope as a thin 2px strip; when calm it's vertical, when ringing it tilts slightly.
  ctx.fillStyle = "#5a4a30";
  if (!ringing) ctx.fillRect(x + 5, ground - 120, 2, 90);
  else {
    ctx.strokeStyle = "#5a4a30";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, ground - 120);
    ctx.lineTo(x + 6 + Math.sin(t * 9) * 6, ground - 30);
    ctx.stroke();
  }
}

export function drawCage(v: View, worldX: number, front: boolean) {
  const x = worldX - v.cam;
  if (x < -120 || x > v.w + 120) return;
  drawSvg(v.ctx, front ? "structures/cage-front.svg" : "structures/cage-back.svg", x - 40, v.ground - 112, 80, 112);
}

export function drawKey(v: View) {
  const { ctx, t, cam, ground, snap, w, glow } = v;
  if (snap.keyX === null) return;
  const kx = snap.keyX - cam;
  if (kx < -40 || kx > w + 40) return;
  const bob = Math.sin(t * 3) * 4;
  if (glow) light(ctx, kx, ground - 16 + bob, 18, 18, "255,215,106", 0.45);
  drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32);
}

export function drawTimepieces(v: View) {
  const { ctx, w, t, cam, ground, snap, glow } = v;
  const pieces: number[] = Array.isArray(snap.timepieces) && snap.timepieces.length ? snap.timepieces
    : typeof snap.timepieceX === "number" ? [snap.timepieceX] : [];
  for (const px of pieces) {
    const tx = px - cam;
    if (tx <= -50 || tx >= w + 50) continue;
    const bob = Math.sin(t * 2.4 + px) * 3;
    if (glow) light(ctx, tx, ground - 24 + bob, 22, 26, "156,218,211", 0.5);
    drawSvg(ctx, "props/timepiece.svg", tx - 18, ground - 48 + bob, 36, 48);
  }
}

export function drawDoorKeys(v: View) {
  const { ctx, t, cam, ground, snap, w, glow } = v;
  for (const d of snap.doors ?? []) {
    if (d.keyX === null) continue;
    const kx = d.keyX - cam;
    if (kx < -30 || kx > w + 30) continue;
    const bob = Math.sin(t * 3) * 3;
    if (glow) light(ctx, kx, ground - 16 + bob, 14, 14, "255,213,120", 0.45);
    drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32);
  }
}
