// Sky layer: dusk-to-night gradient, stars, moon with halo and rays, and cloud banks.
import { drawMoonRays } from "../atmosphere";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { SKY_DUSK, SKY_NIGHT, lerpHex } from "./palette";

export function drawSky(f: Frame, env: DrawEnv) {
  const { ctx, w, h, t, cam, ground, night, nb, lift, graphics } = f;

  // --- day-night sky: dusk palette lerps into deep night as the round goes on ---
  const sky = env.grad(`sky:${ground}:${nb}`, () => {
    const g = ctx.createLinearGradient(0, 0, 0, ground);
    g.addColorStop(0, lerpHex(SKY_DUSK[0], SKY_NIGHT[0], night));
    g.addColorStop(0.38, lerpHex(SKY_DUSK[1], SKY_NIGHT[1], night));
    g.addColorStop(0.72, lerpHex(SKY_DUSK[2], SKY_NIGHT[2], night));
    g.addColorStop(0.9, lerpHex(SKY_DUSK[3], SKY_NIGHT[3], night));
    g.addColorStop(1, lerpHex(SKY_DUSK[4], SKY_NIGHT[4], night));
    return g;
  });
  ctx.fillStyle = sky;
  ctx.fillRect(0, -lift, w, ground + lift);

  // Deterministic stars: no shimmering random layout between frames.
  const starCount = env.qualityCount(95, 48, 18);
  ctx.save();
  for (let i = 0; i < starCount; i++) {
    const sx = ((i * 197.3 + 41) % (w + 160)) - 80 - (cam * 0.008) % 40;
    const sy = 18 + ((i * 83.7) % Math.max(60, ground * 0.52));
    const radius = 0.45 + (i % 7 === 0 ? 0.85 : 0.25);
    ctx.globalAlpha = (0.25 + (i % 5) * 0.1) * (0.3 + 0.7 * night);
    ctx.fillStyle = i % 9 === 0 ? "#ffd9a0" : "#d9d8ed";
    ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Moon with a broad atmospheric halo and crisp crater detail.
  const mx = w * 0.78 - cam * 0.03;
  const my = h * 0.18;
  ctx.save();
  if (graphics.glow) {
    const halo = ctx.createRadialGradient(mx, my, 32, mx, my, 145);
    halo.addColorStop(0, `rgba(244,222,181,${0.18 + 0.12 * night})`);
    halo.addColorStop(0.45, "rgba(222,191,170,.08)");
    halo.addColorStop(1, "rgba(222,191,170,0)");
    ctx.fillStyle = halo; ctx.fillRect(mx - 150, my - 150, 300, 300);
  }
  ctx.shadowColor = "rgba(240,225,190,0.8)";
  env.glow(ctx, 34);
  const moon = ctx.createRadialGradient(mx - 13, my - 15, 4, mx, my, 45);
  moon.addColorStop(0, "#fff4d8"); moon.addColorStop(0.7, "#e8ddc0"); moon.addColorStop(1, "#bcae98");
  ctx.fillStyle = moon;
  ctx.beginPath(); ctx.arc(mx, my, 42, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(128,119,112,0.25)";
  for (const [dx, dy, r] of [[-12, -8, 7], [10, 10, 5], [14, -14, 4], [-20, 16, 3]] as const) {
    ctx.beginPath(); ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  if (graphics.glow && graphics.quality !== "low") drawMoonRays(ctx, mx, my, t, night);

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
