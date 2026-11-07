// Atmosphere over the scene: falling leaves, fireflies, fog, the lantern-light
// darkness, the past wash, vignette, the horror flicker. Everything here is decorative
// except the darkness mask, which follows the server's vision radius.
import { drawFireflies } from "../atmosphere";
import { WORLD_MAX, WORLD_MIN, treeX } from "../buildings";
import type { DrawEnv } from "./env";
import type { Frame } from "./frame";
import { LEAF_COLORS } from "./palette";

export interface Leaf { x: number; y: number; vx: number; vy: number; r: number; c: string; s: number }

// Tiny deterministic PRNG for effect recycling — avoids Math.random() in the frame loop.
let leafSeed = 1;
const nextRand = () => ((leafSeed = (Math.imul(leafSeed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

/** The 110 falling leaves, scattered across the world at construction. */
export function makeLeaves(): Leaf[] {
  const leaves: Leaf[] = [];
  for (let i = 0; i < 110; i++) {
    leaves.push({
      x: WORLD_MIN + Math.random() * (WORLD_MAX - WORLD_MIN),
      y: Math.random() * 600,
      vx: -12 - Math.random() * 25,
      vy: 18 + Math.random() * 30,
      r: Math.random() * Math.PI * 2,
      c: LEAF_COLORS[i % LEAF_COLORS.length],
      s: 3 + Math.random() * 4,
    });
  }
  return leaves;
}

/** Falling leaves; the count follows the detail preset. Recycled with a deterministic PRNG. */
export function drawLeaves(f: Frame, leaves: Leaf[], count: number) {
  const { ctx, cam, w, h, ground, dt, graphics } = f;
  for (let li = 0; li < count && li < leaves.length; li++) {
    const l = leaves[li];
    if (!graphics.reducedMotion) { l.x += l.vx * dt; l.y += l.vy * dt; l.r += dt * 2; }
    if (l.y > ground + 10) { l.y = -20; l.x = cam + nextRand() * w; } // deterministic recycle, no per-frame Math.random()
    if (l.x < cam - 60) l.x = cam + w + 40;
    const sx = l.x - cam;
    if (sx < -20 || sx > w + 20) continue;
    ctx.save();
    ctx.translate(sx, l.y * (h / 700));
    ctx.rotate(l.r);
    ctx.fillStyle = l.c;
    ctx.globalAlpha = 0.72;
    ctx.beginPath(); ctx.ellipse(0, 0, l.s, l.s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(40,18,10,.45)"; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(-l.s, 0); ctx.lineTo(l.s, 0); ctx.stroke();
    ctx.restore();
  }
}

/** Fireflies at dusk. */
export function drawFireflyLayer(f: Frame, env: DrawEnv) {
  drawFireflies(f.ctx, f.cam, f.w, f.ground, f.t, f.night, env.qualityCount(18, 12, 6), treeX);
}

/** Low, layered fog that drifts along the road. */
export function drawFog(f: Frame, env: DrawEnv) {
  const { ctx, w, t, ground } = f;
  const layers = env.qualityCount(4, 3, 1);
  for (let i = 0; i < layers; i++) {
    const fy = ground - 24 - i * 25;
    const drift = Math.sin(t * 0.24 + i * 2) * 70;
    const fog = env.grad(`fog:${ground}:${i}`, () => {
      const g = ctx.createLinearGradient(0, fy - 25, 0, fy + 25);
      g.addColorStop(0, "rgba(120,110,130,0)");
      g.addColorStop(0.5, `rgba(145,132,151,${0.075 + i * 0.018})`);
      g.addColorStop(1, "rgba(120,110,130,0)");
      return g;
    });
    ctx.fillStyle = fog;
    ctx.fillRect(drift - 90, fy - 25, w + 180, 50);
  }
}

/** Lantern-light darkness around the viewer, sized by the server's vision radius.
 *  Returns the smoothed radius to keep for the next frame. */
export function drawDarkness(f: Frame, visionR: number): number {
  const { ctx, snap, dt, t, w, h, cam, ground, meX } = f;
  const targetR = snap.visionRadius;
  if (targetR >= 1500) return 420;
  const vr = visionR + (targetR - visionR) * Math.min(1, dt * 3.5);
  const r = Math.max(80, vr + Math.sin(t * 7.3) * 6); // lantern breathing
  const cx2 = meX - cam;
  const cy2 = ground - 50;
  const dark = ctx.createRadialGradient(cx2, cy2, r * 0.45, cx2, cy2, r);
  dark.addColorStop(0, "rgba(4,2,8,0)");
  dark.addColorStop(0.55, "rgba(4,2,8,0.3)");
  dark.addColorStop(0.78, "rgba(4,2,8,0.6)");
  dark.addColorStop(1, "rgba(3,1,6,0.965)");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, w, h);
  // the lantern you carry is warm; the dark beyond it is cold
  const warm = ctx.createRadialGradient(cx2, cy2, 6, cx2, cy2, r * 0.7);
  warm.addColorStop(0, "rgba(255,178,92,0.07)");
  warm.addColorStop(1, "rgba(255,178,92,0)");
  ctx.fillStyle = warm;
  ctx.fillRect(cx2 - r, cy2 - r, r * 2, r * 2);
  return vr;
}

/** A restrained blue wash makes the recorded past distinct from the present. */
export function drawPastWash(f: Frame) {
  f.ctx.fillStyle = "rgba(72,133,151,.10)";
  f.ctx.fillRect(0, 0, f.w, f.h);
}

/** Vignette: darker edges, closing in harder as the night deepens. */
export function drawVignette(f: Frame, env: DrawEnv) {
  const { ctx, w, h, nb, night } = f;
  const vg = env.grad(`vg:${w}:${h}:${nb}`, () => {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(4,2,7,${0.6 + 0.25 * night})`); // deep night closes in harder
    return g;
  });
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/** Horror flicker after a lamp event. Decorative only; never changes authoritative vision. */
export function drawFlicker(f: Frame) {
  const { ctx, w, h, now, snap, graphics } = f;
  const since = now - snap.flickerAt;
  if (graphics.flicker && !graphics.reducedMotion && since >= 0 && since < 900) {
    const a = Math.random() < 0.5 ? 0.55 : 0.15;
    ctx.fillStyle = `rgba(0,0,0,${a * (1 - since / 900)})`;
    ctx.fillRect(0, 0, w, h);
  }
}
