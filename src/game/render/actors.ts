// People on the street: the living, the caged, the ghosts, and the dead on the
// road. Name tags, action pills, speech bubbles, crows and death flashes are
// pre-baked bitmaps, and off-screen actors/bodies are culled before any work.
import { drawSvg, drawTraveler } from "../svg-assets";
import type { Snapshot } from "../types";
import { cachedSprite, drawShadowOval, getPillBadge, light, makeCanvas } from "./paint";
import { drawKit } from "./props";
import type { View } from "./view";

export interface Motion { x: number; facing: number; movingUntil: number; stride: number }

type Body = Snapshot["bodies"][number];

const crowFrames: HTMLCanvasElement[] = [];
function getCrowSprite(phase: number): HTMLCanvasElement {
  if (!crowFrames.length) {
    for (let p = 0; p < 8; p++) {
      const flap = Math.sin((p / 8) * Math.PI * 2) * 4;
      const c = makeCanvas(20, 16);
      const g = c.getContext("2d")!;
      g.strokeStyle = "#0a0608";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(3, 8 - flap);
      g.quadraticCurveTo(10, 11, 17, 8 - flap);
      g.stroke();
      crowFrames.push(c);
    }
  }
  return crowFrames[phase & 7];
}

let slashSprite: HTMLCanvasElement | null = null;
function getSlashSprite(): HTMLCanvasElement {
  if (slashSprite) return slashSprite;
  const c = makeCanvas(96, 96);
  const g = c.getContext("2d")!;
  g.strokeStyle = "#f1b1a0";
  g.lineWidth = 3.5;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    g.moveTo(13 + i * 12, 8);
    g.quadraticCurveTo(56 + i * 12, 48, 83 + i * 12, 88);
  }
  g.stroke();
  slashSprite = c;
  return c;
}

let keyIconSprite: HTMLCanvasElement | null = null;
function getKeyIcon(): HTMLCanvasElement {
  if (keyIconSprite) return keyIconSprite;
  const c = makeCanvas(20, 20);
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8b93c";
  g.font = "12px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("🗝", 10, 10);
  keyIconSprite = c;
  return c;
}

function getBubbleSprite(text: string): { canvas: HTMLCanvasElement; w: number; h: number } {
  const key = `bub:${text}`;
  let w = 0, h = 0;
  const canvas = cachedSprite(key, 256, () => {
    const s = 2;
    const measure = makeCanvas(1, 1).getContext("2d")!;
    measure.font = "12px system-ui, sans-serif";
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    let truncated = false;
    for (const wd of words) {
      const test = line ? `${line} ${wd}` : wd;
      if (measure.measureText(test).width > 150 && line) { lines.push(line); line = wd; }
      else line = test;
      if (lines.length >= 4) { truncated = true; break; }
    }
    if (line && lines.length < 4) lines.push(line);
    else if (line) truncated = true;
    if (truncated && lines.length > 0) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
    const bw = (lines.length ? Math.max(...lines.map((l) => measure.measureText(l).width)) : 0) + 16;
    const bh = lines.length * 15 + 10;
    const totalH = bh + 8;
    const c = makeCanvas(bw * s, totalH * s);
    const g = c.getContext("2d")!;
    g.scale(s, s);
    g.fillStyle = "rgba(245,240,228,0.95)";
    g.beginPath();
    g.roundRect(0, 0, bw, bh, 8);
    g.moveTo(bw / 2 - 5, bh);
    g.lineTo(bw / 2 + 5, bh);
    g.lineTo(bw / 2, bh + 7);
    g.fill();
    g.fillStyle = "#241a14";
    g.font = "12px system-ui, sans-serif";
    g.textAlign = "center";
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], bw / 2, 17 + i * 15);
    return c;
  });
  w = canvas.width / 2;
  h = canvas.height / 2;
  return { canvas, w, h };
}

const TWO_PI = Math.PI * 2;

export function drawFigure(
  ctx: CanvasRenderingContext2D, x: number, groundY: number, color: string,
  facing: number, moving: boolean, ghost: boolean, redEyes: boolean,
  stride: number, breathClock: number, worldSeed: number, bobAllowed: boolean, serverPose?: number,
) {
  const gaitCycle = serverPose ? ((serverPose - 1) / 32) * Math.PI * 2 : stride;
  const bob = bobAllowed
    ? (moving ? -Math.abs(Math.sin(gaitCycle)) * 1.6 : Math.sin(breathClock * 1.7 + worldSeed) * 0.35)
    : 0;
  // Multiplayer poses come straight from the server. Only the offline tutorial supplies a local cycle.
  const pose = serverPose ?? (moving && !ghost ? Math.floor((((stride % TWO_PI) + TWO_PI) % TWO_PI) * 32 / TWO_PI) + 1 : 0);
  ctx.translate(x, groundY + bob);
  drawTraveler(ctx, color, redEyes, ghost, pose, facing);
  ctx.translate(-x, -(groundY + bob));
}

export function drawBodies(v: View, inside: boolean) {
  const { w, cam } = v;
  for (const b of v.snap.bodies) {
    if (!!b.inside !== inside) continue;
    const bx = b.x - cam;
    if (bx < -160 || bx > w + 160) continue; // cull off-screen corpses and crows
    drawBody(v, b, bx);
  }
}

function drawBody(v: View, b: Body, bx: number) {
  const { ctx, ground, now, t, reduced } = v;
  const age = b.at ? now - b.at : 9999;
  if (age >= 0 && age < 950 && !reduced) {
    const p = age / 950;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (1 - p) * 0.7;
    const r = 70 + p * 80;
    light(ctx, bx, ground - 45, r, r, "220,40,28", 0.9);
    if (p < 0.55) ctx.drawImage(getSlashSprite(), bx - 48, ground - 113);
    ctx.globalAlpha = prev;
  }
  drawSvg(ctx, "props/blood-pool.svg", bx - 30, ground - 9, 60, 14);
  ctx.save();
  ctx.translate(bx, ground - 10);
  ctx.rotate(Math.PI / 2);
  drawTraveler(ctx, b.color, false, false, 0, 1);
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const a = t * (0.9 + i * 0.2) + i * 2.1;
    const cx = bx + Math.cos(a) * (34 + i * 14);
    const cy = ground - 120 - i * 16 + Math.sin(a * 1.7) * 10;
    const phase = Math.floor(((t * 9 + i * 2) / (Math.PI * 2)) * 8);
    ctx.drawImage(getCrowSprite(phase), cx - 10, cy - 8);
  }
}

export function drawPlayers(v: View, motion: Map<string, Motion>, pick: (p: View["sorted"][number]) => boolean) {
  for (const p of v.sorted) if (pick(p)) drawPlayer(v, motion, p);
}

function drawPlayer(v: View, motion: Map<string, Motion>, p: View["sorted"][number]) {
  const { ctx, w, t, clock, dt, cam, ground, now, snap, displayX, glassUp, reduced } = v;
  const shownX = displayX.get(p.id) ?? p.x;
  const px = shownX - cam;
  if (px < -180 || px > w + 180) return;
  const ghost = !p.alive;
  if (ghost && snap.self.alive) return;
  const isMate = snap.self.teammates.includes(p.id);
  // Decorative bob must not use moving world x as its phase (that became a ~40Hz shake).
  const floatY = ghost ? -14 + Math.sin(t * 2) * 5 : 0;

  let seen = motion.get(p.id);
  if (!seen) {
    seen = { x: shownX, facing: p.facing, movingUntil: 0, stride: 0 };
    motion.set(p.id, seen);
  }
  seen.facing = p.facing || seen.facing;
  if (p.moving && p.walkFrame === undefined) seen.stride += dt * 11;
  seen.x = shownX;
  const walking = p.moving;

  const prev = ctx.globalAlpha;
  if (ghost) ctx.globalAlpha = prev * 0.45;
  else if (p.echo) ctx.globalAlpha = prev * 0.52;
  if (!ghost) drawShadowOval(ctx, px, ground + 2, 17, 4, 0.35);
  drawFigure(ctx, px, ground + floatY, p.color, seen.facing, walking, ghost,
    isMate || (p.id === snap.self.id && snap.self.role === "hollow"),
    seen.stride, clock, p.x * 0.05, !reduced, p.walkFrame);
  ctx.globalAlpha = prev;

  if (p.hasSupply) drawKit(ctx, px - 23, ground - 16 + floatY);
  if (p.hasKey || (p.doorKeys?.length ?? 0) > 0) ctx.drawImage(getKeyIcon(), px + 6, ground - 64 + floatY);
  if (p.hasTimepiece) {
    if (v.glow) light(ctx, px + 20, ground - 52 + floatY, 14, 16, "156,218,211", 0.5);
    drawSvg(ctx, "props/timepiece.svg", px + 12, ground - 62 + floatY, 15, 20);
  }

  if (v.playerNames && !glassUp) {
    const tag = p.echo ? " · echo" : snap.phase === "meeting" && p.voted ? " ✓" : "";
    const label = tag ? p.name + tag : p.name;
    const fg = p.id === snap.self.id ? "#ffd98a" : p.echo ? "#b9d9d5" : isMate ? "#ff7a6a" : "rgba(245,235,220,.96)";
    const badge = getPillBadge(`n:${fg}:${label}`, label, "600 12px system-ui, sans-serif", "rgba(5,3,8,.55)", fg, 5, 17);
    ctx.drawImage(badge.canvas, px - badge.w / 2, ground - 75 + floatY, badge.w, badge.h);
  }
  if (p.action && p.action.until > now && !glassUp) {
    const fg = p.echo ? "#bde6dc" : "#f2d1a2";
    const badge = getPillBadge(`a:${fg}:${p.action.text}`, p.action.text, "600 10px system-ui, sans-serif", "rgba(20,27,29,.9)", fg, 6, 16);
    ctx.drawImage(badge.canvas, px - badge.w / 2, ground - 98 + floatY, badge.w, badge.h);
  }
  if (p.bubble && v.speechBubbles && !glassUp && p.bubble.text) {
    const bub = getBubbleSprite(p.bubble.text);
    const a = Math.max(0.15, Math.min(1, (p.bubble.until - now) / 800));
    const topY = ground - (p.action ? 100 : 72) + floatY;
    ctx.globalAlpha = prev * a;
    ctx.drawImage(bub.canvas, px - bub.w / 2, topY - (bub.h - 8), bub.w, bub.h);
    ctx.globalAlpha = prev;
  }
}
