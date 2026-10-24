// Shared repair workbench used by React and the static client. Both render the
// exact authoritative board; the browser sends only a numbered physical action.
import { WARD_JOBS, type WardGameView } from "./wards";

const STYLE_ID = "hc-ward-panel-style";
const ARROWS = ["↑", "→", "↓", "←"] as const;
const LANTERN_SIGILS = ["✦", "☾", "◈", "✧", "◉", "❖", "☉", "⌁"] as const;
const CROW_GLYPHS = ["⌁", "✦", "☾", "◈"] as const;
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
    .hc-ward-grid.nine{grid-template-columns:repeat(3,minmax(0,1fr));max-width:330px;margin-left:auto;margin-right:auto}
    .hc-ward-track{position:relative;height:28px;margin:13px 0;background:#281e27;border:1px solid #655249;border-radius:8px}
    .hc-ward-track .band{position:absolute;top:1px;bottom:1px;background:#81652c;border:1px solid #dab86b;border-radius:4px}
    .hc-ward-track .bucket{position:absolute;top:-5px;width:11px;height:36px;background:#e9dfcf;border-radius:4px;box-shadow:0 0 8px #bd9959}
    .hc-ward-ring{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:7px 0;border-bottom:1px solid #453440}
    .hc-ward-ring strong{font-size:24px;color:#e9c588}
    .hc-ward-ring button{min-width:44px;min-height:44px;border:1px solid #6d554a;border-radius:6px;background:#31232d;color:#f1dfc5;font:inherit;cursor:pointer}
    .hc-ward-ring button:hover,.hc-ward-ring button:focus-visible{border-color:#e2a667;outline:2px solid #e2a667}
    .hc-ward-calls{display:flex;gap:7px;justify-content:center;margin:13px 0}
    .hc-ward-calls span{min-width:38px;min-height:38px;display:grid;place-items:center;border:1px solid #695046;border-radius:6px;font-size:23px}
    .hc-ward-calls span.sewn{color:#9fc08e;border-color:#57704f}
    .hc-ward-furrow{position:relative;max-width:320px;aspect-ratio:1;margin:12px auto}
    .hc-ward-furrow svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .hc-ward-furrow .hc-ward-grid{position:relative;z-index:1;aspect-ratio:1;margin:0}
    .hc-ward-furrow button{min-height:0!important}
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
      if (view.step === 0) {
        const selected = v.reduce((count, on) => count + on, 0);
        const span = v.reduce((n, on, i) => n + (on ? t[i] : 0), 0);
        return `<div class="hc-ward-console">Shed gap: <b>${t[6]} feet</b> · braced: <b>${span} feet</b> in ${selected}/3 beams. Splintered lumber will not bear the roof.</div>
          <div class="hc-ward-grid three">${v.map((on, i) => button(i, `${on ? "Remove" : "Select"} ${t[i]} foot ${i === t[7] ? "splintered" : "sound"} beam`,
            `<div class="hc-ward-beam" style="width:${35 + t[i] * 8}%"></div><small>${t[i]} ft${i === t[7] ? " · SPLINTERED" : " · sound"}</small>`, `${on ? "selected " : ""}${i === t[7] ? "hc-ward-splinter" : ""}`)).join("")}</div>
          ${button(6, "Fasten roof brace", "Fasten the three beams", "hc-ward-action")}`;
      }
      const path = t.slice(8), dug = new Set(path.slice(0, view.step - 1));
      const line = path.slice(1).map((cell, i) => {
        const before = path[i];
        return `<line x1="${50 + before % 3 * 100}" y1="${50 + Math.floor(before / 3) * 100}" x2="${50 + cell % 3 * 100}" y2="${50 + Math.floor(cell / 3) * 100}" stroke="${i < view.step - 1 ? "#c5a364" : "#695147"}" stroke-width="8" stroke-linecap="round"/>`;
      }).join("");
      return `<div class="hc-ward-console">The roof holds. Now cut <b>The Furrow</b>: drain rainwater away from the shed foundation by following the connected ditch from START to OUTLET. Wrong turns refill it.</div>
        <div class="hc-ward-furrow"><svg viewBox="0 0 300 300" aria-hidden="true">${line}</svg>
          <div class="hc-ward-grid nine">${Array.from({ length: 9 }, (_, i) => path.includes(i)
            ? button(7 + i, `Dig furrow at row ${Math.floor(i / 3) + 1} column ${i % 3 + 1}`,
              `<span class="hc-ward-glyph">${i === path[0] ? "◎" : i === path.at(-1) ? "◈" : dug.has(i) ? "●" : "○"}</span>`, dug.has(i) ? "done" : "")
            : `<button type="button" disabled aria-label="Dry ground">·</button>`).join("")}</div>
        </div>`;
    }
    case "well": {
      const band = t[view.step], position = v[0];
      const tension = ["slack", "safe", "safe", "taut", "slipping"][v[1]];
      return `<div class="hc-ward-console"><b>The Long Draw · catch ${view.step + 1}/3.</b> Wind the bucket into the pale catch zone, ease rope tension to 2 or less, then set the ratchet.
        <div class="hc-ward-track"><div class="band" style="left:${(band - 1) / 14 * 100}%;width:${2 / 14 * 100}%"></div><div class="bucket" style="left:${position / 14 * 100}%"></div></div>
        Bucket ${position}/14 · rope <b>${tension}</b> (${v[1]}/4) · slips ${v[2]}.</div>
        <div class="hc-ward-grid three">
          ${button(0, "Crank the bucket up one notch", '<span class="hc-ward-glyph">↻</span><small>Crank</small>')}
          ${button(1, "Ease the rope tension", '<span class="hc-ward-glyph">↙</span><small>Ease rope</small>')}
          ${button(2, "Catch bucket inside pale zone", '<span class="hc-ward-glyph">▣</span><small>Catch / lock</small>')}
        </div>`;
    }
    case "scarecrow": {
      const round = v[0], length = 3 + round;
      const showing = view.revealMs > 0;
      const call = t.slice(0, length);
      return `<div class="hc-ward-console"><b>Crow Call · round ${round + 1}/4.</b>
        ${showing ? "Watch the calls in the stitches. Wait for the crows to finish before repeating them." : "Now repeat their call from memory. A wrong rune repeats this round, not the whole ward."}</div>
        <div class="hc-ward-calls" aria-label="${showing ? "Crow pattern on show" : "Crow pattern hidden"}">${call.map((r, i) => `<span class="${i < view.step ? "sewn" : ""}">${showing ? CROW_GLYPHS[r] : i < view.step ? "✓" : "?"}</span>`).join("")}</div>
        <div class="hc-ward-grid four">${CROW_GLYPHS.map((r, i) => `<button type="button" data-ward-move="${i}" aria-label="Call rune ${i + 1}" ${showing ? "disabled" : ""}><span class="hc-ward-glyph">${r}</span><small>Call ${i + 1}</small></button>`).join("")}</div>
        ${button(4, "Replay the crow call at a vigor cost", "Replay the crow call", "hc-ward-action")}`;
    }
    case "lantern": {
      const names = ["Wick band", "Glass cage", "Copper cap"];
      return `<div class="hc-ward-console"><b>Lantern Rites.</b> Three eight-face bands mesh around the drowned wick. Bring the bright star ✦ beneath the wick on each band. Turning one counter-turns the next.</div>
        ${v.map((face, i) => `<div class="hc-ward-ring"><span>${names[i]}</span>
          <button type="button" data-ward-move="${i * 2}" aria-label="Turn ${names[i]} left">↶</button>
          <strong>${LANTERN_SIGILS[face]}</strong>
          <button type="button" data-ward-move="${i * 2 + 1}" aria-label="Turn ${names[i]} right">↷</button>
          <small>target ✦</small></div>`).join("")}`;
    }
    case "chapel": {
      const lit = v.filter(Boolean).length;
      return `<div class="hc-ward-console"><b>Nine Candles.</b> Test the repaired chapel fittings: the new glass draws a contrary draught. Each candle you touch changes itself and its cross-neighbours. Light all nine together. ${lit}/9 burning · shortest repair ${view.extra[0]} taps.</div>
        <div class="hc-ward-grid nine">${v.map((on, i) => button(i, `Chapel candle row ${Math.floor(i / 3) + 1} column ${i % 3 + 1}: ${on ? "lit" : "dark"}`,
          `<span class="hc-ward-glyph">${on ? "✦" : "·"}</span><small>${on ? "lit" : "dark"}</small>`, on ? "done" : "")).join("")}</div>`;
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
    const wasPreview = this.current?.kind === "scarecrow" && this.current.revealMs > 0;
    this.current = view;
    this.root.hidden = false;
    const signature = JSON.stringify([view.stationId, view.kind, view.values, view.targets, view.extra, view.step, view.mistakes, view.moves, view.revealMs > 0]);
    if (signature !== this.signature) {
      const focused = wasOpen ? (document.activeElement as HTMLElement | null)?.dataset.wardMove : undefined;
      this.signature = signature;
      this.render(view);
      if (!wasOpen) {
        this.opening = true;
        this.callbacks.opened();
        (this.root.querySelector(view.kind === "scarecrow" && view.revealMs > 0 ? "[data-ward-close]" : "[data-ward-move]") as HTMLButtonElement | null)?.focus({ preventScroll: true });
        this.opening = false;
      } else if (wasPreview && view.kind === "scarecrow" && view.revealMs === 0) {
        (this.root.querySelector("[data-ward-move]") as HTMLButtonElement | null)?.focus({ preventScroll: true });
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
      <p class="hc-ward-note">No deadline to finish. Tap a part, or use Tab then Enter / Space. Esc leaves; progress stays with this ward.</p>
    </div>`;
  }
}
