// The road: wheel ruts (pre-baked tile), stumps and leaf piles, fences, lantern
// posts, the creek bridge and glints, and the meeting-square highlight. Zero
// per-frame path builds; visible index ranges computed directly from cam.
import { BUILDINGS, TREE_MAX, TREE_MIN, WORLD_MIN, doorX, treeX } from "../buildings";
import { drawSvg } from "../svg-assets";
import { MEETING_FROM, MEETING_TO } from "../types";
import { TREE_SPACING } from "../units";
import { makeCanvas } from "./paint";
import type { View } from "./view";

const FENCE_XS = [-3520, -3300, -2950, -2760, -2180, -1460, -1250, -700, -120, 420, 760, 1560, 1860, 2560, 2960, 3320, 3780, 4180, 4420, 5100, 5260, 5980, 6280, 6900, 7180, 7480, 7760, 8260, 8480];
const WOOD_XS = [-3000, -560, 5300, 7860];
const WIND_XS = [-3320, 4350, 6620, 8330];
const GRAVE_XS = [3110, 3265, 3345, 7222, 7382];
const HAY_XS = [195, 352];
const VOTIVE_XS = [-3378, 7252];

const RUT_PERIOD = 370; // closest integer period for sin(x * 0.017) -> 2*pi/0.017 ≈ 369.6
let rutTile: HTMLCanvasElement | null = null;
function getRutTile(): HTMLCanvasElement {
  if (rutTile) return rutTile;
  const c = makeCanvas(RUT_PERIOD, 44);
  const g = c.getContext("2d")!;
  g.strokeStyle = "rgba(218,164,100,0.13)";
  g.lineWidth = 2;
  for (const offset of [6, 21]) {
    g.beginPath();
    for (let x = 0; x <= RUT_PERIOD; x += 10) {
      const y = offset + Math.sin((x / RUT_PERIOD) * Math.PI * 2) * 2;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  rutTile = c;
  return c;
}

export function drawRuts(v: View) {
  const tile = getRutTile();
  const { ctx, w, cam, ground } = v;
  const start = -(((cam % RUT_PERIOD) + RUT_PERIOD) % RUT_PERIOD);
  for (let x = start; x < w; x += RUT_PERIOD) ctx.drawImage(tile, x, ground + 13);
}

/** Stumps and leaf piles at visible trees; broken fences and pebbles on medium/high. */
export function drawRoadDressing(v: View) {
  const { ctx, w, cam, ground, quality } = v;
  const i0 = Math.max(TREE_MIN, Math.floor((cam - 150 - -1500) / TREE_SPACING) - 1);
  const i1 = Math.min(TREE_MAX, Math.ceil((cam + w + 150 - -1500) / TREE_SPACING) + 1);
  for (let i = i0; i <= i1; i++) {
    const sx = treeX(i) - cam;
    if (sx < -60 || sx > w + 60) continue;
    drawSvg(ctx, "scenery/stump.svg", sx - 30, ground - 4, 60, 12);
    drawSvg(ctx, "scenery/leaf-pile.svg", sx - 24, ground - 3, 44, 8);
  }
  if (quality === "low") return;
  const f0 = Math.max(0, Math.floor((cam - 80 - WORLD_MIN) / 320));
  const f1 = Math.min(33, Math.ceil((cam + w + 80 - WORLD_MIN) / 320));
  for (let i = f0; i <= f1; i++) {
    const fx = WORLD_MIN + i * 320 - cam;
    if (fx < -80 || fx > w + 80) continue;
    const fy = ground + 48 + (i % 3) * 3;
    drawSvg(ctx, "props/broken-fence.svg", fx - 6, fy - 34, 86, 38);
  }
  const p0 = Math.max(0, Math.floor((cam - 20 - (WORLD_MIN + 60)) / 260));
  const p1 = Math.min(41, Math.ceil((cam + w + 20 - (WORLD_MIN + 60)) / 260));
  for (let i = p0; i <= p1; i++) {
    const sx = WORLD_MIN + i * 260 + 60 - cam;
    if (sx < -10 || sx > w + 10) continue;
    const rx = 4 + (i % 5);
    drawSvg(ctx, "scenery/pebble.svg", sx - rx, ground + 25, rx * 2, 4);
  }
}

/** Fences, door lanterns, woodpiles, windmills, graves and haystacks along the road. */
export function drawStreetProps(v: View) {
  const { ctx, w, cam, ground } = v;
  for (const fx of FENCE_XS) {
    const sx = fx - cam;
    if (sx > -160 && sx < w + 160) drawSvg(ctx, "props/fence.svg", sx, ground - 46, 140, 46);
  }
  for (const b of BUILDINGS) {
    const lx = doorX(b) + b.side * 46 - cam;
    if (lx > -40 && lx < w + 40) drawSvg(ctx, "props/lantern-post.svg", lx, ground - 96, 30, 96);
  }
  for (const px of VOTIVE_XS) {
    const sx = px - cam;
    if (sx > -40 && sx < w + 40) drawSvg(ctx, "props/lantern-post.svg", sx, ground - 96, 30, 96);
  }
  for (const wx of WOOD_XS) {
    const sx = wx - cam;
    if (sx > -80 && sx < w + 80) drawSvg(ctx, "props/woodpile.svg", sx - 32, ground - 44, 64, 44);
  }
  for (const mx of WIND_XS) {
    const sx = mx - cam;
    if (sx > -150 && sx < w + 150) drawSvg(ctx, "props/windmill.svg", sx - 65, ground - 160, 130, 160);
  }
  for (const gx of GRAVE_XS) {
    const sx = gx - cam;
    if (sx > -50 && sx < w + 50) drawSvg(ctx, "props/gravestone.svg", sx - 17, ground - 46, 34, 46);
  }
  for (const hx of HAY_XS) {
    const sx = hx - cam;
    if (sx > -90 && sx < w + 90) drawSvg(ctx, "props/haystack.svg", sx - 35, ground - 52, 70, 52);
  }
}

let creekPoolSprite: HTMLCanvasElement | null = null;
function getCreekPool(): HTMLCanvasElement {
  if (creekPoolSprite) return creekPoolSprite;
  const c = makeCanvas(304, 36);
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(10,16,20,0.5)";
  g.beginPath();
  g.ellipse(152, 18, 150, 16, 0, 0, Math.PI * 2);
  g.fill();
  creekPoolSprite = c;
  return c;
}

/** Hollow Creek crosses the road's west end: the plank bridge, water pool and glints. */
export function drawCreek(v: View) {
  const { ctx, w, t, cam, ground } = v;
  const sx = -2660 - cam;
  if (sx < -320 || sx > w + 320) return;
  drawSvg(ctx, "props/creek-bridge.svg", sx, ground - 6, 260, 64);
  ctx.drawImage(getCreekPool(), sx - 22, ground + 16);
  const prev = ctx.globalAlpha;
  ctx.fillStyle = "#9cdad3";
  for (let i = 0; i < 7; i++) {
    const gx = sx + 22 + i * 34 + Math.sin(t * 1.1 + i * 1.9) * 9;
    const gy = ground + 26 + (i % 3) * 7;
    ctx.globalAlpha = prev * (0.05 + 0.07 * Math.max(0, Math.sin(t * 1.6 + i * 2.3)));
    ctx.fillRect(gx, gy, 15, 1.4);
  }
  ctx.globalAlpha = prev;
}

/** Pulsing highlight over the meeting square, only during a meeting and in view. */
export function drawMeetingSquare(v: View) {
  if (v.snap.phase !== "meeting") return;
  const sx = MEETING_FROM - v.cam;
  const sw = MEETING_TO - MEETING_FROM;
  if (sx + sw < 0 || sx > v.w) return;
  const prev = v.ctx.globalAlpha;
  v.ctx.globalAlpha = prev * (0.08 + Math.sin(v.t * 3) * 0.03);
  drawSvg(v.ctx, "scenery/meeting-square.svg", sx, v.ground - 200, sw, 240);
  v.ctx.globalAlpha = prev;
}
