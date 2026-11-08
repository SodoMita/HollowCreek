// Structures and standing props: the station frames, the bell tower, the cages,
// the supply cart and its kits, the cage key, the timepieces and the house keys.
// Structures are SVG art in a fixed world box, so each frame is a bitmap copy.
import { BELL_X } from "../types";
import { drawSvg } from "../svg-assets";
import { light } from "./paint";
import type { View } from "./view";

/** Each structure's box in world units, relative to the road point at (0, 0). */
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

/** Draws structures/<name>[-<variant>].svg in its box, in a context already at the road point. */
export function drawStructure(ctx: CanvasRenderingContext2D, name: StructureName, variant?: "broken" | "trim"): boolean {
  const [x, y, w, h] = STRUCTURE_BOX[name];
  return drawSvg(ctx, `structures/${variant ? `${name}-${variant}` : name}.svg`, x, y, w, h);
}

/** A small crate of boards, wire, iron and lamp oil. */
export function drawKit(ctx: CanvasRenderingContext2D, x: number, ground: number) {
  drawSvg(ctx, "props/supply-kit.svg", x - 19, ground - 28, 38, 28);
}

/** The supply cart, its sign, and the count of hands pushing it. */
export function drawCart(v: View) {
  const { ctx, w, cam, ground, snap } = v;
  const x = snap.cartX - cam;
  if (x > -90 && x < w + 90) {
    if (drawSvg(ctx, "props/supply-cart.svg", x - 50, ground - 82, 100, 82)) {
      ctx.font = "bold 11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e4cba8";
      ctx.fillText("SUPPLIES", x, ground - 75);
    }
    if (snap.cartPushers > 0) {
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e9dfcf";
      ctx.fillText(`${snap.cartPushers} PUSHING`, x, ground - 89);
    }
  }
}

/** Supply kits lying on the road after a drop. */
export function drawKits(v: View) {
  const { ctx, w, cam, ground, snap } = v;
  for (const drop of snap.supplyDrops) {
    const sx = drop - cam;
    if (sx > -45 && sx < w + 45) drawKit(ctx, sx, ground);
  }
}

/** The bell tower: the frame is art; the bell swings and the rope follows it. */
export function drawBellTower(v: View) {
  const { ctx, t, ground, now, snap, w, cam } = v;
  const x = BELL_X - cam;
  if (x < -200 || x > w + 200) return;
  const ringing = now - snap.bellAt < 4000;
  const swing = ringing ? Math.sin(t * 9) * 0.5 : Math.sin(t * 0.8) * 0.04;
  ctx.save();
  ctx.translate(x, ground);
  drawStructure(ctx, "bell-tower");
  ctx.restore();
  // A crossbeam over the bell, so it visibly hangs in the belfry instead of floating
  // between two posts that read as almost black at dusk.
  ctx.fillStyle = "#3a2519";
  ctx.fillRect(x - 30, ground - 154, 60, 6);
  ctx.fillStyle = "rgba(255,214,150,.10)";
  ctx.fillRect(x - 30, ground - 154, 60, 1.5);
  ctx.save();
  ctx.translate(x, ground - 143);
  ctx.rotate(swing);
  ctx.strokeStyle = "#2a1a12";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(0, 0);
  ctx.stroke();
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
  ctx.strokeStyle = "#5a4a30";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 6, ground - 120);
  ctx.lineTo(x + 6 + (ringing ? Math.sin(t * 9) * 6 : 0), ground - 30);
  ctx.stroke();
}

/** A prisoner's cage: the back frame behind the figure, the bars in front of it. */
export function drawCage(v: View, worldX: number, front: boolean) {
  const x = worldX - v.cam;
  if (x < -120 || x > v.w + 120) return;
  v.ctx.save();
  v.ctx.translate(x, v.ground);
  drawStructure(v.ctx, front ? "cage-front" : "cage-back");
  v.ctx.restore();
}

/** The cage key on the road, bobbing. */
export function drawKey(v: View) {
  const { ctx, t, cam, ground, snap, w, glow } = v;
  if (snap.keyX === null) return;
  const kx = snap.keyX - cam;
  if (kx < -40 || kx > w + 40) return;
  const bob = Math.sin(t * 3) * 4;
  if (glow) light(ctx, kx, ground - 16 + bob, 18, 18, "255,215,106", 0.45);
  drawSvg(ctx, "props/key.svg", kx - 9, ground - 32 + bob, 18, 32);
}

/** Timepieces are collectibles; several can rest on the road at once. */
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

/** Each house has its own key, separate from the cage key. */
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
