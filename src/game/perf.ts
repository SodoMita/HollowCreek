// Client performance helpers for the framework-free game screen.
//
// Two costs dominate an idle room: redrawing a canvas that did not change, and
// rebuilding HUD markup when only a countdown moved. Both are handled here with
// pure, testable state so `static-src/main.ts` stays a thin wiring layer.
//
// Nothing here touches game state: the server stays authoritative and this
// module only decides *when* the browser paints.
import type { Snapshot } from "./types";
import { BELL_X } from "./types";

export type Quality = "low" | "medium" | "high";

export interface FrameInput {
  /** performance.now() of the animation frame. */
  now: number;
  /** The tab is hidden — never draw. */
  hidden?: boolean;
  /** A full-screen lobby/results overlay covers the canvas. */
  overlay?: boolean;
  quality: Quality;
  /** The player asked for reduced motion: the scene is static between polls. */
  reducedMotion?: boolean;
  /** No new snapshot since the last draw and no local input held. */
  idle?: boolean;
}

/**
 * Picks the frames worth drawing.
 *
 * - hidden tab: nothing (browsers throttle rAF, embedded WebViews may not)
 * - lobby/results overlay covers the canvas: ~8 fps, enough for life behind glass
 * - reduced motion + no new data: 2 fps (the scene cannot change by itself)
 * - low/medium detail: 20/30 fps caps, the two presets used on weaker hardware
 * - high detail: every animation frame
 *
 * A small tolerance keeps a 60 Hz rAF from slipping to 20 fps when the cap is
 * 30: 16.7 ms frames must pass a 32 ms gate on the second frame, not the third.
 */
export class FrameBudget {
  private lastDraw = Number.NEGATIVE_INFINITY;
  private previousDraw = Number.NEGATIVE_INFINITY;
  private drawn = 0;
  private skipped = 0;

  static intervalFor(input: Omit<FrameInput, "now">): number {
    if (input.hidden) return Infinity;
    if (input.overlay) return 120;
    if (input.reducedMotion && input.idle) return 500;
    if (input.quality === "low") return 48;
    if (input.quality === "medium") return 32;
    return 0;
  }

  shouldRender(input: FrameInput): boolean {
    const interval = FrameBudget.intervalFor(input);
    if (interval === Infinity) return false;
    const tolerance = interval > 0 ? 6 : 0;
    if (interval > 0 && input.now - this.lastDraw < interval - tolerance) {
      this.skipped++;
      return false;
    }
    this.previousDraw = this.lastDraw;
    this.lastDraw = input.now;
    this.drawn++;
    return true;
  }

  /**
   * Gap between the two most recent accepted frames, in seconds. A capped
   * frame must move by the time it actually represents, otherwise 30 fps
   * walks slower than 60 fps. Capped so a stalled tab cannot jump the scene.
   */
  dtSince(now: number, fallback = 1 / 60): number {
    if (!Number.isFinite(this.previousDraw)) return fallback;
    return Math.min(0.1, Math.max(0.001, (now - this.previousDraw) / 1000));
  }

  /** After a hidden tab or a settings change, draw the next frame immediately. */
  reset() { this.lastDraw = Number.NEGATIVE_INFINITY; this.previousDraw = Number.NEGATIVE_INFINITY; }

  get stats(): { drawn: number; skipped: number } { return { drawn: this.drawn, skipped: this.skipped }; }
}

/**
 * Write-only-if-changed memo for HUD regions. Each slot keeps the exact string
 * that was last put in the DOM, so a 10 Hz poll that changes nothing costs a
 * few string compares instead of `innerHTML` parsing, layout and paint.
 */
export class HudMemo {
  private readonly slots = new Map<string, string>();
  private writes = 0;
  private skips = 0;

  /** @returns true when the caller must update the DOM. */
  changed(slot: string, value: string): boolean {
    if (this.slots.get(slot) === value) { this.skips++; return false; }
    this.slots.set(slot, value);
    this.writes++;
    return true;
  }

  /** Forget a slot (e.g. when leaving a room) so the next render always writes. */
  forget(slot?: string) {
    if (slot === undefined) this.slots.clear();
    else this.slots.delete(slot);
  }

  get stats(): { writes: number; skips: number } { return { writes: this.writes, skips: this.skips }; }
}

/** The numbers in the HUD that move with the clock rather than with the state. */
export interface HudTick {
  meeting?: string;
  status?: string;
  ruin?: string;
  ability?: string;
}

const seconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
const cooldown = (label: string, ms: number, max = 999) => {
  const left = seconds(ms);
  return left > 0 && left <= max ? `${label}${left}s` : "";
};

/**
 * Sub-second HUD text, computed from the snapshot's own clock (`self.now`,
 * advanced locally between polls) so an idle long-poll can refresh the
 * countdowns without rebuilding the panel.
 */
export function hudTick(s: Snapshot): HudTick {
  const out: HudTick = {};
  if (s.phase === "meeting" && s.meeting) {
    const left = seconds(s.meeting.endsAt - s.now);
    const me = s.players.find((p) => p.id === s.self.id);
    out.meeting = s.meeting.inArea
      ? `Cast your verdict — <b>${left}s</b>`
      : `Walk to the town square ${me && me.x < BELL_X ? "→ east" : "← west"} — <b>${left}s</b>`;
  }
  if (s.time?.mode === "past") {
    out.status = `In the past · ${seconds((s.time.endsAt ?? s.now) - s.now)}s remaining · M to return`;
  }
  if (s.phase === "playing" && s.self.role === "hollow" && s.self.alive) {
    // Suffix only: the button keeps its live key label from the settings.
    out.ruin = s.self.sabotageCooldownMs > 0 ? ` · ${seconds(s.self.sabotageCooldownMs)}s` : "";
  }
  if (s.self.role === "hollow" && s.self.alive) {
    const kill = cooldown("", s.self.killCooldownMs);
    const snuff = cooldown("🌑", s.self.blackoutCooldownMs);
    out.ability = `${kill}${snuff ? ` ${snuff}` : ""}`;
  }
  return out;
}

/** Compact, allocation-light keys for the three rebuilt HUD regions. */
export function tasksKey(s: Snapshot, open: boolean): string {
  if (s.phase === "lobby" || !s.self.alive || !s.tasks.length) return "";
  let key = open ? "1" : "0";
  for (const t of s.tasks) key += `|${t.id}:${t.done ? 2 : t.delivered ? 1 : 0}:${t.progress.toFixed(2)}:${t.sabotaged ? 1 : 0}`;
  return key;
}

export function feedKey(s: Snapshot): string {
  const tail = s.feed.slice(-4);
  let key = "";
  for (const entry of tail) key += `${entry.text.length}:${entry.text}`;
  return key;
}

export function voteKey(s: Snapshot): string {
  if (s.phase !== "meeting" || !s.meeting?.inArea || !s.self.alive) return "";
  let key = `${s.self.myVote ?? ""}`;
  for (const p of s.players) key += `|${p.id}:${p.alive ? 1 : 0}:${p.caged ? 1 : 0}`;
  return key;
}
