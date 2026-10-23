// The ward board, drawn in plain DOM so the React client and the static client
// can mount the exact same game. No framework, inline styles, one callback.
import type { Snapshot } from "./types";
import { bandAt, markerAt, SEQ_GLYPHS, type WardBoard } from "./wardplay";

export type WardAction = "strike" | "tap" | "close";
export interface WardHandle {
  update(s: Snapshot): void;
  destroy(): void;
}

const GLYPH_PATHS: Record<string, string> = {
  // simple marks that read at any size
  sun: "M32 14v8M32 42v8M14 32h8M42 32h8M19 19l6 6M39 39l6 6M45 19l-6 6M25 39l-6 6M32 32m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0",
  bell: "M32 12c-2 0-3 1-3 3v2c-7 2-11 8-11 15v6l-3 5h34l-3-5v-6c0-7-4-13-11-15v-2c0-2-1-3-3-3zM28 48a4 4 0 0 0 8 0",
  thorn: "M14 50 50 14M22 42l-8-2 2 8M42 22l8 2-2-8M32 32l10 10M32 32 22 22",
  eye: "M8 32c8-11 16-16 24-16s16 5 24 16c-8 11-16 16-24 16S16 43 8 32zM32 32m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0",
};

export function mountWardUI(root: HTMLElement, onAction: (a: WardAction, v?: number) => void): WardHandle {
  root.style.cssText = [
    "position:absolute", "left:50%", "bottom:12%", "transform:translateX(-50%)",
    "z-index:15", "width:min(92vw,520px)", "display:none",
    "background:rgba(11,10,12,0.92)", "border:1px solid #2a2028",
    "padding:14px 16px 16px", "color:#E8DFCF", "font-family:'Space Grotesk',system-ui,sans-serif",
    "box-shadow:0 24px 60px -30px rgba(0,0,0,0.9)",
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = "font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:#9C9287;display:flex;justify-content:space-between;align-items:center";
  const close = document.createElement("button");
  close.textContent = "LEAVE";
  close.style.cssText = "border:1px solid #2a2028;background:none;color:#6f6459;font-size:9px;letter-spacing:0.24em;padding:4px 10px;cursor:pointer";
  close.addEventListener("click", () => onAction("close"));

  const track = document.createElement("div");
  track.style.cssText = "position:relative;height:58px;margin:14px 0 6px;background:#171219;border:1px solid #2a2028;overflow:hidden";
  const band = document.createElement("div");
  band.style.cssText = "position:absolute;top:0;bottom:0;background:rgba(123,18,32,0.55);border-left:1px solid #C2404C;border-right:1px solid #C2404C";
  const marker = document.createElement("div");
  marker.style.cssText = "position:absolute;top:4px;bottom:4px;width:4px;background:#E8DFCF;box-shadow:0 0 12px rgba(232,223,207,0.6)";
  track.append(band, marker);

  const pips = document.createElement("div");
  pips.style.cssText = "display:flex;gap:6px;margin:8px 0 2px";

  const buttons = document.createElement("div");
  buttons.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px";

  const hint = document.createElement("p");
  hint.style.cssText = "margin:10px 0 0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#6f6459";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:12px";
  const name = document.createElement("span");
  name.style.cssText = "font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#E8DFCF";
  head.append(name, close);

  root.append(head, title, track, pips, buttons, hint);

  let board: WardBoard | null = null;
  let startedAt = 0;
  let need = 0;
  let hits = 0;
  let taps: number[] = [];
  let syncAt = 0;
  let syncElapsed = 0;
  let raf = 0;

  const strike = () => onAction("strike");

  const glyphSvg = (i: number, active: boolean) => {
    const key = SEQ_GLYPHS[i % SEQ_GLYPHS.length];
    return `<svg viewBox="0 0 64 64" width="34" height="34" aria-hidden><path d="${GLYPH_PATHS[key]}" fill="none" stroke="${active ? "#E8DFCF" : "#9C9287"}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };

  const renderButtons = () => {
    buttons.innerHTML = "";
    if (!board || board.kind !== "sequence") return;
    for (let i = 0; i < 4; i++) {
      const b = document.createElement("button");
      b.innerHTML = glyphSvg(i, false);
      b.style.cssText = [
        "display:flex", "align-items:center", "justify-content:center", "height:64px",
        "background:#171219", "border:1px solid #2a2028", "cursor:pointer", "padding:0",
      ].join(";");
      b.addEventListener("click", () => onAction("tap", i));
      buttons.append(b);
    }
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!board || root.style.display === "none") return;
    const elapsed = syncElapsed + (Date.now() - syncAt) / 1000;
    if (board.kind === "strike") {
      const m = markerAt(board, elapsed) * 100;
      const c = bandAt(board, hits) * 100;
      marker.style.left = `calc(${m}% - 2px)`;
      band.style.left = `${c - board.half * 100}%`;
      band.style.width = `${board.half * 200}%`;
    }
    title.textContent =
      board.kind === "strike"
        ? `strike ${hits} / ${need}`
        : `repeat the pattern · ${taps.length} / ${board.seq.length}`;
    pips.innerHTML = "";
    for (let i = 0; i < need; i++) {
      const dot = document.createElement("span");
      const filled = i < hits || (board.kind === "sequence" && i < taps.length);
      dot.style.cssText = `width:100%;height:4px;background:${filled ? "#C2404C" : "#2a2028"}`;
      pips.append(dot);
    }
    track.style.display = board.kind === "strike" ? "block" : "none";
    hint.textContent =
      board.kind === "strike"
        ? "tap / space when the bone-white marker is inside the red band"
        : "tap the glyphs in the order shown";
  };

  const keyHandler = (e: KeyboardEvent) => {
    if (root.style.display === "none") return;
    if (e.code === "Space" || e.code === "KeyE") {
      if (board?.kind === "strike") {
        e.preventDefault();
        strike();
      }
    }
    if (board?.kind === "sequence" && ["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
      e.preventDefault();
      onAction("tap", Number(e.code.slice(5)) - 1);
    }
    if (e.code === "Escape") onAction("close");
  };
  window.addEventListener("keydown", keyHandler);
  track.addEventListener("pointerdown", strike);
  raf = requestAnimationFrame(tick);

  return {
    update(s: Snapshot) {
      const w = s.ward;
      if (!w) {
        root.style.display = "none";
        board = null;
        return;
      }
      name.textContent = w.name;
      need = w.need;
      hits = w.hits;
      taps = w.taps ?? [];
      startedAt = w.startedAt;
      syncAt = Date.now();
      syncElapsed = (s.now - startedAt) / 1000;
      if (!board || board.seed !== w.seed || board.kind !== w.kind) {
        board = { kind: w.kind, seed: w.seed, need: w.need, speed: w.speed, half: w.half, spin: w.spin, seq: w.seq };
        renderButtons();
        root.style.display = "block";
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", keyHandler);
      root.innerHTML = "";
    },
  };
}
