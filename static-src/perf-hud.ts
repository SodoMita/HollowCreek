// Opt-in performance readout for the framework-free game screen.
// Toggle with F3 or open the client with `?perf=1`. It measures only: drawn
// frames per second, render milliseconds, HUD writes skipped by the memo, and
// the latest state round trip. Nothing here talks to the server.

export interface PerfSample {
  fps: number;
  renderMs: number;
  worstMs: number;
  hud: { writes: number; skips: number };
  rttMs: number;
  pollMs: number;
  quality: string;
  dpr: number;
}

export class PerfHud {
  private el: HTMLDivElement | null = null;
  private frames = 0;
  private drawnMs = 0;
  private worst = 0;
  private since = 0;
  visible = false;
  /** Rendered frames per second over the last window (0 until measured). */
  fps = 0;

  constructor(private readonly read: () => PerfSample) {}

  toggle(force?: boolean) {
    this.visible = force ?? !this.visible;
    if (this.visible) this.mount();
    if (this.el) this.el.style.display = this.visible ? "block" : "none";
  }

  private mount() {
    if (this.el?.isConnected) return;
    const el = document.createElement("div");
    el.id = "hc-perf";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "off");
    el.style.cssText = [
      "position:fixed", "left:8px", "bottom:8px", "z-index:80",
      "padding:7px 9px", "border:1px solid #6a4d3a", "border-radius:7px",
      "background:rgba(12,8,15,.88)", "color:#d9c3a4", "font:11px/1.45 ui-monospace,monospace",
      "white-space:pre", "pointer-events:none", "max-width:250px",
    ].join(";");
    document.body.appendChild(el);
    this.el = el;
  }

  /** One rendered frame: its draw cost in milliseconds. Returns the fps once a window closes. */
  sample(renderMs: number): number {
    const now = performance.now();
    this.frames++;
    this.drawnMs += Math.max(0, renderMs);
    if (renderMs > this.worst) this.worst = renderMs;
    if (!this.since) { this.since = now; return 0; }
    const seconds = (now - this.since) / 1000;
    if (seconds < 0.9) return 0;
    this.fps = this.frames / seconds;
    const avg = this.drawnMs / Math.max(1, this.frames);
    if (this.visible && this.el) {
      const sample = this.read();
      sample.fps = this.fps;
      sample.renderMs = avg;
      sample.worstMs = this.worst;
      this.el.textContent = [
        `${sample.fps.toFixed(0)} fps · draw ${avg.toFixed(1)} ms (worst ${this.worst.toFixed(1)})`,
        `state rtt ${sample.rttMs.toFixed(0)} ms · poll ${sample.pollMs.toFixed(0)} ms`,
        `hud writes ${sample.hud.writes} · skipped ${sample.hud.skips}`,
        `${sample.quality} · dpr ${sample.dpr.toFixed(2)}`,
        "F3 hides this",
      ].join("\n");
      this.el.dataset.fps = sample.fps.toFixed(0);
      this.el.dataset.drawMs = avg.toFixed(1);
      this.el.dataset.hudWrites = String(sample.hud.writes);
    }
    this.frames = 0;
    this.drawnMs = 0;
    this.worst = 0;
    this.since = now;
    return this.fps;
  }
}

/** Reads `?perf=1` so a player can report real numbers. */
export function wantPerfHud(): boolean {
  const params = new URLSearchParams(location.search);
  return params.get("perf") === "1";
}
