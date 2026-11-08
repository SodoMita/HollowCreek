// The creek strip: a read-only sense of the whole valley under the top bar.
// Plain DOM, no framework. Only what the snapshot already reveals is drawn;
// vision filtering happens on the server, so this never leaks a hidden soul.
//
// Structural HTML (wards, cages, bell, roster) is rebuilt only when states or
// membership change; moving markers (you, vision, cart, souls) update in place
// via style properties so walking triggers zero DOM node creation.
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

/** Shows the strip while playing and the glass is down; updates moving pins in place. */
export class Minimap {
  private readonly el: HTMLElement;
  private structKey = "";
  private youEl: HTMLElement | null = null;
  private reachEl: HTMLElement | null = null;
  private cartEl: HTMLElement | null = null;
  private soulEls: HTMLElement[] = [];

  constructor(el: HTMLElement) { this.el = el; }

  update(s: Snapshot, glassUp: boolean): void {
    const past = s.time?.mode === "past";
    const show = s.phase === "playing" && !glassUp;
    this.el.classList.toggle("hc-on", show);
    this.el.classList.toggle("past", past);
    if (!show) { this.structKey = ""; return; }

    const self = s.players.find((p) => p.id === s.self.id);
    const hasSelf = !!self;
    const hasReach = hasSelf && s.visionRadius < 1500;
    const key = [
      s.phase,
      hasSelf ? 1 : 0,
      hasReach ? s.visionRadius : 0,
      s.tasks.map((t) => (t.done ? 3 : t.sabotaged ? 2 : t.delivered ? 1 : 0)).join(""),
      s.cages.map((c) => (c.occupant ? 1 : 0)).join(""),
      s.players.map((p) => (p.id === s.self.id ? "" : `${p.id}:${p.alive ? 1 : 0}:${p.color}`)).join(","),
    ].join("|");

    if (key !== this.structKey) {
      this.structKey = key;
      this.el.innerHTML = minimapMarkup(s);
      this.youEl = this.el.querySelector(".mm-you");
      this.reachEl = this.el.querySelector(".mm-reach");
      this.cartEl = this.el.querySelector(".mm-cart");
      this.soulEls = Array.from(this.el.querySelectorAll(".mm-soul"));
      return;
    }

    if (self && this.youEl) this.youEl.style.left = `${pct(self.x).toFixed(3)}%`;
    if (self && this.reachEl) {
      this.reachEl.style.left = `${pct(self.x - s.visionRadius).toFixed(3)}%`;
      this.reachEl.style.width = `${(pct(self.x + s.visionRadius) - pct(self.x - s.visionRadius)).toFixed(3)}%`;
    }
    if (this.cartEl) this.cartEl.style.left = `${pct(s.cartX).toFixed(3)}%`;
    let si = 0;
    for (const p of s.players) {
      if (p.id === s.self.id) continue;
      const node = this.soulEls[si++];
      if (node) node.style.left = `${pct(p.x).toFixed(3)}%`;
    }
  }
}
