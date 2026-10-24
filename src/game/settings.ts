// Persistent, client-only preferences. These never change authoritative gameplay.
export type GraphicsQuality = "low" | "medium" | "high";
export type InteractMode = "hold" | "toggle";
export type BindableAction = "left" | "right" | "interact" | "ability" | "blackout" | "push" | "drop" | "ruin" | "chat" | "talk";

export interface GameSettings {
  audio: {
    master: number;
    music: number;
    ambience: number;
    effects: number;
    voice: number;
    muted: boolean;
    adaptiveMusic: boolean;
    heartbeat: boolean;
  };
  graphics: {
    quality: GraphicsQuality;
    resolution: number;
    particles: boolean;
    fog: boolean;
    glow: boolean;
    vignette: boolean;
    flicker: boolean;
    cameraSmoothing: boolean;
    reducedMotion: boolean;
  };
  interface: {
    scale: number;
    hudOpacity: number;
    playerNames: boolean;
    speechBubbles: boolean;
    eventFeed: boolean;
    taskList: boolean;
    hints: boolean;
    touchControls: boolean;
  };
  controls: Record<BindableAction, string> & {
    interactMode: InteractMode;
  };
}

const DEFAULTS: GameSettings = {
  audio: {
    master: 0.85,
    music: 0.7,
    ambience: 0.65,
    effects: 0.8,
    voice: 0.8,
    muted: false,
    adaptiveMusic: true,
    heartbeat: true,
  },
  graphics: {
    quality: "high",
    resolution: 1,
    particles: true,
    fog: true,
    glow: true,
    vignette: true,
    flicker: true,
    cameraSmoothing: true,
    reducedMotion: false,
  },
  interface: {
    scale: 1,
    hudOpacity: 0.92,
    playerNames: true,
    speechBubbles: true,
    eventFeed: true,
    taskList: true,
    hints: true,
    touchControls: true,
  },
  controls: {
    left: "KeyA",
    right: "KeyD",
    interact: "KeyE",
    ability: "KeyQ",
    blackout: "KeyF",
    push: "ShiftLeft",
    drop: "KeyG",
    ruin: "KeyR",
    chat: "Enter",
    talk: "KeyT",
    interactMode: "hold",
  },
};

const STORAGE_KEY = "hc_settings_v1";
const ACTIONS: BindableAction[] = ["left", "right", "interact", "ability", "blackout", "push", "drop", "ruin", "chat", "talk"];
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, fallback: number, lo = 0, hi = 1) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
const bool = (v: unknown, fallback: boolean) => typeof v === "boolean" ? v : fallback;

export function createDefaultSettings(): GameSettings {
  return JSON.parse(JSON.stringify(DEFAULTS)) as GameSettings;
}

export function normalizeSettings(input: unknown): GameSettings {
  const d = createDefaultSettings();
  if (!isRecord(input)) return d;
  const a = isRecord(input.audio) ? input.audio : {};
  const g = isRecord(input.graphics) ? input.graphics : {};
  const i = isRecord(input.interface) ? input.interface : {};
  const c = isRecord(input.controls) ? input.controls : {};
  d.audio = {
    master: num(a.master, d.audio.master),
    music: num(a.music, d.audio.music),
    ambience: num(a.ambience, d.audio.ambience),
    effects: num(a.effects, d.audio.effects),
    voice: num(a.voice, d.audio.voice),
    muted: bool(a.muted, d.audio.muted),
    adaptiveMusic: bool(a.adaptiveMusic, d.audio.adaptiveMusic),
    heartbeat: bool(a.heartbeat, d.audio.heartbeat),
  };
  d.graphics = {
    quality: g.quality === "low" || g.quality === "medium" || g.quality === "high" ? g.quality : d.graphics.quality,
    resolution: num(g.resolution, d.graphics.resolution, 0.5, 1),
    particles: bool(g.particles, d.graphics.particles),
    fog: bool(g.fog, d.graphics.fog),
    glow: bool(g.glow, d.graphics.glow),
    vignette: bool(g.vignette, d.graphics.vignette),
    flicker: bool(g.flicker, d.graphics.flicker),
    cameraSmoothing: bool(g.cameraSmoothing, d.graphics.cameraSmoothing),
    reducedMotion: bool(g.reducedMotion, d.graphics.reducedMotion),
  };
  d.interface = {
    scale: num(i.scale, d.interface.scale, 0.8, 1.3),
    hudOpacity: num(i.hudOpacity, d.interface.hudOpacity, 0.35, 1),
    playerNames: bool(i.playerNames, d.interface.playerNames),
    speechBubbles: bool(i.speechBubbles, d.interface.speechBubbles),
    eventFeed: bool(i.eventFeed, d.interface.eventFeed),
    taskList: bool(i.taskList, d.interface.taskList),
    hints: bool(i.hints, d.interface.hints),
    touchControls: bool(i.touchControls, d.interface.touchControls),
  };
  for (const action of ACTIONS) {
    const code = c[action];
    if (typeof code === "string" && /^[A-Za-z][A-Za-z0-9]{1,31}$/.test(code)) d.controls[action] = code;
  }
  d.controls.interactMode = c.interactMode === "toggle" ? "toggle" : "hold";
  return d;
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
    const settings = createDefaultSettings();
    // Migrate the original mute toggle rather than silently ignoring it.
    settings.audio.muted = localStorage.getItem("hc_muted") === "1";
    // Reduced motion starts OFF. A saved choice above still takes precedence.
    return settings;
  } catch {
    return createDefaultSettings();
  }
}

export class SettingsStore {
  private state: GameSettings;
  private listeners = new Set<(settings: GameSettings) => void>();

  constructor() {
    this.state = loadSettings();
  }

  get value(): GameSettings { return this.state; }

  set(next: unknown) {
    this.state = normalizeSettings(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* storage may be unavailable */ }
    for (const listener of this.listeners) listener(this.state);
  }

  update(recipe: (draft: GameSettings) => void) {
    const next = createDefaultSettings();
    Object.assign(next, JSON.parse(JSON.stringify(this.state)) as GameSettings);
    recipe(next);
    this.set(next);
  }

  reset() { this.set(createDefaultSettings()); }

  subscribe(listener: (settings: GameSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
    Enter: "Enter", Space: "Space", ShiftLeft: "L Shift", ShiftRight: "R Shift",
    ControlLeft: "L Ctrl", ControlRight: "R Ctrl", AltLeft: "L Alt", AltRight: "R Alt",
    Backquote: "`", Minus: "−", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
    Tab: "Tab", CapsLock: "Caps Lock",
  };
  if (names[code]) return names[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Matches a custom binding, with arrow/Space fallbacks that yield to explicit binds. */
export function matchesControl(controls: GameSettings["controls"], action: BindableAction, code: string): boolean {
  if (controls[action] === code) return true;
  const fallback = (action === "left" && code === "ArrowLeft") ||
    (action === "right" && code === "ArrowRight") ||
    (action === "ability" && code === "Space");
  if (!fallback) return false;
  return !ACTIONS.some((other) => other !== action && controls[other] === code);
}

/** Applies CSS preferences shared by the React and standalone clients. */
export function applyDocumentPreferences(settings: GameSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--hc-ui-scale", String(settings.interface.scale));
  root.style.setProperty("--hc-hud-opacity", String(settings.interface.hudOpacity));
  root.classList.toggle("hc-reduced-motion", settings.graphics.reducedMotion);
  root.classList.toggle("hc-hide-touch-controls", !settings.interface.touchControls);
  root.classList.toggle("hc-hide-feed", !settings.interface.eventFeed);
  root.classList.toggle("hc-hide-tasks", !settings.interface.taskList);
  root.classList.toggle("hc-hide-hints", !settings.interface.hints);
}
