// People on the street: the living, the caged, the ghosts, and the dead on the road.
import { drawSvg, drawTraveler } from "../svg-assets";
import type { Snapshot } from "../types";
import { light, textWidth } from "./paint";
import { drawKit } from "./props";
import type { View } from "./view";

/** Where a figure was last drawn, so facing and gait follow what is shown, not the server's view. */
export interface Motion { x: number; facing: number; movingUntil: number }

type Body = Snapshot["bodies"][number];

/** A traveller at its ground point. Facing mirrors the sprite; gait is driven by time. */
export function drawFigure(
  ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
  facing: number, moving: boolean, ghost: boolean, redEyes: boolean, t: number,
) {
  const gait = Math.sin(t * 11 + x * 0.1);
  const bob = moving ? Math.abs(gait) * -1.1 : Math.sin(t * 1.7 + x) * 0.3;
  ctx.save();
  ctx.translate(x, groundY + bob);
  ctx.scale(facing, 1);
  const pose = moving ? (gait > 0.25 ? 1 : gait < -0.25 ? -1 : 0) : 0;
  // A pose's palette bakes asynchronously (and again when the raster density changes).
  // Until it is ready, draw a plain cloak silhouette in the same colour: a figure must
  // never disappear for a frame — that reads as flicker.
  if (!drawTraveler(ctx, color, redEyes, ghost, pose)) {
    ctx.globalAlpha *= ghost ? 0.45 : 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.quadraticCurveTo(15, -46, 16, -18);
    ctx.quadraticCurveTo(12, 0, 0, 0);
    ctx.quadraticCurveTo(-12, 0, -16, -18);
    ctx.quadraticCurveTo(-15, -46, 0, -50);
    ctx.closePath();
    ctx.fill();
    if (!ghost) {
      ctx.fillStyle = redEyes ? "#ff5142" : "#eee6ce";
      ctx.beginPath();
      ctx.arc(-5, -38, 1.8, 0, Math.PI * 2);
      ctx.arc(5, -38, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Corpses on the road (or inside a house), with the flash of the death and circling crows. */
export function drawBodies(v: View, inside: boolean) {
  for (const b of v.snap.bodies) if (!!b.inside === inside) drawBody(v, b);
}

function drawBody(v: View, b: Body) {
  const { ctx, cam, ground, now, t, reduced } = v;
  const bx = b.x - cam;
  const age = b.at ? now - b.at : 9999;
  if (age >= 0 && age < 950 && !reduced) {
    const p = age / 950;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (1 - p) * 0.7;
    light(ctx, bx, ground - 45, 70 + p * 80, 70 + p * 80, "220,40,28", 0.9);
    ctx.globalAlpha = prev;
    if (p < 0.55) {
      ctx.strokeStyle = "#f1b1a0";
      ctx.lineWidth = 4 * (1 - p);
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        ctx.moveTo(bx - 35 + i * 12, ground - 105);
        ctx.quadraticCurveTo(bx + 8 + i * 12, ground - 65, bx + 35 + i * 12, ground - 25);
      }
      ctx.stroke();
    }
  }
  drawSvg(ctx, "props/blood-pool.svg", bx - 30, ground - 9, 60, 14);
  ctx.save();
  ctx.translate(bx, ground - 10);
  ctx.rotate(Math.PI / 2);
  drawFigure(ctx, 0, 0, b.color, 1, false, false, false, t);
  ctx.restore();
  // Three crows circle the body.
  ctx.strokeStyle = "#0a0608";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = t * (0.9 + i * 0.2) + i * 2.1;
    const cx = bx + Math.cos(a) * (34 + i * 14);
    const cy = ground - 120 - i * 16 + Math.sin(a * 1.7) * 10;
    const flap = Math.sin(t * 9 + i * 2) * 4;
    ctx.moveTo(cx - 7, cy - flap);
    ctx.quadraticCurveTo(cx, cy + 3, cx + 7, cy - flap);
  }
  ctx.stroke();
}

/** Players matching `pick`, in the viewer-last order that the snapshot indexes provide. */
export function drawPlayers(v: View, motion: Map<string, Motion>, pick: (p: View["sorted"][number]) => boolean) {
  for (const p of v.sorted) if (pick(p)) drawPlayer(v, motion, p);
}

/** One player: body, carried kit, key and timepiece icons, name, action and speech. */
function drawPlayer(v: View, motion: Map<string, Motion>, p: View["sorted"][number]) {
  const { ctx, w, t, cam, ground, now, snap, displayX, glassUp, settings } = v;
  const shownX = displayX.get(p.id) ?? p.x;
  const px = shownX - cam;
  if (px < -100 || px > w + 100) return;
  const ghost = !p.alive;
  if (ghost && snap.self.alive) return; // the living cannot see ghosts
  const isMate = snap.self.teammates.includes(p.id);
  const floatY = ghost ? -14 + Math.sin(t * 2 + p.x) * 5 : 0;

  let seen = motion.get(p.id);
  if (!seen) {
    seen = { x: shownX, facing: p.facing, movingUntil: 0 };
    motion.set(p.id, seen);
  }
  const dx = shownX - seen.x;
  if (Math.abs(dx) > 0.6 && p.id !== snap.self.id) seen.facing = dx > 0 ? 1 : -1;
  // Walk from intent: `moving` comes from the server and stays true while a soul
  // presses into a blocked doorway, so the cycle no longer freezes at walls.
  if (p.moving) seen.movingUntil = t + 0.15;
  else if (Math.abs(dx) > 0.6) seen.movingUntil = t + 0.12;
  seen.x = shownX;

  const prev = ctx.globalAlpha;
  if (ghost) ctx.globalAlpha = prev * 0.45;
  else if (p.echo) ctx.globalAlpha = prev * 0.52;
  if (!ghost) {
    // A tight, cool contact shadow under the feet: it must read as shade on the road,
    // not as a second object (the warm grade turned wide soft ellipses brown).
    const inside = !!p.inside;
    if (!inside) {
      ctx.fillStyle = "rgba(6,4,10,.5)";
      ctx.beginPath();
      ctx.ellipse(px, ground + 1, 13, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawFigure(ctx, px, ground + floatY, p.color, seen.facing, t < seen.movingUntil, ghost,
    isMate || (p.id === snap.self.id && snap.self.role === "hollow"), t);
  ctx.globalAlpha = prev;

  // A kit stays on its carrier until someone delivers it.
  if (p.hasSupply) drawKit(ctx, px - 23, ground - 16 + floatY);
  if (p.hasKey || (p.doorKeys?.length ?? 0) > 0) {
    ctx.fillStyle = "#e8b93c";
    ctx.font = "12px serif";
    ctx.textAlign = "center";
    ctx.fillText("🗝", px + 16, ground - 52 + floatY);
  }
  if (p.hasTimepiece) {
    if (v.glow) light(ctx, px + 20, ground - 52 + floatY, 14, 16, "156,218,211", 0.5);
    drawSvg(ctx, "props/timepiece.svg", px + 12, ground - 62 + floatY, 15, 20);
  }

  // Name and speech are optional HUD layers; figures stay identifiable by colour.
  if (settings.interface.playerNames && !glassUp) {
    const font = "600 12px system-ui, sans-serif";
    const label = p.name + (p.echo ? " · echo" : snap.phase === "meeting" && p.voted ? " ✓" : "");
    const width = textWidth(ctx, label, font);
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(5,3,8,.55)";
    ctx.beginPath();
    ctx.roundRect(px - width / 2 - 5, ground - 75 + floatY, width + 10, 17, 5);
    ctx.fill();
    ctx.fillStyle = p.id === snap.self.id ? "#ffd98a" : p.echo ? "#b9d9d5" : isMate ? "#ff7a6a" : "rgba(245,235,220,.96)";
    ctx.fillText(label, px, ground - 62 + floatY);
  }
  if (p.action && p.action.until > now && !glassUp) {
    const font = "600 10px system-ui, sans-serif";
    const width = textWidth(ctx, p.action.text, font);
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(20,27,29,.9)";
    ctx.beginPath();
    ctx.roundRect(px - width / 2 - 6, ground - 98 + floatY, width + 12, 16, 5);
    ctx.fill();
    ctx.fillStyle = p.echo ? "#bde6dc" : "#f2d1a2";
    ctx.fillText(p.action.text, px, ground - 87 + floatY);
  }
  if (p.bubble && settings.interface.speechBubbles && !glassUp) {
    drawBubble(v, px, ground - (p.action ? 100 : 72) + floatY, p.bubble.text, Math.min(1, (p.bubble.until - now) / 800));
  }
}

const bubbleCache = new Map<string, { lines: string[]; bw: number }>();

/** Speech above a figure. Wrapped lines are cached by text; at most four lines. */
function bubbleLayout(ctx: CanvasRenderingContext2D, text: string): { lines: string[]; bw: number } {
  const hit = bubbleCache.get(text);
  if (hit) return hit;
  ctx.font = "12px system-ui, sans-serif";
  const lines: string[] = [];
  let line = "";
  let truncated = false;
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > 150 && line) {
      lines.push(line);
      line = word;
    } else line = test;
    if (lines.length >= 4) {
      truncated = true;
      break;
    }
  }
  if (line && lines.length < 4) lines.push(line);
  else if (line) truncated = true;
  if (truncated && lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  const bw = (lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0) + 16;
  const layout = { lines, bw };
  if (bubbleCache.size > 256) bubbleCache.clear();
  bubbleCache.set(text, layout);
  return layout;
}

function drawBubble(v: View, x: number, topY: number, text: string, alpha: number) {
  if (!text) return;
  const { ctx } = v;
  const { lines, bw } = bubbleLayout(ctx, text);
  const bh = lines.length * 15 + 10;
  const bx = x - bw / 2;
  const by = topY - bh;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * Math.max(0.15, alpha);
  ctx.fillStyle = "rgba(245,240,228,0.95)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.moveTo(x - 5, by + bh);
  ctx.lineTo(x + 5, by + bh);
  ctx.lineTo(x, by + bh + 7);
  ctx.fill();
  ctx.fillStyle = "#241a14";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, by + 17 + i * 15);
  ctx.globalAlpha = prev;
}
