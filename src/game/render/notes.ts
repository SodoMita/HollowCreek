// Handwritten pages, pinned to a wall or leaning on a trunk. From the road they are
// a scribble; under the glass the words are written on the paper itself.
import { NOTE_FAR, NOTE_NEAR } from "../units";
import type { PinnedNote, View } from "./view";

const wrapCache = new Map<string, string[]>();

/** Draws one page. `big` is the close, legible size. */
export function drawNote(v: View, x: number, kind: "wall" | "tree", big: boolean, note: PinnedNote | undefined) {
  const { ctx, ground, t } = v;
  const { w, h } = big ? NOTE_NEAR : NOTE_FAR;
  const y = kind === "wall" ? ground - 118 - h : ground - 74 - h;
  const sway = Math.sin(t * 1.7 + x * 0.05) * (big ? 1.2 : 1.1);
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate((kind === "tree" ? 0.1 : -0.05) + sway * 0.012);
  ctx.translate(-w / 2, -h);
  // A flat offset under the paper stands in for a blurred shadow.
  const offset = big ? 5 : 2;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(offset * 0.5, offset, w, h);
  ctx.fillStyle = big ? "#f4ead2" : "#e9dfc4";
  ctx.strokeStyle = "#8a6f4d";
  ctx.lineWidth = big ? 1.6 : 1;
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.fill();
  ctx.stroke();
  // folded corner
  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(w, h * 0.2);
  ctx.lineTo(w - w * 0.2, 0);
  ctx.closePath();
  ctx.fillStyle = "#d8c9a8";
  ctx.fill();
  ctx.stroke();
  if (big && note?.text) {
    ctx.font = "italic 6.5px Georgia, serif";
    ctx.fillStyle = "#43301f";
    ctx.textAlign = "left";
    const lines = wrapNote(ctx, note.text, w - 14);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 7, 15 + i * 8);
    ctx.font = "italic 5.5px Georgia, serif";
    ctx.fillStyle = "#6e5638";
    ctx.textAlign = "right";
    ctx.fillText(`— ${note.author}`, w - 7, h - 6, w - 14);
  } else {
    // Far away the hand is only a scribble.
    const lines = big ? 8 : 3;
    ctx.strokeStyle = "#7a6a52";
    ctx.lineWidth = big ? 1.4 : 1;
    ctx.beginPath();
    for (let i = 1; i <= lines; i++) {
      const ly = (h / (lines + 1)) * i;
      ctx.moveTo(w * 0.16, ly);
      ctx.lineTo(w * (0.84 - (i % 3) * 0.08), ly);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Word-wrap to a pixel width: at most ten lines, the last one ellipsised. Cached by text. */
function wrapNote(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const hit = wrapCache.get(text);
  if (hit) return hit;
  const font = ctx.font;
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > width && line) {
      lines.push(line);
      line = word;
      if (lines.length === 10) break;
    } else line = test;
  }
  if (lines.length < 10 && line) lines.push(line);
  if (lines.length === 10 && ctx.measureText(`${lines[9]}…`).width > width) lines[9] = lines[9].slice(0, -1);
  if (lines.length === 10) lines[9] += "…";
  ctx.font = font;
  if (wrapCache.size > 64) wrapCache.clear();
  wrapCache.set(text, lines);
  return lines;
}

/** Pages on the street: walls and tree trunks. Interior pages are drawn with their house. */
export function drawStreetNotes(v: View) {
  for (const note of v.snap.notes ?? []) {
    if (note.house) continue;
    const sx = note.x - v.cam;
    if (sx < -100 || sx > v.w + 100) continue;
    drawNote(v, sx, note.kind, v.focused && v.focusX === note.x, note);
  }
}
