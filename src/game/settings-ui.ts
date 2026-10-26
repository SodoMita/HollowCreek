// Dependency-free settings dialog shared by the React and standalone clients.
import {
  applyDocumentPreferences,
  keyLabel,
  type BindableAction,
  type GameSettings,
  type SettingsStore,
} from "./settings";

const STYLE_ID = "hc-settings-dialog-style";
const ACTIONS: { id: BindableAction; label: string }[] = [
  { id: "left", label: "Walk left" },
  { id: "right", label: "Walk right" },
  { id: "interact", label: "Interact / work" },
  { id: "ability", label: "Role ability" },
  { id: "blackout", label: "Snuff lights" },
  { id: "push", label: "Push cart (hold + walk)" },
  { id: "drop", label: "Drop carried kit" },
  { id: "ruin", label: "Hollow: ruin a ward" },
  { id: "lock", label: "Lock / unlock a door" },
  { id: "chat", label: "Speak" },
  { id: "talk", label: "Voice chat on/off" },
];

const slider = (path: string, label: string, min: number, max: number, step = 1) => `
  <label class="hc-setting hc-slider">
    <span>${label}<output></output></span>
    <input type="range" min="${min}" max="${max}" step="${step}" data-setting="${path}" data-factor="100" />
  </label>`;
const toggle = (path: string, label: string, note = "") => `
  <label class="hc-setting hc-toggle">
    <span><b>${label}</b>${note ? `<small>${note}</small>` : ""}</span>
    <input type="checkbox" data-setting="${path}" /><i aria-hidden="true"></i>
  </label>`;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .hc-settings-root{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(5,3,8,.82);backdrop-filter:blur(8px);font-family:"Alegreya",Georgia,serif;color:#e9dfcf;user-select:none}
    .hc-settings-root[hidden]{display:none}
    .hc-settings-dialog{width:min(760px,96vw);max-height:min(820px,92dvh);display:flex;flex-direction:column;overflow:hidden;border:1px solid #513444;border-radius:14px;background:linear-gradient(145deg,rgba(28,18,31,.99),rgba(13,8,16,.99));box-shadow:0 28px 100px #000,0 0 50px rgba(201,118,47,.08)}
    .hc-settings-head{display:flex;align-items:center;gap:12px;padding:18px 20px 14px;border-bottom:1px solid #3a2733}
    .hc-settings-head h2{margin:0;font-family:"Pirata One",Georgia,serif;font-size:32px;font-weight:400;letter-spacing:.02em}
    .hc-settings-head p{margin:2px 0 0;color:#9c8b7a;font-size:12px;letter-spacing:0;text-transform:none}
    .hc-settings-head>div{flex:1}
    .hc-settings-close{width:38px;height:38px;border:1px solid #3a2733;border-radius:8px;color:#c9b8a4;font-size:22px;line-height:1}
    .hc-settings-close:hover{border-color:#c9762f;color:#ffd98a}
    .hc-settings-tabs{display:flex;gap:4px;padding:10px 14px 0;overflow-x:auto}
    .hc-settings-tabs button{flex:1;min-width:max-content;padding:9px 14px;border:1px solid transparent;border-radius:7px 7px 0 0;color:#9c8b7a;font-size:14px;letter-spacing:0;text-transform:none}
    .hc-settings-tabs button[aria-selected=true]{border-color:#3a2733;border-bottom-color:#140d18;background:#1d1420;color:#ffd98a}
    .hc-settings-body{overflow-y:auto;padding:16px 20px 22px;border-top:1px solid #3a2733}
    .hc-settings-panel{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}
    .hc-settings-panel[hidden]{display:none}
    .hc-settings-section{grid-column:1/-1;margin:8px 0 0;color:#c9762f;font-size:11px;letter-spacing:.18em;text-transform:uppercase}
    .hc-setting{margin:0;color:#e9dfcf;letter-spacing:0;text-transform:none}
    .hc-slider{display:block;padding:8px 0}
    .hc-slider>span{display:flex;justify-content:space-between;gap:12px;font-size:14px}
    .hc-slider output{color:#d99a3d;font-family:ui-monospace,monospace;font-size:12px}
    .hc-slider input{width:100%;height:5px;margin:12px 0 4px;padding:0;border:0;border-radius:99px;background:#3a2733;accent-color:#c9762f;cursor:pointer}
    .hc-toggle{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:9px 0;cursor:pointer}
    .hc-toggle>span{display:flex;flex-direction:column;gap:2px}
    .hc-toggle b{font-size:14px;font-weight:600}
    .hc-toggle small{color:#8f7d6b;font-size:11px;line-height:1.3}
    .hc-toggle input{position:absolute;right:0;width:42px;height:24px;opacity:0;cursor:pointer}
    .hc-toggle i{position:relative;flex:0 0 42px;width:42px;height:23px;border:1px solid #513444;border-radius:99px;background:#0d0810;transition:.15s}
    .hc-toggle i:after{content:"";position:absolute;left:3px;top:3px;width:15px;height:15px;border-radius:50%;background:#8f7d6b;transition:.15s}
    .hc-toggle input:checked+i{border-color:#a85d2c;background:#552717}
    .hc-toggle input:checked+i:after{left:22px;background:#ffd98a}
    .hc-toggle input:focus-visible+i,.hc-settings-dialog button:focus-visible,.hc-settings-dialog select:focus-visible{outline:2px solid #d99a3d;outline-offset:2px}
    .hc-select{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:52px;font-size:14px}
    .hc-select select{width:150px;padding:8px 10px;border:1px solid #3a2733;border-radius:6px;background:#0d0810;color:#e9dfcf;font:inherit}
    .hc-binding{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;font-size:14px}
    .hc-binding button{min-width:104px;padding:7px 10px;border:1px solid #3a2733;border-radius:6px;background:#0d0810;color:#ffd98a;font-family:ui-monospace,monospace;font-size:12px}
    .hc-binding button[data-waiting=true]{border-color:#d99a3d;color:#e9dfcf;animation:hc-settings-pulse 1s infinite}
    .hc-settings-note{grid-column:1/-1;margin:4px 0;color:#8f7d6b;font-size:12px;line-height:1.45}
    .hc-settings-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-top:1px solid #3a2733;background:rgba(0,0,0,.15)}
    .hc-settings-foot p{margin:0;color:#6f6058;font-size:11px;letter-spacing:0;text-transform:none}
    .hc-settings-reset{padding:7px 12px;border:1px solid #3a2733;border-radius:6px;color:#c9b8a4;font-size:12px}
    .hc-settings-reset:hover{border-color:#a84a26;color:#ffd98a}
    @keyframes hc-settings-pulse{50%{background:#3a2410}}
    @media(max-width:620px){.hc-settings-root{padding:8px}.hc-settings-dialog{max-height:96dvh}.hc-settings-panel{grid-template-columns:1fr}.hc-settings-section,.hc-settings-note{grid-column:1}.hc-settings-head{padding:14px 16px 10px}.hc-settings-head h2{font-size:28px}.hc-settings-body{padding:12px 16px}.hc-settings-foot{padding:10px 16px}.hc-settings-foot p{display:none}}
  `;
  document.head.appendChild(style);
}

function getPath(settings: GameSettings, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
    return undefined;
  }, settings);
}
function setPath(settings: GameSettings, path: string, value: unknown) {
  const parts = path.split(".");
  let target = settings as unknown as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
}
export class SettingsDialog {
  private root: HTMLDivElement;
  private waiting: BindableAction | null = null;
  private unsubscribe: () => void;
  private openState = false;
  private onOpen?: () => void;
  private onClose?: () => void;

  constructor(private store: SettingsStore, parent: HTMLElement = document.body, callbacks: { onOpen?: () => void; onClose?: () => void } = {}) {
    installStyles();
    this.onOpen = callbacks.onOpen;
    this.onClose = callbacks.onClose;
    this.root = document.createElement("div");
    this.root.className = "hc-settings-root";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "Hollow Creek settings");
    this.root.innerHTML = `
      <div class="hc-settings-dialog">
        <div class="hc-settings-head">
          <div><h2>Settings</h2><p>Saved in this browser. The town keeps moving while you adjust them.</p></div>
          <button class="hc-settings-close" aria-label="Close settings">×</button>
        </div>
        <div class="hc-settings-tabs" role="tablist">
          ${["audio", "graphics", "interface", "controls"].map((tab, i) => `<button role="tab" data-tab="${tab}" aria-selected="${i === 0}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}
        </div>
        <div class="hc-settings-body">
          <section class="hc-settings-panel" data-panel="audio">
            <div class="hc-settings-section">Mixer</div>
            ${slider("audio.master", "Master volume", 0, 100)}
            ${slider("audio.music", "Music", 0, 100)}
            ${slider("audio.ambience", "Wind & ambience", 0, 100)}
            ${slider("audio.effects", "Effects & footsteps", 0, 100)}
            ${slider("audio.voice", "Voice chat", 0, 100)}
            <div class="hc-settings-section">Behavior</div>
            ${toggle("audio.muted", "Mute all audio", "Also available from the speaker button in the HUD.")}
            ${toggle("audio.adaptiveMusic", "Adaptive score", "Harmony and pulse react to danger, meetings, and blackouts.")}
            ${toggle("audio.heartbeat", "Proximity heartbeat", "A warning when the Hollow is near. Disable it if you prefer no audio cue.")}
          </section>
          <section class="hc-settings-panel" data-panel="graphics" hidden>
            <div class="hc-settings-section">Performance</div>
            <label class="hc-setting hc-select"><span>Detail preset</span><select data-setting="graphics.quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            ${slider("graphics.resolution", "Render resolution", 50, 100, 5)}
            ${toggle("graphics.cameraSmoothing", "Smooth camera")}
            ${toggle("graphics.reducedMotion", "Reduced motion", "Freezes decorative animation and disables horror flashes.")}
            <div class="hc-settings-section">Atmosphere</div>
            ${toggle("graphics.particles", "Falling leaves")}
            ${toggle("graphics.fog", "Ground fog")}
            ${toggle("graphics.glow", "Lanterns & glow")}
            ${toggle("graphics.vignette", "Vignette")}
            ${toggle("graphics.flicker", "Horror flicker", "Brief flashes. Automatically off with reduced motion.")}
            <p class="hc-settings-note">The darkness mask is part of the game’s vision rules and is not changed by graphics settings.</p>
          </section>
          <section class="hc-settings-panel" data-panel="interface" hidden>
            <div class="hc-settings-section">HUD</div>
            ${slider("interface.scale", "Interface scale", 80, 130, 5)}
            ${slider("interface.hudOpacity", "HUD opacity", 35, 100, 5)}
            ${toggle("interface.touchControls", "On-screen controls")}
            ${toggle("interface.taskList", "Ward list")}
            ${toggle("interface.eventFeed", "Event feed")}
            ${toggle("interface.hints", "Interaction hints")}
            <div class="hc-settings-section">World labels</div>
            ${toggle("interface.playerNames", "Player names")}
            ${toggle("interface.speechBubbles", "Speech bubbles")}
          </section>
          <section class="hc-settings-panel" data-panel="controls" hidden>
            <div class="hc-settings-section">Keyboard</div>
            ${ACTIONS.map((a) => `<div class="hc-binding"><span>${a.label}</span><button data-bind="${a.id}"></button></div>`).join("")}
             <p class="hc-settings-note">Select a binding, then press a key. Hold Push while walking left or right beside the cart; another player can push alongside you. Arrow keys and Space remain fallback controls. Escape cancels rebinding or closes this panel.</p>
            <div class="hc-settings-section">Interaction</div>
<label class="hc-setting hc-select"><span>Interaction input</span><select data-setting="controls.interactMode"><option value="hold">Hold to interact</option><option value="toggle">Tap to toggle</option></select></label>
             <p class="hc-settings-note">Repairs always use the puzzle's buttons, regardless of this setting. Tap a ward with supplies to open its board; opening chat, settings or leaving releases held input.</p>
          </section>
        </div>
        <div class="hc-settings-foot"><p>No account. No network sync. Gameplay rules stay server-authoritative.</p><button class="hc-settings-reset">Restore defaults</button></div>
      </div>`;
    parent.appendChild(this.root);

    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("input", this.handleInput);
    this.root.addEventListener("change", this.handleInput);
    window.addEventListener("keydown", this.handleKey, true);
    this.unsubscribe = this.store.subscribe(() => this.sync());
    this.sync();
    this.selectTab("audio");
  }

  get isOpen() { return this.openState; }

  open() {
    if (this.openState) return;
    this.openState = true;
    this.root.hidden = false;
    this.sync();
    this.onOpen?.();
    (this.root.querySelector(".hc-settings-close") as HTMLButtonElement).focus();
  }

  close() {
    if (!this.openState) return;
    this.openState = false;
    this.waiting = null;
    this.root.hidden = true;
    this.onClose?.();
  }

  toggle() { if (this.openState) this.close(); else this.open(); }

  destroy() {
    this.close();
    this.unsubscribe();
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("input", this.handleInput);
    this.root.removeEventListener("change", this.handleInput);
    window.removeEventListener("keydown", this.handleKey, true);
    this.root.remove();
  }

  private selectTab(name: string) {
    this.root.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    this.root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  }

  private handleClick = (event: Event) => {
    const target = event.target as HTMLElement;
    if (target === this.root || target.closest(".hc-settings-close")) { this.close(); return; }
    const tab = target.closest<HTMLButtonElement>("[data-tab]");
    if (tab) { this.selectTab(tab.dataset.tab!); return; }
    if (target.closest(".hc-settings-reset")) { this.store.reset(); this.sync(); return; }
    const binding = target.closest<HTMLButtonElement>("[data-bind]");
    if (binding) {
      this.waiting = binding.dataset.bind as BindableAction;
      this.syncBindings();
    }
  };

  private handleInput = (event: Event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const path = input.dataset.setting;
    if (!path) return;
    let value: unknown = input.value;
    if (input instanceof HTMLInputElement && input.type === "checkbox") value = input.checked;
    else if (input instanceof HTMLInputElement && input.type === "range") value = Number(input.value) / Number(input.dataset.factor ?? 100);
    this.store.update((draft) => setPath(draft, path, value));
    this.sync();
  };

  private handleKey = (event: KeyboardEvent) => {
    if (!this.openState) return;
    if (this.waiting) {
      event.preventDefault(); event.stopImmediatePropagation();
      const action = this.waiting;
      this.waiting = null;
      if (event.code !== "Escape") {
        this.store.update((draft) => {
          const previous = draft.controls[action];
          const conflict = ACTIONS.find((a) => a.id !== action && draft.controls[a.id] === event.code);
          draft.controls[action] = event.code;
          if (conflict) draft.controls[conflict.id] = previous;
        });
      }
      this.syncBindings();
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); this.close();
    }
    // The clients ignore gameplay shortcuts while this dialog is open. Do not
    // stop other keys here: sliders, selects, and Tab navigation need them.
  };

  private sync() {
    const settings = this.store.value;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach((input) => {
      const value = getPath(settings, input.dataset.setting!);
      if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = Boolean(value);
      else if (input instanceof HTMLInputElement && input.type === "range") input.value = String(Math.round(Number(value) * Number(input.dataset.factor ?? 100)));
      else input.value = String(value);
      if (input instanceof HTMLInputElement && input.type === "range") {
        const output = input.parentElement?.querySelector("output");
        if (output) output.textContent = `${input.value}%`;
      }
    });
    applyDocumentPreferences(settings);
    this.syncBindings();
  }

  private syncBindings() {
    this.root.querySelectorAll<HTMLButtonElement>("[data-bind]").forEach((button) => {
      const action = button.dataset.bind as BindableAction;
      button.dataset.waiting = String(this.waiting === action);
      button.textContent = this.waiting === action ? "Press a key…" : keyLabel(this.store.value.controls[action]);
    });
  }
}
