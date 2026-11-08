// Atmosphere layers for the creek: pure drawing, no game logic. Kept separate
// from render.ts so the renderer stays small and these layers stay editable.
import { BUILDINGS, doorX } from "./buildings";
import { drawSvg } from "./svg-assets";

/** Fences, door lanterns, woodpiles, windmills — world-anchored street dressing. */
export function drawStreetDressing(ctx: CanvasRenderingContext2D, cam: number, w: number, ground: number) {
  const FENCE_XS = [-3520, -3300, -2950, -2760, -2180, -1460, -1250, -700, -120, 420, 760, 1560, 1860, 2560, 2960, 3320, 3780, 4180, 4420, 5100, 5260, 5980, 6280, 6900, 7180, 7480, 7760, 8260, 8480];
  for (const fx of FENCE_XS) {
    const sx = fx - cam;
    if (sx < -160 || sx > w + 160) continue;
    drawSvg(ctx, "props/fence.svg", sx, ground - 46, 140, 46);
  }
  for (const b of BUILDINGS) {
    const lx = doorX(b) + b.side * 46 - cam; // lantern post beside each doorway
    if (lx > -40 && lx < w + 40) drawSvg(ctx, "props/lantern-post.svg", lx, ground - 96, 30, 96);
  }
  for (const px of [-3378, 7252]) { // votive posts at the far beacon and the ridge cairn
    const sx = px - cam;
    if (sx > -40 && sx < w + 40) drawSvg(ctx, "props/lantern-post.svg", sx, ground - 96, 30, 96);
  }
  for (const wx of [-3000, -560, 5300, 7860]) {
    const sx = wx - cam;
    if (sx > -80 && sx < w + 80) drawSvg(ctx, "props/woodpile.svg", sx - 32, ground - 44, 64, 44);
  }
  for (const mx of [-3320, 4350, 6620, 8330]) { // Cape-style windmills marking each district
    const sx = mx - cam;
    if (sx > -150 && sx < w + 150) drawSvg(ctx, "props/windmill.svg", sx - 65, ground - 160, 130, 160);
  }
  for (const gx of [3110, 3265, 3345, 7222, 7382]) { // grave markers by the churchyard and the cairn
    const sx = gx - cam;
    if (sx > -50 && sx < w + 50) drawSvg(ctx, "props/gravestone.svg", sx - 17, ground - 46, 34, 46);
  }
  for (const hx of [195, 352]) { // haystacks by the harvest shed (x=280)
    const sx = hx - cam;
    if (sx > -90 && sx < w + 90) drawSvg(ctx, "props/haystack.svg", sx - 35, ground - 52, 70, 52);
  }
}

/** Pale shafts of moonlight through the valley haze. Very quiet on purpose. */
export function drawMoonRays(ctx: CanvasRenderingContext2D, mx: number, my: number, t: number, night: number) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 3; i++) {
    const ang = 1.85 + i * 0.24 + Math.sin(t * 0.05 + i * 2.1) * 0.03;
    const len = 330 + i * 60;
    const spread = 26 + i * 10;
    const ex = mx + Math.cos(ang) * len, ey = my + Math.sin(ang) * len;
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
  ctx.restore();
}

/** Fireflies drift along the tree line at dusk and give way to the deep night. */
export function drawFireflies(ctx: CanvasRenderingContext2D, cam: number, w: number, ground: number, t: number, night: number, count: number, treeX: (i: number) => number) {
  const season = Math.max(0, 1 - night * 1.15);
  if (season <= 0.02) return;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const anchor = treeX(i * 5 - 6);
    const fx = anchor + Math.sin(t * (0.21 + (i % 5) * 0.05) + i * 2.4) * (46 + (i % 4) * 22);
    const sx = fx - cam;
    if (sx < -20 || sx > w + 20) continue;
    const fy = ground - 34 - (i % 6) * 16 + Math.sin(t * (0.5 + (i % 3) * 0.2) + i) * 12;
    const blink = Math.pow(Math.max(0, Math.sin(t * (0.9 + (i % 4) * 0.3) + i * 1.7)), 3);
    const a = blink * season * 0.85;
    if (a < 0.03) continue;
    const warm = i % 3 !== 0;
    ctx.fillStyle = warm ? `rgba(255,217,138,${a})` : `rgba(200,232,150,${a})`;
    ctx.shadowColor = warm ? "rgba(255,200,110,.9)" : "rgba(190,230,140,.9)";
    ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(sx, fy, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** The creek keeps moving under its plank bridge: cold glints on dark water. */
export function drawCreekGlints(ctx: CanvasRenderingContext2D, cam: number, w: number, ground: number, t: number) {
  const sx = -2660 - cam;
  if (sx < -320 || sx > w + 320) return;
  ctx.save();
  ctx.fillStyle = "rgba(10,16,20,0.5)";
  ctx.beginPath(); ctx.ellipse(sx + 130, ground + 34, 150, 16, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 7; i++) {
    const gx = sx + 22 + i * 34 + Math.sin(t * 1.1 + i * 1.9) * 9;
    const gy = ground + 26 + (i % 3) * 7;
    const a = 0.05 + 0.07 * Math.max(0, Math.sin(t * 1.6 + i * 2.3));
    ctx.strokeStyle = `rgba(156,218,211,${a})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + 15, gy); ctx.stroke();
  }
  ctx.restore();
}

/** Near-field reeds and grass sweep past faster than the road: parallax depth. */
export function drawForeground(ctx: CanvasRenderingContext2D, cam: number, w: number, h: number, t: number) {
  ctx.save();
  ctx.fillStyle = "#050308";
  const span = 150;
  const off = -((cam * 1.22) % span);
  for (let i = -1; i < w / span + 2; i++) {
    const bx = off + i * span;
    const seed = Math.abs(Math.round((cam * 1.22) / span) + i);
    const sway = Math.sin(t * 0.8 + seed * 1.3) * 2.4;
    const blades = 4 + (seed % 3);
    for (let b = 0; b < blades; b++) {
      const x = bx + b * 7 + (seed % 5);
      const bh = 13 + ((seed * 7 + b * 13) % 17);
      ctx.beginPath();
      ctx.moveTo(x, h + 2);
      ctx.quadraticCurveTo(x + sway * 0.5, h - bh * 0.6, x + sway + (b % 2 ? 3 : -3), h - bh);
      ctx.quadraticCurveTo(x + sway * 0.5 + 2, h - bh * 0.5, x + 3.4, h + 2);
      ctx.closePath();
      ctx.fill();
    }
    if (seed % 4 === 0) { // a cattail keeps the fen close
      const x = bx + 46, ch = 42 + (seed % 12);
      ctx.strokeStyle = "#050308";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, h + 2);
      ctx.quadraticCurveTo(x + sway, h - ch * 0.6, x + sway * 1.6, h - ch);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + sway * 1.6, h - ch - 6, 3.2, 8, sway * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// The grade is a cool-shadow / warm-lantern tint. It is baked once per size and
// night bucket into a quarter-resolution canvas (it is a smooth gradient, so the
// upscale is invisible) and blended with plain alpha. Soft-light and overlay
// were full-screen blend passes every frame, the most expensive part of the frame.
let tintCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function gradeTint(w: number, h: number, nb: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const key = `${Math.round(w)}x${Math.round(h)}:${nb}`;
  if (tintCache?.key === key) return tintCache.canvas;
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w / 4));
  c.height = Math.max(2, Math.round(h / 4));
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, `rgba(46,92,112,${0.1 + 0.06 * nb})`);
  grad.addColorStop(0.55, "rgba(60,50,70,0.05)");
  grad.addColorStop(1, "rgba(214,130,52,0.13)");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  tintCache = { key, canvas: c };
  return c;
}

/** Cool shadows, warm lantern light, and fine film grain: two cheap passes, no blend modes. */
export function drawGrade(ctx: CanvasRenderingContext2D, w: number, h: number, night: number, grain: HTMLCanvasElement | null, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const tint = gradeTint(w, h, Math.round(night * 10) / 10);
  if (tint) ctx.drawImage(tint, 0, 0, w, h);
  if (grain) {
    // One repeating pattern fill instead of a blit per 128 px tile; the pattern drifts with time.
    const pattern = ctx.createPattern(grain, "repeat");
    if (pattern) {
      const ox = Math.floor(t * 61) % 128, oy = Math.floor(t * 47) % 128;
      pattern.setTransform(new DOMMatrix().translate(ox, oy));
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  }
  ctx.restore();
}

/** One small reusable noise tile; built lazily so SSR never touches document. */
export function makeGrainTile(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  if (!g) return null;
  const img = g.createImageData(128, 128);
  let s = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const v = 96 + (s % 64);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
