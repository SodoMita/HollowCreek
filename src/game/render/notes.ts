// Handwritten pages, pinned to a wall or leaning on a trunk.
// Every note always bakes its real text and author onto the paper bitmap at
// crisp 8x resolution so zooming anywhere (wheel, pinch, or spyglass) reads
// the page directly without any popout or camera hijack.
import { NOTE_FAR } from "../units";
import { cachedSprite, makeCanvas } from "./paint";
import type { PinnedNote, View } from "./view";

const PAD = 4; // extra space for drop shadow

function bakeNoteBitmap(note: PinnedNote | undefined): HTMLCanvasElement {
  const { w, h } = NOTE_FAR;
  const s = 8; // 8x bitmap density so wheel/pinch/spyglass zoom stays razor sharp
  const c = makeCanvas((w + PAD * 2) * s, (h + PAD * 2) * s);
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.translate(PAD, PAD);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillRect(1.5, 2.5, w, h);
  g.fillStyle = "#f4ead2";
  g.strokeStyle = "#8a6f4d";
  g.lineWidth = 0.85;
  g.beginPath();
  g.rect(0, 0, w, h);
  g.fill();
  g.stroke();
  // folded corner
  g.beginPath();
  g.moveTo(w, 0);
  g.lineTo(w, h * 0.2);
  g.lineTo(w - w * 0.2, 0);
  g.closePath();
  g.fillStyle = "#d8c9a8";
  g.fill();
  g.stroke();
  if (note?.text) {
    g.font = "italic 2.5px Georgia, serif";
    g.fillStyle = "#3a291a";
    g.textAlign = "left";
    const lines = wrapText(g, note.text, w - 5);
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], 2.4, 5.6 + i * 2.9);
    g.font = "italic 2.1px Georgia, serif";
    g.fillStyle = "#6e5638";
    g.textAlign = "right";
    g.fillText(`— ${note.author}`, w - 2.2, h - 2.2, w - 4.4);
  } else {
    g.strokeStyle = "#7a6a52";
    g.lineWidth = 0.9;
    g.beginPath();
    for (let i = 1; i <= 3; i++) {
      const ly = (h / 4) * i;
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
      if (lines.length === 9) break;
    } else line = test;
  }
  if (lines.length < 9 && line) lines.push(line);
  if (lines.length === 9 && ctx.measureText(`${lines[8]}…`).width > width) lines[8] = lines[8].slice(0, -1);
  if (lines.length === 9) lines[8] += "…";
  return lines;
}

/** Draws one page from its cached bitmap. Zero per-frame paths or text layout. */
export function drawNote(v: View, x: number, kind: "wall" | "tree", note: PinnedNote | undefined) {
  const { ctx, ground, t } = v;
  const { w, h } = NOTE_FAR;
  const key = `note:${note?.id ?? ""}:${note?.text ?? ""}:${note?.author ?? ""}`;
  const sprite = cachedSprite(key, 64, () => bakeNoteBitmap(note));
  const y = kind === "wall" ? ground - 118 - h : ground - 74 - h;
  const sway = Math.sin(t * 1.7 + x * 0.05) * 1.1;
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate((kind === "tree" ? 0.1 : -0.05) + sway * 0.012);
  ctx.drawImage(sprite, -w / 2 - PAD, -h - PAD, w + PAD * 2, h + PAD * 2);
  ctx.restore();
}

export function drawStreetNotes(v: View) {
  for (const note of v.snap.notes ?? []) {
    if (note.house) continue;
    const sx = note.x - v.cam;
    if (sx < -100 || sx > v.w + 100) continue;
    drawNote(v, sx, note.kind, note);
  }
}
