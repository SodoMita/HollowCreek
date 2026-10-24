// Shared repair workbench used by React and the static client. Both render the
// exact authoritative board; the browser sends only a numbered physical action.
import { WARD_JOBS, type WardGameView } from "./wards";

const STYLE_ID = "hc-ward-panel-style";
const ARROWS = ["↑", "→", "↓", "←"] as const;
const LEAD = ["╰", "╭", "╮", "╯"] as const;
const STONES = ["ALDER", "BELL", "CROW", "DOVE"] as const;
const BARS = ["UPPER", "LEFT", "LOWER", "RIGHT"] as const;

function styles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .hc-ward-root{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(7,4,11,.85);backdrop-filter:blur(7px);overflow-y:auto;touch-action:pan-y;color:#e9dfcf;font-family:Georgia,serif}
    .hc-ward-root[hidden]{display:none!important}
    .hc-ward-panel{width:min(560px,100%);max-height:94dvh;overflow-y:auto;padding:18px;border:1px solid #6a4d3a;border-radius:12px;background:#160f18;box-shadow:0 25px 80px #000}
    .hc-ward-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
    .hc-ward-top h2{margin:0;font-size:clamp(22px,5vw,32px);font-weight:normal;line-height:1.1}
    .hc-ward-close{flex-shrink:0;border:1px solid #6a4d3a;border-radius:6px;background:#271b21;color:#e9dfcf;padding:8px 12px;min-height:40px;cursor:pointer}
    .hc-ward-lead{margin:8px 0 14px;color:#bfae9f;font-size:14px;line-height:1.4}
    .hc-ward-progress{height:8px;border:1px solid #604433;border-radius:8px;background:#0e0a12;overflow:hidden}
    .hc-ward-progress>div{height:100%;background:#c8914f;transition:width .12s}
    .hc-ward-meta{display:flex;justify-content:space-between;gap:8px;margin-top:6px;color:#a99380;font-size:12px}
    .hc-ward-grid{display:grid;gap:8px;margin:16px 0 10px}
    .hc-ward-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .hc-ward-grid.four{grid-template-columns:repeat(4,minmax(0,1fr))}
    .hc-ward-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
    .hc-ward-grid button,.hc-ward-action,.hc-ward-plot button{min-height:54px;border:1px solid #6d554a;border-radius:8px;background:#261c24;color:#f1dfc5;font:inherit;cursor:pointer;touch-action:manipulation}
    .hc-ward-grid button:hover,.hc-ward-grid button:focus-visible,.hc-ward-action:hover,.hc-ward-action:focus-visible,.hc-ward-plot button:hover,.hc-ward-plot button:focus-visible{border-color:#e2a667;background:#392531;outline:2px solid #e2a667;outline-offset:2px}
    .hc-ward-grid button:disabled{opacity:.25;cursor:default;outline:none}
    .hc-ward-grid button.selected,.hc-ward-plot button.selected{border-color:#e2b96c;background:#574029}
    .hc-ward-grid button.done{border-color:#6e9d70;background:#263a2a}
    .hc-ward-glyph{display:block;font-size:28px;line-height:1.15}
    .hc-ward-grid small,.hc-ward-plot small{display:block;color:#c9ae93;font-size:11px;line-height:1.35}
    .hc-ward-console{margin:13px 0 5px;padding:12px;border:1px solid #49353a;border-radius:8px;background:#100b13;font-size:14px;line-height:1.5}
    .hc-ward-console b{color:#e4bb7c}
    .hc-ward-action{display:block;width:100%;margin:10px 0 0;min-height:44px;background:#513522;border-color:#b78651}
    .hc-ward-beam{height:9px;margin:10px auto 8px;border-radius:3px;background:linear-gradient(90deg,#85603a,#b38852,#5f4128)}
    .hc-ward-splinter .hc-ward-beam{background:#49302d;transform:rotate(-5deg)}
    .hc-ward-gauge{height:12px;margin:8px 0;border:1px solid #5b4436;border-radius:8px;background:#271b21;overflow:hidden}
    .hc-ward-gauge>div{height:100%;background:#c69c56}
    .hc-ward-seam{position:relative;max-width:350px;margin:14px auto;aspect-ratio:1}
    .hc-ward-seam svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .hc-ward-seam .hc-ward-grid{position:relative;z-index:1;aspect-ratio:1;margin:0}
    .hc-ward-seam .hc-ward-grid button{min-height:0}
    .hc-ward-plot{display:grid;grid-template-columns:82px repeat(4,minmax(0,1fr));gap:4px;align-items:center;margin:6px 0}
    .hc-ward-plot button{min-height:38px;padding:2px;font-size:10px}
    .hc-ward-plot span{font-size:11px;color:#c9ae93}
    .hc-ward-note{margin-top:12px;color:#9b877d;font-size:12px;line-height:1.4}
    @media(max-height:470px){.hc-ward-root{align-items:flex-start}.hc-ward-panel{max-height:96dvh;padding:10px}.hc-ward-grid{margin:8px 0}.hc-ward-grid button{min-height:42px}.hc-ward-lead{margin:5px 0}}
    @media(max-width:380px){.hc-ward-panel{padding:12px}.hc-ward-plot{grid-template-columns:48px repeat(4,minmax(0,1fr))}.hc-ward-plot button{font-size:9px}.hc-ward-grid small{font-size:10px}}
  `;
  document.head.appendChild(style);
}

const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const button = (index: number, label: string, inner: string, css = "") =>
  `<button type="button" data-ward-move="${index}" aria-label="${escapeText(label)}" class="${css}">${inner}</button>`;
const gauge = (value: number, max: number) => `<div class="hc-ward-gauge"><div style="width:${Math.round(value / max * 100)}%"></div></div>`;

function renderJob(view: WardGameView): string {
  const v = view.values, t = view.targets;
  switch (view.kind) {
    case "pumpkins": {
      const selected = v.reduce((count, on) => count + on, 0);
      const span = v.reduce((n, on, i) => n + (on ? t[i] : 0), 0);
      return `<div class="hc-ward-console">Shed gap: <b>${t[6]} feet</b> · braced: <b>${span} feet</b> in ${selected}/3 beams. Splintered lumber won't bear the roof.</div>
        <div class="hc-ward-grid three">${v.map((on, i) => button(i, `${on ? "Remove" : "Select"} ${t[i]} foot ${i === t[7] ? "splintered" : "sound"} beam`,
          `<div class="hc-ward-beam" style="width:${35 + t[i] * 8}%"></div><small>${t[i]} ft${i === t[7] ? " · SPLINTERED" : " · sound"}</small>`, `${on ? "selected " : ""}${i === t[7] ? "hc-ward-splinter" : ""}`)).join("")}</div>
        ${button(6, "Fasten the roof brace", "Fasten three beams across the gap", "hc-ward-action")}`;
    }
    case "well": {
      const tension = ["slack", "safe", "taut", "slipping"][v[1]];
      return `<div class="hc-ward-console">Bucket raised <b>${v[0]}/${t[0]} turns</b>${gauge(v[0], t[0])}
          Rope tension: <b>${tension}</b> (${v[1]}/3). Ease it before the next crank at 3. Slips: ${v[2]}.</div>
        <div class="hc-ward-grid three">
          ${button(0, "Crank winch to raise bucket", '<span class="hc-ward-glyph">↻</span><small>Crank winch</small>')}
          ${button(1, "Ease rope tension", '<span class="hc-ward-glyph">↙</span><small>Ease rope</small>')}
          ${button(2, "Lock the ratchet with safe tension", '<span class="hc-ward-glyph">▣</span><small>Lock ratchet</small>')}
        </div>`;
    }
    case "scarecrow": {
      const path = new Set(t);
      const sewn = new Set(t.slice(0, view.step));
      const lines = t.slice(1).map((cell, i) => {
        const prev = t[i];
        return `<line x1="${50 + prev % 4 * 100}" y1="${50 + Math.floor(prev / 4) * 100}" x2="${50 + cell % 4 * 100}" y2="${50 + Math.floor(cell / 4) * 100}" stroke="${i < view.step ? "#bfa675" : "#685344"}" stroke-width="7" stroke-linecap="round"/>`;
      }).join("");
      return `<div class="hc-ward-console">Stitches: <b>${view.step}/${t.length}</b>. Start at START, follow the torn thread to END; only neighbouring holes share a seam.</div>
        <div class="hc-ward-seam"><svg viewBox="0 0 400 400" aria-hidden="true">${lines}</svg>
          <div class="hc-ward-grid four">${Array.from({ length: 16 }, (_, i) => path.has(i)
            ? button(i, `${i === t[0] ? "Start stitch" : i === t.at(-1) ? "End stitch" : "Stitch"} row ${Math.floor(i / 4) + 1} column ${i % 4 + 1}`,
              `<span class="hc-ward-glyph">${i === t[0] ? "◎" : i === t.at(-1) ? "◈" : sewn.has(i) ? "●" : "○"}</span>`, sewn.has(i) ? "done" : "")
            : `<button type="button" disabled aria-label="Intact cloth">·</button>`).join("")}</div>
        </div>`;
    }
    case "lantern": {
      const wick = v[0] < t[0] ? "wick too low — flame weak" : v[0] > t[0] ? "wick too high — glass sooting" : "wick height steady";
      const draft = v[1] < t[1] ? "vent too closed — smoke trapped" : v[1] > t[1] ? "vent too open — flame blown out" : "draft balanced";
      return `<div class="hc-ward-console">Wick height <b>${v[0]}/6</b>: ${wick}.<br/>Vent opening <b>${v[1]}/6</b>: ${draft}.</div>
        <div class="hc-ward-grid two">
          ${button(0, "Lower wick", '− Wick')} ${button(1, "Raise wick", '+ Wick')}
          ${button(2, "Close vent", '− Vent')} ${button(3, "Open vent", '+ Vent')}
        </div>${button(4, "Strike match and test flame", "Strike a match to test the flame", "hc-ward-action")}`;
    }
    case "chapel": {
      const glyphs = LEAD;
      return `<div class="hc-ward-console">Set the four panes so their lead strips meet in a rose at the centre. Turning one pane pulls the panes beside and below it.</div>
        <div class="hc-ward-grid two">${v.map((angle, i) => button(i, `Rotate stained-glass pane ${i + 1}, current ${glyphs[angle]}, target ${glyphs[t[i]]}`,
          `<span class="hc-ward-glyph">${glyphs[angle]}</span><small>pane ${i + 1} · lead ${glyphs[t[i]]}</small>`, angle === t[i] ? "done" : "")).join("")}</div>`;
    }
    case "mill": {
      const names = ["Driver", "Transfer", "Flywheel", "Blade"];
      return `<div class="hc-ward-console">The shaft is locked. Turn the four replacement gears until every stamped tooth meets its notch. Neighbouring cogs turn against your hand.</div>
        <div class="hc-ward-grid four">${v.map((angle, i) => button(i, `Turn ${names[i]} gear, current ${ARROWS[angle]}, notch ${ARROWS[t[i]]}`,
          `<span class="hc-ward-glyph">⚙ ${ARROWS[angle]}</span><small>${names[i]}<br/>notch ${ARROWS[t[i]]}</small>`, angle === t[i] ? "done" : "")).join("")}</div>`;
    }
    case "graves": {
      return `<div class="hc-ward-console">The ledger survives: Plot I bears <b>${STONES[t[0]]}</b>.
        <b>${STONES[t[1]]}</b> lies directly west of <b>${STONES[t[2]]}</b>; <b>${STONES[t[2]]}</b> lies directly west of <b>${STONES[t[3]]}</b>.
        Restore each marker to one plot.</div>
        ${v.map((chosen, plot) => `<div class="hc-ward-plot"><span>Plot ${["I","II","III","IV"][plot]}</span>
          ${STONES.map((stone, idx) => button(plot * 4 + idx, `Put ${stone} marker in plot ${plot + 1}`, stone, chosen === idx ? "selected" : "")).join("")}</div>`).join("")}`;
    }
    case "radio": {
      const quality = Math.max(0, Math.min(100, 100 - Math.abs(v[0] - t[0]) * 16 - Math.abs(v[1] - t[1]) * 18));
      const signal = quality < 40 ? "Only static" : quality < 75 ? "A carrier under the hiss" : quality < 100 ? "Broken words — almost clear" : "A clear voice: lock it";
      return `<div class="hc-ward-console">Frequency <b>${v[0]}/9</b> · Antenna <b>${v[1]}/4</b><br/>
        Signal strength <b>${quality}%</b>${gauge(quality, 100)}${signal}.</div>
        <div class="hc-ward-grid two">
          ${button(0, "Tune frequency lower", '− Frequency')} ${button(1, "Tune frequency higher", '+ Frequency')}
          ${button(2, "Shorten antenna", '− Antenna')} ${button(3, "Extend antenna", '+ Antenna')}
        </div>${button(4, "Lock radio signal", "Lock the receiver on the voice", "hc-ward-action")}`;
    }
    case "silo": {
      return `<div class="hc-ward-console">The four bars bear each other's weight. The keeper left three chalk rules:
        <b>${BARS[t[1]]}</b> must be seated before <b>${BARS[t[2]]}</b>;
        <b>${BARS[t[2]]}</b> carries <b>${BARS[t[3]]}</b>;
        <b>${BARS[t[0]]}</b> must go in before <b>${BARS[t[1]]}</b>.
        Work out the load order, then throw the main bolt.</div>
        <div class="hc-ward-grid four">${BARS.map((bar, i) => button(i, `Seat ${bar.toLowerCase()} door bar`,
          `<span class="hc-ward-glyph">${v[i] ? "▣" : "□"}</span><small>${bar}</small>`, v[i] ? "done" : "")).join("")}</div>
        ${button(4, "Throw the main silo bolt", "Throw the main bolt", "hc-ward-action")}`;
    }
  }
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
    const signature = JSON.stringify([view.stationId, view.kind, view.values, view.targets, view.extra, view.step, view.mistakes, view.moves]);
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

  destroy() { this.root.removeEventListener("click", this.onClick); this.root.remove(); }
  private onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-ward-close]")) { this.callbacks.close(); return; }
    const control = target.closest<HTMLButtonElement>("[data-ward-move]");
    if (!control || !this.current || this.opening) return;
    this.callbacks.move(this.current.stationId, Number(control.dataset.wardMove));
  };
  private render(view: WardGameView) {
    const job = WARD_JOBS[view.kind];
    this.root.innerHTML = `<div class="hc-ward-panel">
      <div class="hc-ward-top"><div><small style="color:#d99a3d">${escapeText(view.name).toUpperCase()}</small><h2>${job.title}</h2></div>
        <button type="button" class="hc-ward-close" data-ward-close aria-label="Leave repair puzzle">Leave · Esc</button></div>
      <p class="hc-ward-lead">${job.instruction}</p>
      <div class="hc-ward-progress" role="progressbar" aria-label="Ward repair progress" aria-valuenow="${Math.round(view.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.round(view.progress * 100)}%"></div></div>
      <div class="hc-ward-meta"><span>${Math.round(view.progress * 100)}% repaired</span><span>${view.moves} moves${view.mistakes ? ` · ${view.mistakes} slips` : ""}</span></div>
      ${renderJob(view)}
      <p data-ward-vigor class="hc-ward-note"></p>
      <p class="hc-ward-note">No timer. Tap a part, or use Tab then Enter / Space. Esc leaves; progress stays with this ward.</p>
    </div>`;
  }
}
