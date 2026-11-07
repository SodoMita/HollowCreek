// Handwritten pages: pinned to a wall or leaning on a trunk, and legible only
// when the view is focused on them.
import { NOTE_FAR, NOTE_NEAR } from "../units";
import { lruGet, lruSet, type DrawEnv } from "./env";
import type { Frame } from "./frame";

/** A handwritten page pinned to a wall face or leaning on a trunk.
 *  Up close the real words are legible on the paper itself — no pop-out. */
export function drawNote(
  ctx: CanvasRenderingContext2D, x: number, ground: number, kind: "wall" | "tree",
  big: boolean, t: number, note: { author: string; text: string } | undefined, env: DrawEnv,
) {
  const { w, h } = big ? NOTE_NEAR : NOTE_FAR;
  const y = kind === "wall" ? ground - 118 - h : ground - 74 - h;
  const sway = Math.sin(t * 1.7 + x * 0.05) * (big ? 1.2 : 1.1);
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate((kind === "tree" ? 0.10 : -0.05) + sway * 0.012);
  ctx.translate(-w / 2, -h);
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = big ? 14 : 6; ctx.shadowOffsetY = big ? 5 : 2;
  ctx.fillStyle = big ? "#f4ead2" : "#e9dfc4";
  ctx.strokeStyle = "#8a6f4d"; ctx.lineWidth = big ? 1.6 : 1;
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // folded corner
  ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(w, h * 0.2); ctx.lineTo(w - w * 0.2, 0); ctx.closePath();
  ctx.fillStyle = "#d8c9a8"; ctx.fill(); ctx.stroke();
  if (big && note?.text) {
    ctx.fillStyle = "#43301f";
    ctx.font = "italic 6.5px Georgia, serif";
    ctx.textAlign = "left";
    const lines = wrapNote(ctx, note.text, w - 14, env);
    lines.forEach((line, i) => ctx.fillText(line, 7, 15 + i * 8));
    ctx.font = "italic 5.5px Georgia, serif";
    ctx.fillStyle = "#6e5638";
    ctx.textAlign = "right";
    ctx.fillText(`— ${note.author}`, w - 7, h - 6, w - 14);
  } else {
    // far away the hand is only a scribble
    ctx.strokeStyle = "#7a6a52"; ctx.lineWidth = big ? 1.4 : 1;
    const lines = big ? 8 : 3;
    for (let i = 1; i <= lines; i++) {
      const ly = (h / (lines + 1)) * i;
      ctx.beginPath(); ctx.moveTo(w * 0.16, ly); ctx.lineTo(w * (0.84 - (i % 3) * 0.08), ly); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Word-wrap a note to a pixel width (at most 10 lines, last one ellipsised). Cached by text. */
function wrapNote(ctx: CanvasRenderingContext2D, text: string, width: number, env: DrawEnv): string[] {
  const hit = lruGet(env.noteWrap, text);
  if (hit) return hit;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > width && line) {
      lines.push(line); line = word;
      if (lines.length === 10) break;
    } else line = test;
  }
  if (lines.length < 10 && line) lines.push(line);
  if (lines.length === 10 && ctx.measureText(lines[9] + "…").width > width) lines[9] = lines[9].slice(0, -1);
  if (lines.length === 10) lines[9] += "…";
  lruSet(env.noteWrap, text, lines, 64);
  return lines;
}

/** Pages on the street: walls and tree trunks. Interior pages are drawn with their house. */
export function drawPinnedNotes(f: Frame, env: DrawEnv) {
  const { ctx, t, cam, ground, w, snap, focused, focusX } = f;
  for (const note of snap.notes ?? []) {
    if (note.house) continue; // interior pages are drawn with their house
    const sx = note.x - cam;
    if (sx < -100 || sx > w + 100) continue;
    const big = focused && focusX === note.x;
    drawNote(ctx, sx, ground, note.kind, big, t, note, env);
  }
}
