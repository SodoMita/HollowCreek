// The creek strip: a read-only sense of the whole valley under the top bar.
// Plain DOM, no framework. Only what the snapshot already reveals is drawn;
// vision filtering happens on the server, so this never leaks a hidden soul.
import { WORLD_MIN, WORLD_MAX } from "../src/game/buildings";
import { BELL_X, MEETING_FROM, MEETING_TO } from "../src/game/types";
import type { Snapshot } from "../src/game/types";

const pct = (x: number) => ((x - WORLD_MIN) / (WORLD_MAX - WORLD_MIN)) * 100;
const at = (x: number) => `left:${pct(x).toFixed(3)}%`;
const span = (x0: number, x1: number) => `left:${pct(x0).toFixed(3)}%;width:${(pct(x1) - pct(x0)).toFixed(3)}%`;

// Player colors are server data. Accept only a plain hex color inside the style attribute.
const soulColor = (c: string) => (/^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#c9b8a4");

function wardClass(t: Snapshot["tasks"][number]): string {
  const shape = t.inside ? "mm-ward mm-diamond" : "mm-ward";
  const tone = t.done ? "mm-done" : t.sabotaged ? "mm-ruin" : t.delivered ? "mm-ready" : "mm-idle";
  return `${shape} ${tone}`;
}

export function minimapMarkup(s: Snapshot): string {
  const selfX = s.players.find((p) => p.id === s.self.id)?.x;
  const parts: string[] = [];
  parts.push(`<div class="mm-road"></div>`);
  parts.push(`<div class="mm-meet ${s.phase === "meeting" ? "mm-meet-live" : ""}" style="${span(MEETING_FROM, MEETING_TO)}"></div>`);
  if (typeof selfX === "number" && s.visionRadius < 1500) {
    parts.push(`<div class="mm-reach" style="${span(selfX - s.visionRadius, selfX + s.visionRadius)}"></div>`);
  }
  for (const t of s.tasks) parts.push(`<span class="${wardClass(t)}" style="${at(t.x)}"></span>`);
  // the meeting bell, engraved in brass like the rest of the rail
  parts.push(`<svg class="mm-bell" viewBox="0 0 10 10" style="${at(BELL_X)}" aria-hidden="true"><path d="M5 1.2c-1.9 0-2.7 1.5-2.7 3.1 0 1.5-.6 2.2-1.1 2.7h7.6c-.5-.5-1.1-1.2-1.1-2.7 0-1.6-.8-3.1-2.7-3.1Z" fill="#d99a3d"/><circle cx="5" cy="8.2" r="0.9" fill="#d99a3d"/></svg>`);
  parts.push(`<span class="mm-cart" style="${at(s.cartX)}"></span>`);
  for (const c of s.cages) parts.push(`<span class="mm-cage ${c.occupant ? "mm-cage-full" : ""}" style="${at(c.x)}"></span>`);
  for (const p of s.players) {
    if (p.id === s.self.id) continue;
    parts.push(`<span class="mm-soul ${p.alive ? "" : "mm-dead"}" style="${at(p.x)};background:${soulColor(p.color)}"></span>`);
  }
  if (typeof selfX === "number") parts.push(`<span class="mm-you" style="${at(selfX)}"></span>`);
  return `<div class="mm-rail">${parts.join("")}</div>`;
}

/** Shows the strip while playing and the glass is down; hides it otherwise. */
export class Minimap {
  private readonly el: HTMLElement;
  private last = "";

  constructor(el: HTMLElement) { this.el = el; }

  update(s: Snapshot, glassUp: boolean): void {
    const past = s.time?.mode === "past";
    const show = s.phase === "playing" && !glassUp;
    // Visibility is a class, not inline style: the stylesheet hides the past-time strip on phones.
    this.el.classList.toggle("hc-on", show);
    this.el.classList.toggle("past", past);
    if (!show) { this.last = ""; return; }
    const html = minimapMarkup(s);
    if (html !== this.last) {
      this.last = html;
      this.el.innerHTML = html;
    }
  }
}
