// A single accessible time-selection dialog shared by both game clients.
import { trapTab } from "./focus-trap";
import type { TimeView } from "./types";

const STYLE_ID = "hc-timepiece-style";
function styles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style"); style.id = STYLE_ID;
  style.textContent = `
    .hc-time-root{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,5,13,.84);backdrop-filter:blur(8px);font-family:Georgia,serif;color:#e9dfcf;touch-action:pan-y}
    .hc-time-root[hidden]{display:none!important}
    .hc-time-panel{width:min(520px,100%);max-height:90dvh;overflow-y:auto;border:1px solid #6f8b8a;border-radius:14px;background:linear-gradient(145deg,#1d2029,#100d18);box-shadow:0 24px 90px #000;padding:22px}
    .hc-time-kicker{font:11px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#9cc9c6}.hc-time-head{display:flex;justify-content:space-between;gap:12px}.hc-time-head h2{font-size:30px;font-weight:normal;margin:5px 0}.hc-time-close{align-self:flex-start;width:38px;height:38px;border:1px solid #5b6262;border-radius:6px;background:#211b25;color:#eadfce;cursor:pointer}
    .hc-time-copy{color:#c4b8aa;font-size:14px;line-height:1.5;margin:10px 0}.hc-time-range{display:block;margin:20px 0 8px}.hc-time-range span{display:flex;justify-content:space-between;gap:10px;color:#e7d4b5;font-size:14px}.hc-time-range input{width:100%;margin:16px 0 8px;accent-color:#a6d1c8;cursor:pointer}.hc-time-ends{display:flex;justify-content:space-between;color:#978d87;font:11px system-ui,sans-serif}.hc-time-note{border-left:2px solid #7ea8a6;padding-left:10px;color:#a7aaa4;font-size:12px;line-height:1.45;margin:15px 0}.hc-time-actions{display:flex;gap:8px;margin-top:18px}.hc-time-actions button{flex:1;min-height:44px;border-radius:7px;border:1px solid #799b97;background:#355a59;color:#f0f2df;font:inherit;cursor:pointer}.hc-time-actions button:disabled{opacity:.4;cursor:not-allowed}.hc-time-actions .cancel{background:#211b25;border-color:#5b5155;color:#c8b8a7}.hc-time-actions button:focus-visible,.hc-time-close:focus-visible,.hc-time-range input:focus-visible{outline:2px solid #d9c28d;outline-offset:3px}
  `;
  document.head.appendChild(style);
}
function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export class TimePanel {
  private root: HTMLDivElement;
  private range: TimeView | null = null;
  private onKey = (event: KeyboardEvent) => {
    if (!this.isOpen) return;
    trapTab(this.root, event);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); }
  };
  constructor(parent: HTMLElement, private callbacks: { travel: (targetAt: number) => void; opened: () => void; practice?: boolean }) {
    styles();
    this.root = document.createElement("div");
    this.root.className = "hc-time-root"; this.root.hidden = true;
    this.root.setAttribute("role", "dialog"); this.root.setAttribute("aria-modal", "true"); this.root.setAttribute("aria-label", "Choose a moment in the past");
    const copy = callbacks.practice ? "Solo practice shows your recorded movement and carries your changes back. Multiplayer replays real player commands." : "Walk through a recorded moment of this night. Other figures repeat their recorded commands in the world you change.";
    const note = callbacks.practice ? "The practice timepiece is consumed. You have up to one minute and can return early. This school is a simplified solo demonstration; the multiplayer town uses authoritative command replay." : "This timepiece is consumed. You have up to one minute; a meeting or the end of the night brings you back early. Items you already carry stay in the present. Keys and kits taken in the past can return with you. Later commands are replayed against your changes, including earlier travelers. If the night continues, a second timepiece appears after the first visit; only one visit is active at once.";
    this.root.innerHTML = `<div class="hc-time-panel"><div class="hc-time-head"><div><div class="hc-time-kicker">The timepiece</div><h2>Choose a moment</h2></div><button class="hc-time-close" type="button" aria-label="Close timepiece">×</button></div>
      <p class="hc-time-copy">${copy}</p>
      <label class="hc-time-range"><span><b>Travel back to</b><output data-time-label></output></span><input type="range" data-time-slider aria-label="Moment in the past" /></label><div class="hc-time-ends"><span>Night begins</span><span>Most recent recording</span></div>
      <p class="hc-time-note">${note}</p>
      <div class="hc-time-actions"><button type="button" class="cancel" data-time-cancel>Keep the timepiece</button><button type="button" data-time-go>Enter the past</button></div></div>`;
    parent.appendChild(this.root);
    this.root.addEventListener("click", this.click);
    this.root.addEventListener("input", this.input);
    window.addEventListener("keydown", this.onKey, true);
  }
  get isOpen() { return !this.root.hidden; }
  private previouslyFocused: HTMLElement | null = null;

  open(range: TimeView) {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    if (range.mode !== "present" || !Number.isFinite(range.earliest) || !Number.isFinite(range.latest) || range.latest < range.earliest) return;
    this.range = range; this.root.hidden = false; this.callbacks.opened();
    const slider = this.root.querySelector<HTMLInputElement>("[data-time-slider]")!;
    const span = Math.max(0, range.latest - range.earliest);
    slider.min = "0"; slider.max = String(span);
    slider.step = String(Math.max(500, Math.ceil(span / 300 / 500) * 500));
    slider.value = "0";
    this.updateLabel(); slider.focus();
  }
  close() {
    this.root.hidden = true; this.range = null;
    if (this.previouslyFocused?.isConnected) this.previouslyFocused.focus({ preventScroll: true });
    this.previouslyFocused = null;
  }
  destroy() { window.removeEventListener("keydown", this.onKey, true); this.root.removeEventListener("click", this.click); this.root.removeEventListener("input", this.input); this.root.remove(); }
  private updateLabel() {
    if (!this.range) return;
    const slider = this.root.querySelector<HTMLInputElement>("[data-time-slider]")!;
    const chosen = Math.min(this.range.latest, this.range.earliest + Number(slider.value));
    this.root.querySelector<HTMLOutputElement>("[data-time-label]")!.textContent = `${duration(chosen - this.range.earliest)} after dusk · ${duration(this.range.latest - chosen)} ago`;
  }
  private input = () => this.updateLabel();
  private click = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target === this.root || target.closest(".hc-time-close") || target.closest("[data-time-cancel]")) { this.close(); return; }
    if (target.closest("[data-time-go]") && this.range) {
      const offset = Number(this.root.querySelector<HTMLInputElement>("[data-time-slider]")!.value);
      const target = Math.min(this.range.latest, this.range.earliest + offset);
      this.close(); this.callbacks.travel(target);
    }
  };
}
