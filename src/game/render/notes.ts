// Handwritten pages, pinned to a wall or leaning on a trunk. Far pages are one
// pre-baked scribble bitmap; close-up focused pages are cached per note content.
import { NOTE_FAR, NOTE_NEAR } from "../units";
import { cachedSprite, makeCanvas } from "./paint";
import type { PinnedNote, View } from "./view";

const PAD = 6; // extra space for drop shadow

function bakeNoteBitmap(big: boolean, note: PinnedNote | undefined): HTMLCanvasElement {
  const { w, h } = big ? NOTE_NEAR : NOTE_FAR;
  const s = big ? 4 : 2;
  const c = makeCanvas((w + PAD * 2) * s, (h + PAD * 2) * s);
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.translate(PAD, PAD);
  const offset = big ? 5 : 2;
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(offset * 0.5, offset, w, h);
  g.fillStyle = big ? "#f4ead2" : "#e9dfc4";
  g.strokeStyle = "#8a6f4d";
  g.lineWidth = big ? 1.6 : 1;
  g.beginPath();
  g.rect(0, 0, w, h);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(w, 0);
  g.lineTo(w, h * 0.2);
  g.lineTo(w - w * 0.2, 0);
  g.closePath();
  g.fillStyle = "#d8c9a8";
  g.fill();
  g.stroke();
  if (big && note?.text) {
    g.font = "italic 6.5px Georgia, serif";
    g.fillStyle = "#43301f";
    g.textAlign = "left";
    const lines = wrapText(g, note.text, w - 14);
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 7, 15 + i * 8);
    g.font = "italic 5.5px Georgia, serif";
    g.fillStyle = "#6e5638";
    g.textAlign = "right";
    g.fillText(`— ${note.author}`, w - 7, h - 6, w - 14);
  } else {
    const lines = big ? 8 : 3;
    g.strokeStyle = "#7a6a52";
    g.lineWidth = big ? 1.4 : 1;
    g.beginPath();
    for (let i = 1; i <= lines; i++) {
      const ly = (h / (lines + 1)) * i;
      g.moveTo(w * 0.16, ly);
      g.lineTo(w * (0.84 - (i % 3) * 0.08), ly);
    }
    g.stroke();
  }
  return c;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
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
  return lines;
}

/** Draws one page from its cached bitmap. Zero per-frame paths or text layout. */
export function drawNote(v: View, x: number, kind: "wall" | "tree", big: boolean, note: PinnedNote | undefined) {
  const { ctx, ground, t } = v;
  const { w, h } = big ? NOTE_NEAR : NOTE_FAR;
  const key = big ? `near:${note?.id ?? ""}:${note?.text ?? ""}:${note?.author ?? ""}` : "far";
  const sprite = cachedSprite(key, 64, () => bakeNoteBitmap(big, note));
  const y = kind === "wall" ? ground - 118 - h : ground - 74 - h;
  const sway = Math.sin(t * 1.7 + x * 0.05) * (big ? 1.2 : 1.1);
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate((kind === "tree" ? 0.1 : -0.05) + sway * 0.012);
  ctx.drawImage(sprite, -w / 2 - PAD, -h - PAD, w + PAD * 2, h + PAD * 2);
  ctx.restore();
}

export function isNoteReadable(v: View, sx: number, noteX: number): boolean {
  if (v.focused && v.focusX === noteX) return true;
  return v.zoom >= 1.9 && Math.abs(sx - v.w / 2) <= 260;
}

export function drawStreetNotes(v: View) {
  for (const note of v.snap.notes ?? []) {
    if (note.house) continue;
    const sx = note.x - v.cam;
    if (sx < -100 || sx > v.w + 100) continue;
    drawNote(v, sx, note.kind, isNoteReadable(v, sx, note.x), note);
  }
}
