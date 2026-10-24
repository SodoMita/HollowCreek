// Shared, accessible DOM board for both Hollow Creek clients. The browser never
// decides completion: it sends a tile index and re-renders from server state.
import type { WardGameView } from "./wards";

const STYLE_ID = "hc-ward-panel-style";
const RUNES = ["☼", "◆", "✦", "☾"] as const;
const RUNE_NAMES = ["Sun", "Stone", "Star", "Moon"] as const;
const ARROWS = ["↑", "→", "↓", "←"] as const;
const ARROW_NAMES = ["North", "East", "South", "West"] as const;

function styles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .hc-ward-root{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(7,4,11,.82);backdrop-filter:blur(7px);overflow-y:auto;touch-action:pan-y;color:#e9dfcf;font-family:Georgia,serif}
    .hc-ward-root[hidden]{display:none!important}
    .hc-ward-panel{width:min(520px,100%);max-height:92dvh;overflow-y:auto;padding:18px;border:1px solid #6a4d3a;border-radius:12px;background:#160f18;box-shadow:0 25px 80px #000}
    .hc-ward-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
    .hc-ward-top h2{margin:0;font-size:clamp(22px,5vw,32px);font-weight:normal;line-height:1.1}
    .hc-ward-close{flex-shrink:0;border:1px solid #6a4d3a;border-radius:6px;background:#271b21;color:#e9dfcf;padding:8px 12px;min-height:40px;cursor:pointer}
    .hc-ward-lead{margin:8px 0 14px;color:#bfae9f;font-size:14px;line-height:1.4}
    .hc-ward-progress{height:8px;border:1px solid #604433;border-radius:8px;background:#0e0a12;overflow:hidden}
    .hc-ward-progress>div{height:100%;background:#c8914f;transition:width .12s}
    .hc-ward-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:#a99380;font-size:12px}
    .hc-ward-grid{display:grid;gap:10px;margin:18px 0 10px}
    .hc-ward-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .hc-ward-grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}
    .hc-ward-grid.nine{grid-template-columns:repeat(3,minmax(0,1fr));max-width:330px;margin-left:auto;margin-right:auto}
    .hc-ward-grid button{min-height:68px;border:1px solid #6d554a;border-radius:8px;background:#261c24;color:#f1dfc5;font:inherit;cursor:pointer;touch-action:manipulation}
    .hc-ward-grid button:hover,.hc-ward-grid button:focus-visible{border-color:#e2a667;background:#392531;outline:2px solid #e2a667;outline-offset:2px}
    .hc-ward-grid button:disabled{opacity:.5;cursor:not-allowed}
    .hc-ward-dial{display:block;font-size:31px;line-height:1}
    .hc-ward-grid small{display:block;color:#c9ae93;font-size:11px;line-height:1.35}
    .hc-ward-targets{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;padding:12px;border:1px solid #49353a;border-radius:8px;background:#100b13}
    .hc-ward-targets span{width:38px;height:38px;display:grid;place-items:center;border:1px solid #5e4547;border-radius:6px;font-size:22px}
    .hc-ward-targets span.active{border-color:#e2a667;background:#493324}.hc-ward-targets span.done{color:#87b27b;border-color:#446649}
    .hc-ward-grid button.on{background:#80652d;border-color:#e0b568;color:#fff8d8}.hc-ward-grid button.off{background:#19131c;color:#8e808d}
    .hc-ward-note{margin-top:12px;color:#9b877d;font-size:12px;line-height:1.4}
    @media(max-height:470px){.hc-ward-root{align-items:flex-start}.hc-ward-panel{max-height:96dvh;padding:10px}.hc-ward-grid{margin:8px 0}.hc-ward-grid button{min-height:46px}.hc-ward-lead{margin:5px 0}}
  `;
  document.head.appendChild(style);
}

function escapeText(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export class WardPanel {
  private root: HTMLDivElement;
  private signature = "";
  private opening = false;
  private current: WardGameView | null = null;
  constructor(
    parent: HTMLElement,
    private callbacks: { move: (stationId: string, index: number) => void; close: () => void; opened: () => void },
  ) {
    styles();
    this.root = document.createElement("div");
    this.root.className = "hc-ward-root";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Repair ward minigame");
    this.root.hidden = true;
    this.root.addEventListener("click", this.onClick);
    parent.appendChild(this.root);
  }
  get isOpen() { return !this.root.hidden; }

  update(view: WardGameView | null, stamina: number, exhausted: boolean) {
    if (!view) {
      this.root.hidden = true;
      this.current = null;
      this.signature = "";
      this.opening = false;
      return;
    }
    const wasOpen = this.isOpen;
    this.current = view;
    this.root.hidden = false;
    const signature = JSON.stringify([view.stationId, view.kind, view.values, view.targets, view.step, view.mistakes, view.moves]);
    if (signature !== this.signature) {
      const focused = wasOpen ? (document.activeElement as HTMLElement | null)?.dataset.wardMove : undefined;
      this.signature = signature;
      this.render(view);
      if (!wasOpen) {
        this.opening = true;
        this.callbacks.opened();
        (this.root.querySelector("[data-ward-move]") as HTMLButtonElement | null)?.focus({ preventScroll: true });
        this.opening = false;
      } else if (focused) {
        (this.root.querySelector(`[data-ward-move="${focused}"]`) as HTMLButtonElement | null)?.focus({ preventScroll: true });
      }
    }
    const vigor = this.root.querySelector<HTMLElement>("[data-ward-vigor]");
    if (vigor) vigor.textContent = exhausted ? "Rest here; vigor returns while you stand still." : `Vigor ${Math.round(stamina * 100)}% · each move takes a little effort`;
  }

  destroy() {
    this.root.removeEventListener("click", this.onClick);
    this.root.remove();
  }

  private onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-ward-close]")) { this.callbacks.close(); return; }
    const button = target.closest<HTMLButtonElement>("[data-ward-move]");
    if (!button || !this.current || this.opening) return;
    this.callbacks.move(this.current.stationId, Number(button.dataset.wardMove));
  };

  private render(view: WardGameView) {
    const label = escapeText(view.name);
    const instruction = view.kind === "align"
      ? "Rotate each dial until its arrow matches the etched target below it."
      : view.kind === "sequence"
        ? "Read the rune order, then tap the four symbols in that order. A mistake restarts the order."
        : "Light every panel. Each tap flips its panel and the neighbours above, below and beside it.";
    const board = view.kind === "align"
      ? `<div class="hc-ward-grid three">${view.values.map((value, i) => `
          <button type="button" data-ward-move="${i}" aria-label="Rotate dial ${i + 1}: ${ARROW_NAMES[value]}, target ${ARROW_NAMES[view.targets[i]]}">
            <span class="hc-ward-dial">${ARROWS[value]}</span><small>target ${ARROWS[view.targets[i]]} · dial ${i + 1}</small>
          </button>`).join("")}</div>`
      : view.kind === "sequence"
        ? `<div class="hc-ward-targets" aria-label="Order to enter">${view.targets.map((r, i) => `<span class="${i < view.step ? "done" : i === view.step ? "active" : ""}" title="${RUNE_NAMES[r]}">${RUNES[r]}</span>`).join("")}</div>
          <div class="hc-ward-grid four">${RUNES.map((r, i) => `
            <button type="button" data-ward-move="${i}" aria-label="Choose ${RUNE_NAMES[i]} rune"><span class="hc-ward-dial">${r}</span><small>${RUNE_NAMES[i]}</small></button>`).join("")}</div>`
        : `<div class="hc-ward-grid nine">${view.values.map((value, i) => `
            <button type="button" data-ward-move="${i}" class="${value ? "on" : "off"}" aria-label="Row ${Math.floor(i / 3) + 1}, column ${i % 3 + 1}: ${value ? "lit" : "dark"}">
              <span class="hc-ward-dial">${value ? "✦" : "·"}</span>
            </button>`).join("")}</div>`;
    this.root.innerHTML = `<div class="hc-ward-panel">
      <div class="hc-ward-top"><div><small style="color:#d99a3d">REPAIR THE WARD</small><h2>${label}</h2></div>
        <button type="button" class="hc-ward-close" data-ward-close aria-label="Leave repair puzzle">Leave · Esc</button></div>
      <p class="hc-ward-lead">${instruction}</p>
      <div class="hc-ward-progress" role="progressbar" aria-label="Ward repair progress" aria-valuenow="${Math.round(view.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.round(view.progress * 100)}%"></div></div>
      <div class="hc-ward-meta"><span>${Math.round(view.progress * 100)}% repaired</span><span>${view.moves} moves${view.mistakes ? ` · ${view.mistakes} mistakes` : ""}</span></div>
      ${board}
      <p data-ward-vigor class="hc-ward-note"></p>
      <p class="hc-ward-note">No timer. Tap a tile, or use Tab then Enter / Space. Esc leaves the puzzle; progress remains for the town.</p>
    </div>`;
  }
}
