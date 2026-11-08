// Sky layer: dusk-to-night gradient, stars, moon with halo and rays, and cloud banks.
// Everything that does not move with the camera (gradient, stars, moon glow) is
// baked once per size, night bucket and device scale, then blitted each frame.
// Baking removes the per-frame shadow blur and the 95 star paths, which were the
// most expensive part of the sky.
import { drawMoonRays } from "../atmosphere";
import { drawSvg } from "../svg-assets";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { SKY_DUSK, SKY_NIGHT, lerpHex } from "./palette";

const MOON_BOX = 300; // user units; the halo fits inside this square

interface Bake { key: string; canvas: HTMLCanvasElement }
let skyBake: Bake | null = null;
let moonBake: Bake | null = null;

function canvasFor(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Device pixels per user unit (device pixel ratio times the glass zoom). */
function scaleOf(ctx: CanvasRenderingContext2D): number {
  const s = Math.abs(ctx.getTransform().a);
  return s > 0 ? s : 1;
}

function bakeSky(w: number, ground: number, lift: number, night: number, s: number, glow: boolean, quality: string): HTMLCanvasElement | null {
  const c = canvasFor(w * s, (ground + lift) * s);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  g.setTransform(s, 0, 0, s, 0, s * lift); // canvas y=0 is user y=-lift
  const grad = g.createLinearGradient(0, 0, 0, ground);
  grad.addColorStop(0, lerpHex(SKY_DUSK[0], SKY_NIGHT[0], night));
  grad.addColorStop(0.38, lerpHex(SKY_DUSK[1], SKY_NIGHT[1], night));
  grad.addColorStop(0.72, lerpHex(SKY_DUSK[2], SKY_NIGHT[2], night));
  grad.addColorStop(0.9, lerpHex(SKY_DUSK[3], SKY_NIGHT[3], night));
  grad.addColorStop(1, lerpHex(SKY_DUSK[4], SKY_NIGHT[4], night));
  g.fillStyle = grad;
  g.fillRect(0, -lift, w, ground + lift);
  // Deterministic stars, fixed to the screen (no shimmer between frames).
  const starCount = quality === "high" ? 95 : quality === "medium" ? 48 : 18;
  for (let i = 0; i < starCount; i++) {
    const sx = ((i * 197.3 + 41) % (w + 160)) - 80;
    const sy = 18 + ((i * 83.7) % Math.max(60, ground * 0.52));
    const radius = 0.45 + (i % 7 === 0 ? 0.85 : 0.25);
    g.globalAlpha = (0.25 + (i % 5) * 0.1) * (0.3 + 0.7 * night);
    g.fillStyle = i % 9 === 0 ? "#ffd9a0" : "#d9d8ed";
    g.beginPath(); g.arc(sx, sy, radius, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  return c;
}

function bakeMoon(night: number, s: number, glow: boolean): HTMLCanvasElement | null {
  const c = canvasFor(MOON_BOX * s, MOON_BOX * s);
  const g = c?.getContext("2d");
  if (!c || !g) return null;
  g.setTransform(s, 0, 0, s, s * MOON_BOX / 2, s * MOON_BOX / 2); // centred origin
  if (glow) {
    const halo = g.createRadialGradient(0, 0, 32, 0, 0, 145);
    halo.addColorStop(0, `rgba(244,222,181,${0.18 + 0.12 * night})`);
    halo.addColorStop(0.45, "rgba(222,191,170,.08)");
    halo.addColorStop(1, "rgba(222,191,170,0)");
    g.fillStyle = halo;
    g.fillRect(-150, -150, 300, 300);
  }
  g.shadowColor = "rgba(240,225,190,0.8)";
  g.shadowBlur = glow ? 34 : 0;
  drawSvg(g, "scenery/moon.svg", -42, -42, 84, 84);
  g.shadowBlur = 0;
  return c;
}

export function drawSky(f: Frame, env: DrawEnv) {
  const { ctx, w, h, t, cam, ground, night, nb, lift, graphics } = f;
  const s = scaleOf(ctx);
  const glow = graphics.glow;

  // --- day-night sky (baked; rebuilt only when size, night bucket or scale change) ---
  const skyKey = `${Math.round(w)}|${ground}|${lift}|${nb}|${s.toFixed(2)}|${graphics.quality}`;
  if (!skyBake || skyBake.key !== skyKey) {
    const canvas = bakeSky(w, ground, lift, nb, s, glow, graphics.quality);
    if (canvas) skyBake = { key: skyKey, canvas };
  }
  if (skyBake) ctx.drawImage(skyBake.canvas, 0, -lift, w, ground + lift);
  else {
    ctx.fillStyle = "#14101c";
    ctx.fillRect(0, -lift, w, ground + lift);
  }

  // Moon: the halo and disc are baked; only its position moves with the camera.
  const mx = w * 0.78 - cam * 0.03;
  const my = h * 0.18;
  const moonKey = `${nb}|${s.toFixed(2)}|${glow}`;
  if (!moonBake || moonBake.key !== moonKey) {
    const canvas = bakeMoon(nb, s, glow);
    if (canvas) moonBake = { key: moonKey, canvas };
  }
  if (moonBake) ctx.drawImage(moonBake.canvas, mx - MOON_BOX / 2, my - MOON_BOX / 2, MOON_BOX, MOON_BOX);

  if (glow && graphics.quality !== "low") drawMoonRays(ctx, mx, my, t, night);

  // Long, slow cloud banks crossing the moon and horizon.
  if (graphics.quality !== "low") {
    ctx.save();
    ctx.fillStyle = "rgba(27,19,36,.22)";
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 410 + t * (3 + i)) % (w + 500)) - 250;
      const cy = 80 + i * 58;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 150, 17, -0.05, 0, Math.PI * 2);
      ctx.ellipse(cx + 95, cy + 5, 105, 12, 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
