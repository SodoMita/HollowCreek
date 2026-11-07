// People on the street: the living, the caged, the ghosts, and the dead on the ground.
import { drawKit } from "../ward-art";
import { drawSvg } from "../svg-assets";
import type { PublicPlayer, Snapshot } from "../types";
import { drawBubble } from "./bubble";
import type { DrawEnv } from "./env";
import { drawFigure } from "./figure";
import type { Frame } from "./frame";

/** Where a figure was last drawn, so facing and gait follow what is actually shown
 *  rather than the server's view of it (which arrives a round trip later). */
export interface Motion { x: number; facing: number; movingUntil: number }

type Body = Snapshot["bodies"][number];

/** A corpse on the road, with the flash of its death and circling crows. */
export function drawBody(f: Frame, env: DrawEnv, b: Body) {
  const { ctx, cam, ground, now, t, graphics } = f;
  const bx = b.x - cam;
  const age = b.at ? now - b.at : 9999;
  if (age >= 0 && age < 950 && !graphics.reducedMotion) {
    const progress = age / 950;
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.7;
    const flash = ctx.createRadialGradient(bx, ground - 45, 3, bx, ground - 45, 70 + progress * 80);
    flash.addColorStop(0, "rgba(220,40,28,.9)"); flash.addColorStop(1, "rgba(110,0,0,0)");
    ctx.fillStyle = flash; ctx.fillRect(bx - 160, ground - 200, 320, 220);
    if (progress < 0.55) {
      ctx.strokeStyle = "#f1b1a0"; ctx.lineWidth = 4 * (1 - progress);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(bx - 35 + i * 12, ground - 105);
        ctx.quadraticCurveTo(bx + 8 + i * 12, ground - 65, bx + 35 + i * 12, ground - 25); ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.fillStyle = "rgba(90,10,10,0.7)";
  ctx.beginPath(); ctx.ellipse(bx, ground - 2, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(bx, ground - 10);
  ctx.rotate(Math.PI / 2);
  drawFigure(ctx, 0, 0, b.color, 1, false, false, false, t, 1, env);
  ctx.restore();
  // circling crows
  ctx.strokeStyle = "#0a0608";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const a = t * (0.9 + i * 0.2) + i * 2.1;
    const cx2 = bx + Math.cos(a) * (34 + i * 14);
    const cy2 = ground - 120 - i * 16 + Math.sin(a * 1.7) * 10;
    const flap = Math.sin(t * 9 + i * 2) * 4;
    ctx.beginPath();
    ctx.moveTo(cx2 - 7, cy2 - flap);
    ctx.quadraticCurveTo(cx2, cy2 + 3, cx2 + 7, cy2 - flap);
    ctx.stroke();
  }
}

/** One player: body, carried kit, key and timepiece icons, name tag, action tag and speech. */
export function drawPlayer(f: Frame, env: DrawEnv, motion: Map<string, Motion>, p: PublicPlayer) {
  const { ctx, w, t, cam, ground, now, snap, displayX, glassUp } = f;
  const px = (displayX.get(p.id) ?? p.x) - cam;
  if (px < -100 || px > w + 100) return;
  const ghost = !p.alive;
  if (ghost && snap.self.alive) return; // living can't see ghosts
  const isMate = snap.self.teammates.includes(p.id);
  const floatY = ghost ? -14 + Math.sin(t * 2 + p.x) * 5 : 0;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.45;
  else if (p.echo) ctx.globalAlpha = 0.52;
  if (!ghost) {
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath(); ctx.ellipse(px, ground + 2, 17, 4, 0, 0, Math.PI * 2); ctx.fill();
  }
  const shownX = displayX.get(p.id) ?? p.x;
  let seen = motion.get(p.id);
  if (!seen) { seen = { x: shownX, facing: p.facing, movingUntil: 0 }; motion.set(p.id, seen); }
  const dx = shownX - seen.x;
  if (Math.abs(dx) > 0.6) { seen.facing = dx > 0 ? 1 : -1; seen.movingUntil = t + 0.12; }
  else if (p.moving && p.id !== snap.self.id) seen.movingUntil = Math.max(seen.movingUntil, t + 0.05);
  seen.x = shownX;
  drawFigure(ctx, px, ground + floatY, p.color, seen.facing, t < seen.movingUntil, ghost, isMate || (p.id === snap.self.id && snap.self.role === "hollow"), t, 1, env);
  ctx.restore();
  // A kit stays visible on its carrier until someone delivers it.
  if (p.hasSupply) drawKit(ctx, px - 23, ground - 16 + floatY);
  // key icon
  if (p.hasKey || (p.doorKeys?.length ?? 0) > 0) {
    ctx.fillStyle = "#e8b93c";
    ctx.font = "12px serif";
    ctx.textAlign = "center";
    ctx.fillText("🗝", px + 16, ground - 52 + floatY);
  }
  if (p.hasTimepiece) {
    ctx.save(); ctx.shadowColor = "#9cdad3"; env.glow(ctx, 8);
    if (!drawSvg(ctx, "props/timepiece.svg", px + 12, ground - 62 + floatY, 15, 20)) {
      ctx.fillStyle = "#a8d2cf"; ctx.beginPath(); ctx.arc(px + 19, ground - 52 + floatY, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // name and speech are optional HUD layers; the figures remain identifiable by color.
  if (env.settings.interface.playerNames && !glassUp) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    const label = p.name + (p.echo ? " · echo" : snap.phase === "meeting" && p.voted ? " ✓" : "");
    const width = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(5,3,8,.55)";
    ctx.beginPath(); ctx.roundRect(px - width / 2 - 5, ground - 75 + floatY, width + 10, 17, 5); ctx.fill();
    ctx.fillStyle = p.id === snap.self.id ? "#ffd98a" : p.echo ? "#b9d9d5" : isMate ? "#ff7a6a" : "rgba(245,235,220,.96)";
    ctx.fillText(label, px, ground - 62 + floatY);
  }
  if (p.action && p.action.until > now && !glassUp) {
    ctx.save(); ctx.font = "600 10px system-ui, sans-serif"; ctx.textAlign = "center";
    const label = p.action.text, width = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(20,27,29,.9)"; ctx.beginPath(); ctx.roundRect(px - width / 2 - 6, ground - 98 + floatY, width + 12, 16, 5); ctx.fill();
    ctx.fillStyle = p.echo ? "#bde6dc" : "#f2d1a2"; ctx.fillText(label, px, ground - 87 + floatY); ctx.restore();
  }
  if (p.bubble && env.settings.interface.speechBubbles && !glassUp) {
    drawBubble(ctx, px, ground - (p.action ? 100 : 72) + floatY, p.bubble.text, Math.min(1, (p.bubble.until - now) / 800), env);
  }
}
