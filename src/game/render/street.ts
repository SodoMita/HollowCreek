// The road: its surface and ruts, stumps and leaf piles, fences and lantern posts,
// the creek bridge and its glints, and the meeting-square highlight.
import { BUILDINGS, TREE_MAX, TREE_MIN, WORLD_MIN, doorX, treeX } from "../buildings";
import { drawSvg } from "../svg-assets";
import { MEETING_FROM, MEETING_TO } from "../types";
import type { View } from "./view";

const FENCE_XS = [-3520, -3300, -2950, -2760, -2180, -1460, -1250, -700, -120, 420, 760, 1560, 1860, 2560, 2960, 3320, 3780, 4180, 4420, 5100, 5260, 5980, 6280, 6900, 7180, 7480, 7760, 8260, 8480];

export function drawRuts(v: View) {
  const { ctx, w, h, cam, ground, night, nb } = v;
  // Two faint wheel ruts, one path each.
  ctx.strokeStyle = "rgba(218,164,100,0.13)";
  ctx.lineWidth = 2;
  for (const offset of [19, 34]) {
    ctx.beginPath();
    for (let sx = 0; sx <= w; sx += 30) {
      const y = ground + offset + Math.sin((sx + cam) * 0.017) * 2;
      if (sx === 0) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    ctx.stroke();
  }
}

/** Stumps and leaf piles at each tree base, and on the quality presets, broken fences and pebbles. */
export function drawRoadDressing(v: View) {
  const { ctx, w, cam, ground, quality } = v;
  for (let i = TREE_MIN; i <= TREE_MAX; i++) {
    const sx = treeX(i) - cam;
    if (sx < -60 || sx > w + 60) continue;
    drawSvg(ctx, "scenery/stump.svg", sx - 30, ground + 2, 60, 12);
    drawSvg(ctx, "scenery/leaf-pile.svg", sx - 24, ground + 1, 44, 8);
  }
  if (quality === "low") return;
  for (let i = 0; i < 34; i++) {
    const fx = WORLD_MIN + i * 320 - cam;
    if (fx < -80 || fx > w + 80) continue;
    const fy = ground + 48 + (i % 3) * 3;
    drawSvg(ctx, "props/broken-fence.svg", fx - 6, fy - 34, 86, 38);
  }
  for (let i = 0; i < 42; i++) {
    const sx = WORLD_MIN + i * 260 + 60 - cam;
    if (sx < 0 || sx > w) continue;
    const rx = 4 + (i % 5);
    drawSvg(ctx, "scenery/pebble.svg", sx - rx, ground + 25, rx * 2, 4);
  }
}

/** Fences, door lanterns, woodpiles, windmills, graves and haystacks along the road. */
export function drawStreetProps(v: View) {
  const { ctx, w, cam, ground } = v;
  for (const fx of FENCE_XS) {
    const sx = fx - cam;
    if (sx < -160 || sx > w + 160) continue;
    drawSvg(ctx, "props/fence.svg", sx, ground - 46, 140, 46);
  }
  for (const b of BUILDINGS) {
    const lx = doorX(b) + b.side * 46 - cam;
    if (lx > -40 && lx < w + 40) drawSvg(ctx, "props/lantern-post.svg", lx, ground - 96, 30, 96);
  }
  for (const px of [-3378, 7252]) {
    const sx = px - cam;
    if (sx > -40 && sx < w + 40) drawSvg(ctx, "props/lantern-post.svg", sx, ground - 96, 30, 96);
  }
  for (const wx of [-3000, -560, 5300, 7860]) {
    const sx = wx - cam;
    if (sx > -80 && sx < w + 80) drawSvg(ctx, "props/woodpile.svg", sx - 32, ground - 44, 64, 44);
  }
  for (const mx of [-3320, 4350, 6620, 8330]) {
    const sx = mx - cam;
    if (sx > -150 && sx < w + 150) drawSvg(ctx, "props/windmill.svg", sx - 65, ground - 160, 130, 160);
  }
  for (const gx of [3110, 3265, 3345, 7222, 7382]) {
    const sx = gx - cam;
    if (sx > -50 && sx < w + 50) drawSvg(ctx, "props/gravestone.svg", sx - 17, ground - 46, 34, 46);
  }
  for (const hx of [195, 352]) {
    const sx = hx - cam;
    if (sx > -90 && sx < w + 90) drawSvg(ctx, "props/haystack.svg", sx - 35, ground - 52, 70, 52);
  }
}

/** Hollow Creek crosses the road's west end: the plank bridge, then cold glints on the water. */
export function drawCreek(v: View) {
  const { ctx, w, t, cam, ground } = v;
  const sx = -2660 - cam;
  if (sx > -300 && sx < w + 300) drawSvg(ctx, "props/creek-bridge.svg", sx, ground - 6, 260, 64);
  if (sx < -320 || sx > w + 320) return;
  ctx.fillStyle = "rgba(10,16,20,0.5)";
  ctx.beginPath();
  ctx.ellipse(sx + 130, ground + 34, 150, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    const gx = sx + 22 + i * 34 + Math.sin(t * 1.1 + i * 1.9) * 9;
    const gy = ground + 26 + (i % 3) * 7;
    const a = 0.05 + 0.07 * Math.max(0, Math.sin(t * 1.6 + i * 2.3));
    ctx.strokeStyle = `rgba(156,218,211,${a})`;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + 15, gy);
    ctx.stroke();
  }
}

/** Pulsing highlight over the meeting square, only during a meeting. */
export function drawMeetingSquare(v: View) {
  if (v.snap.phase !== "meeting") return;
  const { ctx, t, cam, ground } = v;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = 0.08 + Math.sin(t * 3) * 0.03;
  drawSvg(ctx, "scenery/meeting-square.svg", MEETING_FROM - cam, ground - 200, MEETING_TO - MEETING_FROM, 240);
  ctx.globalAlpha = prev;
}
