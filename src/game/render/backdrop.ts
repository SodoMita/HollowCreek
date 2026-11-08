// Sky, stars, moon (with baked halo and shafts), clouds, two hill rows and the
// wooded treeline. Every static or slow-changing piece is baked into bitmaps so
// per-frame cost is only a handful of bitmap copies, with zero path builds and
// zero per-frame gradients.
import { WORLD_MAX, WORLD_MIN } from "../buildings";
import { spriteFor } from "../svg-assets";
import { makeCanvas } from "./paint";
import { GROUND_DUSK, GROUND_NIGHT, SKY_DUSK, SKY_NIGHT, lerpHex } from "./palette";
import type { Quality, View } from "./view";

// ---- Sky + stars + road gradient bake (device resolution, numeric cache key) ---
let skyCanvas: HTMLCanvasElement | null = null;
let skyW = 0, skyH = 0, skyBottomPx = -1, skyNb = -1;
let skyQual: Quality = "high";

function drawSkyBake(v: View) {
  const { ctx, roadEdge, night, nb, quality } = v;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const m = ctx.getTransform();
  // Horizon starts at roadEdge (above the street objects) so shadows always land on ground, not empty sky.
  const bottom = Math.round(m.d * roadEdge + m.f);
  const clampedBottom = Math.max(0, Math.min(ch, bottom));
  if (!skyCanvas || skyW !== cw || skyH !== ch || skyBottomPx !== bottom || skyNb !== nb || skyQual !== quality) {
    const c = makeCanvas(cw, ch);
    const g = c.getContext("2d")!;
    if (clampedBottom > 0) {
      const sky = g.createLinearGradient(0, 0, 0, Math.max(1, bottom));
      sky.addColorStop(0, lerpHex(SKY_DUSK[0], SKY_NIGHT[0], night));
      sky.addColorStop(0.38, lerpHex(SKY_DUSK[1], SKY_NIGHT[1], night));
      sky.addColorStop(0.72, lerpHex(SKY_DUSK[2], SKY_NIGHT[2], night));
      sky.addColorStop(0.9, lerpHex(SKY_DUSK[3], SKY_NIGHT[3], night));
      sky.addColorStop(1, lerpHex(SKY_DUSK[4], SKY_NIGHT[4], night));
      g.fillStyle = sky;
      g.fillRect(0, 0, cw, clampedBottom);
    }
    const count = quality === "high" ? 95 : quality === "medium" ? 48 : 18;
    const scaleX = m.a || 1;
    const scaleY = m.d || 1;
    const vw = cw / scaleX;
    const gndWorld = bottom / scaleY;
    for (let i = 0; i < count; i++) {
      const sx = (((i * 197.3 + 41) % (vw + 160)) - 80) * scaleX;
      const sy = (18 + ((i * 83.7) % Math.max(60, gndWorld * 0.52))) * scaleY;
      if (sy >= clampedBottom) continue;
      const r = (0.45 + (i % 7 === 0 ? 0.85 : 0.25)) * scaleX;
      g.globalAlpha = (0.25 + (i % 5) * 0.1) * (0.3 + 0.7 * night);
      g.fillStyle = i % 9 === 0 ? "#ffd9a0" : "#d9d8ed";
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (clampedBottom < ch) {
      const road = g.createLinearGradient(0, bottom, 0, ch);
      road.addColorStop(0, lerpHex(GROUND_DUSK[0], GROUND_NIGHT[0], night));
      road.addColorStop(0.14, lerpHex(GROUND_DUSK[1], GROUND_NIGHT[1], night));
      road.addColorStop(1, lerpHex(GROUND_DUSK[2], GROUND_NIGHT[2], night));
      g.fillStyle = road;
      g.fillRect(0, clampedBottom, cw, ch - clampedBottom);
    }
    skyCanvas = c;
    skyW = cw; skyH = ch; skyBottomPx = bottom; skyNb = nb; skyQual = quality;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(skyCanvas, 0, 0);
  ctx.restore();
}

// ---- Moon + halo + rays bake (one sprite per night bucket + glow + quality) ---
const MOON_OX = 260;
const MOON_OY = 160;
const MOON_W = 460;
const MOON_H = 560;
let moonCanvas: HTMLCanvasElement | null = null;
let moonNb = -1;
let moonGlow = true;
let moonRays = true;
let moonHadSvg = false;

function drawMoon(v: View) {
  const { ctx, w, h, cam, night, nb, glow, quality } = v;
  const rays = glow && quality !== "low";
  const moonSvg = spriteFor("scenery/moon.svg", 84, 84);
  const hasSvg = !!moonSvg;
  if (!moonCanvas || moonNb !== nb || moonGlow !== glow || moonRays !== rays || moonHadSvg !== hasSvg) {
    const scale = 2;
    const c = makeCanvas(MOON_W * scale, MOON_H * scale);
    const g = c.getContext("2d")!;
    g.scale(scale, scale);
    if (glow) {
      const halo = g.createRadialGradient(MOON_OX, MOON_OY, 32, MOON_OX, MOON_OY, 145);
      halo.addColorStop(0, `rgba(244,222,181,${0.18 + 0.12 * night})`);
      halo.addColorStop(0.45, "rgba(222,191,170,.08)");
      halo.addColorStop(1, "rgba(222,191,170,0)");
      g.fillStyle = halo;
      g.fillRect(MOON_OX - 150, MOON_OY - 150, 300, 300);
      const disc = g.createRadialGradient(MOON_OX, MOON_OY, 0, MOON_OX, MOON_OY, 70);
      disc.addColorStop(0, "rgba(240,225,190,0.5)");
      disc.addColorStop(1, "rgba(240,225,190,0)");
      g.fillStyle = disc;
      g.fillRect(MOON_OX - 70, MOON_OY - 70, 140, 140);
    }
    if (moonSvg) g.drawImage(moonSvg, MOON_OX - 42, MOON_OY - 42, 84, 84);
    if (rays) {
      for (let i = 0; i < 3; i++) {
        const ang = 1.85 + i * 0.24;
        const len = 330 + i * 60;
        const spread = 26 + i * 10;
        const ex = MOON_OX + Math.cos(ang) * len;
        const ey = MOON_OY + Math.sin(ang) * len;
        const rg = g.createLinearGradient(MOON_OX, MOON_OY, ex, ey);
        const a = 0.028 + 0.03 * night;
        rg.addColorStop(0, `rgba(232,214,178,${a})`);
        rg.addColorStop(1, "rgba(232,214,178,0)");
        g.fillStyle = rg;
        g.beginPath();
        g.moveTo(MOON_OX, MOON_OY);
        g.lineTo(ex - spread, ey);
        g.lineTo(ex + spread, ey);
        g.closePath();
        g.fill();
      }
    }
    moonCanvas = c;
    moonNb = nb; moonGlow = glow; moonRays = rays; moonHadSvg = hasSvg;
  }
  const mx = w * 0.78 - cam * 0.03;
  const my = h * 0.18;
  ctx.drawImage(moonCanvas, mx - MOON_OX, my - MOON_OY, MOON_W, MOON_H);
}

// ---- Hill strips (baked across the entire parallax range, sliced 1:1 per frame) ---
const HILL_H = 220;
const HILL1_MIN = Math.floor(WORLD_MIN * 0.09) - 40;
const HILL2_MIN = Math.floor(WORLD_MIN * 0.15) - 40;
let hill1Canvas: HTMLCanvasElement | null = null;
let hill2Canvas: HTMLCanvasElement | null = null;
let hillMaxViewW = 0;

function ensureHills(viewW: number) {
  const needW = Math.max(1600, Math.ceil(viewW) + 80);
  if (hill1Canvas && hill2Canvas && needW <= hillMaxViewW) return;
  hillMaxViewW = needW;
  const w1 = Math.ceil(WORLD_MAX * 0.09) - HILL1_MIN + needW;
  const c1 = makeCanvas(w1, HILL_H);
  const g1 = c1.getContext("2d")!;
  g1.fillStyle = "#2a1828";
  g1.beginPath();
  g1.moveTo(0, HILL_H);
  for (let x = 0; x <= w1; x += 20) {
    const wx = HILL1_MIN + x;
    g1.lineTo(x, HILL_H - 135 - Math.sin(wx * 0.0021 + 1) * 48 - Math.sin(wx * 0.006) * 22);
  }
  g1.lineTo(w1, HILL_H);
  g1.fill();
  hill1Canvas = c1;

  const w2 = Math.ceil(WORLD_MAX * 0.15) - HILL2_MIN + needW;
  const c2 = makeCanvas(w2, HILL_H);
  const g2 = c2.getContext("2d")!;
  g2.fillStyle = "#1b121d";
  g2.beginPath();
  g2.moveTo(0, HILL_H);
  for (let x = 0; x <= w2; x += 20) {
    const wx = HILL2_MIN + x;
    g2.lineTo(x, HILL_H - 82 - Math.sin(wx * 0.004) * 38 - Math.sin(wx * 0.0013 + 3) * 48);
  }
  g2.lineTo(w2, HILL_H);
  g2.fill();
  hill2Canvas = c2;
}

function drawHills(v: View) {
  const { ctx, w, cam, roadEdge } = v;
  ensureHills(w);
  const sx1 = Math.max(0, Math.min(hill1Canvas!.width - w, cam * 0.09 - HILL1_MIN));
  ctx.drawImage(hill1Canvas!, sx1, 0, w, HILL_H, 0, roadEdge - HILL_H, w, HILL_H);
  const sx2 = Math.max(0, Math.min(hill2Canvas!.width - w, cam * 0.15 - HILL2_MIN));
  ctx.drawImage(hill2Canvas!, sx2, 0, w, HILL_H, 0, roadEdge - HILL_H, w, HILL_H);
}

// ---- Cloud sprite (baked once) ---
let cloudSprite: HTMLCanvasElement | null = null;
function getCloudSprite(): HTMLCanvasElement {
  if (cloudSprite) return cloudSprite;
  const c = makeCanvas(440, 60);
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(27,19,36,.22)";
  g.beginPath();
  g.ellipse(160, 26, 150, 17, -0.05, 0, Math.PI * 2);
  g.ellipse(255, 31, 105, 12, 0.04, 0, Math.PI * 2);
  g.fill();
  cloudSprite = c;
  return c;
}

/** Only visible trees in the treeline loop are visited; anchored at the raised treeline edge. */
function drawTreeline(v: View) {
  const { ctx, w, cam, roadEdge } = v;
  const baseY = roadEdge + 4;
  const pcam = cam * 0.45;
  const i0 = Math.max(0, Math.floor((pcam - 160 - WORLD_MIN) / 155) - 1);
  const i1 = Math.min(91, Math.ceil((pcam + w + 160 - WORLD_MIN) / 155) + 1);
  for (let i = i0; i <= i1; i++) {
    const wx = WORLD_MIN + i * 155 + ((i * 97) % 60);
    const sx = wx - pcam;
    if (sx < -150 || sx > w + 150) continue;
    const th = 74 + ((i * 53) % 56);
    const s1 = spriteFor("scenery/autumn-tree.svg", th * 0.75, th, (i & 1) === 1);
    if (s1) ctx.drawImage(s1, sx - th * 0.375, baseY - th, th * 0.75, th);
    if (wx < -2650 || wx > 7350) {
      const th2 = th * 0.82;
      const s2 = spriteFor("scenery/autumn-tree.svg", th2 * 0.75, th2, ((i + 7) & 1) === 1);
      if (s2) ctx.drawImage(s2, sx + 62 - th2 * 0.375, baseY - th2, th2 * 0.75, th2);
    }
  }
}

export function drawBackdrop(v: View) {
  drawSkyBake(v);
  drawMoon(v);
  drawHills(v);
  drawTreeline(v);
  if (v.quality !== "low") {
    const sprite = getCloudSprite();
    const span = v.w + 500;
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 410 + v.t * (3 + i)) % span) - 250;
      v.ctx.drawImage(sprite, cx - 160, 54 + i * 58);
    }
  }
}
