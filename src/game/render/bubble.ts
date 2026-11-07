// Speech bubble above a figure. The wrapped lines are cached by text.
import { lruGet, lruSet, type DrawEnv } from "./env";

export function drawBubble(ctx: CanvasRenderingContext2D, x: number, topY: number, text: string, alpha: number, env: DrawEnv) {
  ctx.save();
  ctx.globalAlpha = Math.max(0.15, alpha);
  ctx.font = "12px system-ui, sans-serif";
  if (!text) { ctx.restore(); return; } // empty bubble: keep save/restore balanced
  let wrapped = lruGet(env.bubbleWrap, text);
  if (!wrapped) {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    let truncated = false;
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > 150 && line) { lines.push(line); line = wd; }
      else line = test;
      if (lines.length >= 4) { truncated = true; break; } // keep wrapping visible, mark with ellipsis below
    }
    if (line && lines.length < 4) lines.push(line);
    else if (line) truncated = true;
    if (truncated && lines.length > 0) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + "…";
    const bw = (lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0) + 16;
    wrapped = { lines, bw };
    lruSet(env.bubbleWrap, text, wrapped, 512);
  }
  const { lines, bw } = wrapped;
  const bh = lines.length * 15 + 10;
  const bx = x - bw / 2, by = topY - bh;
  ctx.fillStyle = "rgba(245,240,228,0.95)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.moveTo(x - 5, by + bh); ctx.lineTo(x + 5, by + bh); ctx.lineTo(x, by + bh + 7);
  ctx.fill();
  ctx.fillStyle = "#241a14";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, x, by + 17 + i * 15));
  ctx.restore();
}
