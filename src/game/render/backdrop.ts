// Sky, stars, moon, cloud banks, the two hill rows and the wooded treeline. These
// sit far from the road and change slowly: a handful of paths and sprites a frame.
import { WORLD_MIN } from "../buildings";
import { drawSvg } from "../svg-assets";
import { light, makeCanvas } from "./paint";
import { GROUND_DUSK, GROUND_NIGHT, SKY_DUSK, SKY_NIGHT, lerpHex } from "./palette";
import type { View } from "./view";

export function drawBackdrop(v: View) {
  const { ctx, w, h, t, cam, night, glow, quality } = v;

  drawSkyBake(v);

  drawStars(v);

  const mx = w * 0.78 - cam * 0.03;
  const my = h * 0.18;
  if (glow) {
    light(ctx, mx, my, 145, 145, "244,222,181", 0.18 + 0.12 * night);
    light(ctx, mx, my, 70, 70, "240,225,190", 0.5);
  }
  drawSvg(ctx, "scenery/moon.svg", mx - 42, my - 42, 84, 84);
  if (glow && quality !== "low") drawMoonRays(v, mx, my);

  drawHills(v);
  drawTreeline(v);

  if (quality !== "low") drawClouds(v);
}

/** Deterministic stars, fixed to the screen. Batched by brightness and colour: 10 fills, not 95. */
function drawStars(v: View) {
  const { ctx, w, ground, night, quality } = v;
  const count = quality === "high" ? 95 : quality === "medium" ? 48 : 18;
  for (let k = 0; k < 10; k++) {
    const warm = k >= 5;
    const level = k % 5;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (i % 5 !== level || (i % 9 === 0) !== warm) continue;
      const sx = ((i * 197.3 + 41) % (w + 160)) - 80;
      const sy = 18 + ((i * 83.7) % Math.max(60, ground * 0.52));
      const r = 0.45 + (i % 7 === 0 ? 0.85 : 0.25);
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
    }
    ctx.globalAlpha = (0.25 + level * 0.1) * (0.3 + 0.7 * night);
    ctx.fillStyle = warm ? "#ffd9a0" : "#d9d8ed";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Pale shafts of moonlight through the valley haze. Three plain gradient wedges. */
function drawMoonRays(v: View, mx: number, my: number) {
  const { ctx, t, night } = v;
  for (let i = 0; i < 3; i++) {
    const ang = 1.85 + i * 0.24 + Math.sin(t * 0.05 + i * 2.1) * 0.03;
    const len = 330 + i * 60;
    const spread = 26 + i * 10;
    const ex = mx + Math.cos(ang) * len;
    const ey = my + Math.sin(ang) * len;
    const g = ctx.createLinearGradient(mx, my, ex, ey);
    const a = 0.028 + 0.03 * night;
    g.addColorStop(0, `rgba(232,214,178,${a})`);
    g.addColorStop(1, "rgba(232,214,178,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(ex - spread, ey);
    ctx.lineTo(ex + spread, ey);
    ctx.closePath();
    ctx.fill();
  }
}

/** Two rows of hills, each one path that follows a slow sine of the camera. */
function drawHills(v: View) {
  const { ctx, w, cam, ground } = v;
  ctx.fillStyle = "#2a1828";
  ctx.beginPath();
  ctx.moveTo(0, ground);
  for (let sx = 0; sx <= w + 20; sx += 20) {
    const wx = sx + cam * 0.09;
    ctx.lineTo(sx, ground - 135 - Math.sin(wx * 0.0021 + 1) * 48 - Math.sin(wx * 0.006) * 22);
  }
  ctx.lineTo(w, ground);
  ctx.fill();
  ctx.fillStyle = "#1b121d";
  ctx.beginPath();
  ctx.moveTo(0, ground);
  for (let sx = 0; sx <= w + 20; sx += 20) {
    const wx = sx + cam * 0.15;
    ctx.lineTo(sx, ground - 82 - Math.sin(wx * 0.004) * 38 - Math.sin(wx * 0.0013 + 3) * 48);
  }
  ctx.lineTo(w, ground);
  ctx.fill();
}

/** Only trees in view are drawn; the fen and the ridge get a second, smaller grove. */
function drawTreeline(v: View) {
  const { ctx, w, cam, ground } = v;
  for (let i = 0; i < 92; i++) {
    const wx = WORLD_MIN + i * 155 + ((i * 97) % 60);
    const sx = wx - cam * 0.45;
    if (sx < -150 || sx > w + 150) continue;
    const th = 74 + ((i * 53) % 56);
    drawTree(ctx, sx, ground, th, i);
    if (wx < -2650 || wx > 7350) drawTree(ctx, sx + 62, ground, th * 0.82, i + 7);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, ground: number, height: number, seed: number) {
  drawSvg(ctx, "scenery/autumn-tree.svg", x - height * 0.375, ground - height, height * 0.75, height, seed % 2 === 1);
}

function drawClouds(v: View) {
  const { ctx, w, t } = v;
  ctx.fillStyle = "rgba(27,19,36,.22)";
  for (let i = 0; i < 4; i++) {
    const cx = ((i * 410 + t * (3 + i)) % (w + 500)) - 250;
    const cy = 80 + i * 58;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 150, 17, -0.05, 0, Math.PI * 2);
    ctx.ellipse(cx + 95, cy + 5, 105, 12, 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
}

let skyBake: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Sky and ground gradients, baked once per night bucket and view in device pixels, then copied 1:1.
 *  A gradient filling the whole screen costs several times a plain copy, and it ran every frame before. */
function drawSkyBake(v: View) {
  const { ctx, ground, night, nb } = v;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const m = ctx.getTransform();
  // The sky ends at the road: the world ground point, mapped to device pixels.
  const skyBottom = Math.round(m.d * ground + m.f);
  const key = `${cw}x${ch}|${skyBottom}|${nb}`;
  if (!skyBake || skyBake.key !== key) {
    const canvas = makeCanvas(cw, ch);
    const g = canvas.getContext("2d")!;
    const sky = g.createLinearGradient(0, 0, 0, skyBottom);
    sky.addColorStop(0, lerpHex(SKY_DUSK[0], SKY_NIGHT[0], night));
    sky.addColorStop(0.38, lerpHex(SKY_DUSK[1], SKY_NIGHT[1], night));
    sky.addColorStop(0.72, lerpHex(SKY_DUSK[2], SKY_NIGHT[2], night));
    sky.addColorStop(0.9, lerpHex(SKY_DUSK[3], SKY_NIGHT[3], night));
    sky.addColorStop(1, lerpHex(SKY_DUSK[4], SKY_NIGHT[4], night));
    g.fillStyle = sky;
    g.fillRect(0, 0, cw, skyBottom);
    const road = g.createLinearGradient(0, skyBottom, 0, ch);
    road.addColorStop(0, lerpHex(GROUND_DUSK[0], GROUND_NIGHT[0], night));
    road.addColorStop(0.12, lerpHex(GROUND_DUSK[1], GROUND_NIGHT[1], night));
    road.addColorStop(1, lerpHex(GROUND_DUSK[2], GROUND_NIGHT[2], night));
    g.fillStyle = road;
    g.fillRect(0, skyBottom, cw, ch - skyBottom);
    skyBake = { key, canvas };
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(skyBake.canvas, 0, 0);
  ctx.restore();
}
