// Generative score for Hollow Creek. No audio files: everything is synthesised in
// the browser and follows the game state. Three buses (music / ambience / effects)
// feed one master, and every bus honours the volume, mute, adaptive-music and
// heartbeat settings from the settings store.
//
//   ambience  wind: brown noise through a moving bandpass · timber creaks
//   music     bowed drone on four roots (root + fifth) turning every 17s · a sparse
//             music-box motif through a feedback delay · a detuned choir that
//             swells with danger · a sting when the night begins
//   effects   chapel bell · low heartbeat that quickens with danger · blackout
//             whoosh · ward chime · fall thud · release tone · footsteps · crow caws
import type { Snapshot } from "./types";
import { SettingsStore, createDefaultSettings } from "./settings";

type Bus = "music" | "ambience" | "effects";
const BUSES: Bus[] = ["music", "ambience", "effects"];

const DEFAULTS = createDefaultSettings().audio;
/** Loudness the footsteps / caws / creaks / sting were originally written against. */
const LEGACY = {
  music: DEFAULTS.music ** 2,
  ambience: DEFAULTS.ambience ** 2,
  effects: DEFAULTS.effects ** 2,
};

const NOTE = (semis: number) => 55 * Math.pow(2, semis / 12); // A1 = 55 Hz
const ROOTS = [26, 22, 29, 21]; // semitones above A1: B3 · G3 · D4 · F#3
const DRONE_STACK = [0, 7, 12, 19];
const CHOIR_STACK = [0, 7, 12, 15];
const CHORD_SECONDS = 17;

export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private sends: Partial<Record<Bus, GainNode>> = {};
  private noiseBuf: AudioBuffer | null = null;
  private musicBox: GainNode | null = null; // music-box + echo input
  private fxIn: GainNode | null = null; // effects that want the room
  private droneFilter: BiquadFilterNode | null = null;
  private droneOsc: OscillatorNode[] = [];
  private choirGain: GainNode | null = null;
  private choirOsc: OscillatorNode[] = [];
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private heartGain: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;

  private chord = 0;
  private danger = 0;
  private nextMotif = 0;
  private nextBell = 0;
  private nextHeart = 0;
  private nextStep = 0;
  private nextCreak = 0;

  private lastBell = 0;
  private lastFlicker = 0;
  private blackoutActive = false;
  private prevPhase: Snapshot["phase"] = "lobby";
  private lastDone = -1;
  private lastAlive: boolean | null = null;
  private lastCaged: boolean | null = null;

  constructor(private store: SettingsStore = new SettingsStore()) {
    this.unsubscribe = this.store.subscribe(() => this.applyMix());
  }

  get muted() {
    return this.store.value.audio.muted;
  }

  /** Must be called from a user gesture at least once. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      this.master = master;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      master.connect(comp);
      comp.connect(ctx.destination);

      // hand-made plate reverb, shared by every bus
      const convolver = ctx.createConvolver();
      convolver.buffer = this.impulse(ctx, 2.6, 2.4);
      const wetReturn = ctx.createGain();
      wetReturn.gain.value = 0.34;
      convolver.connect(wetReturn);
      wetReturn.connect(master);

      for (const b of BUSES) {
        const bus = ctx.createGain();
        bus.connect(master);
        this.buses[b] = bus;
        const send = ctx.createGain();
        send.connect(convolver);
        this.sends[b] = send;
      }
      this.noiseBuf = this.noise(ctx, 4);

      // ---- wind ----
      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuf;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.7;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.16;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      this.out(windGain, "ambience", true);
      wind.start();
      this.windFilter = windFilter;
      this.windGain = windGain;

      // ---- drone: bowed strings, detuned ----
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 620;
      droneFilter.Q.value = 1.4;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.11;
      droneFilter.connect(droneGain);
      this.out(droneGain, "music", true);
      [0, 0.16, -0.19, 0.31].forEach((detune, i) => {
        const o = ctx.createOscillator();
        o.type = i % 2 ? "sawtooth" : "triangle";
        o.detune.value = detune * 100;
        o.frequency.value = NOTE(ROOTS[0] + DRONE_STACK[i]);
        o.connect(droneFilter);
        o.start();
        this.droneOsc.push(o);
      });
      this.droneFilter = droneFilter;

      // ---- choir (rises with danger) ----
      const choirFilter = ctx.createBiquadFilter();
      choirFilter.type = "bandpass";
      choirFilter.frequency.value = 780;
      choirFilter.Q.value = 2.6;
      const choirGain = ctx.createGain();
      choirGain.gain.value = 0;
      choirFilter.connect(choirGain);
      this.out(choirGain, "music", true);
      [-7, 0, 7, 12].forEach((det, i) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.detune.value = det;
        o.frequency.value = NOTE(ROOTS[0] + 12 + CHOIR_STACK[i]);
        o.connect(choirFilter);
        o.start();
        this.choirOsc.push(o);
      });
      this.choirGain = choirGain;

      // ---- music box with feedback delay ----
      const musicBox = ctx.createGain();
      musicBox.gain.value = 0.55;
      const delay = ctx.createDelay(1.2);
      delay.delayTime.value = 0.38;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2200;
      this.out(musicBox, "music", false);
      musicBox.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      this.out(delay, "music", true);
      this.musicBox = musicBox;

      // ---- heartbeat + room for one-shot effects ----
      const heartGain = ctx.createGain();
      heartGain.gain.value = 0;
      this.out(heartGain, "effects", false);
      this.heartGain = heartGain;
      const fxIn = ctx.createGain();
      this.out(fxIn, "effects", true);
      this.fxIn = fxIn;

      const t = ctx.currentTime;
      this.nextMotif = t + 2.5;
      this.nextBell = t + 12;
      this.nextCreak = t + 9;
      this.applyMix(true);
      void ctx.resume();
      this.timer = setTimeout(this.loop, 250);
    } catch {
      this.teardown();
    }
  }

  setMuted(muted: boolean) {
    this.store.update((draft) => { draft.audio.muted = muted; });
    // Keep the old key in sync for older deployed clients.
    try { localStorage.setItem("hc_muted", muted ? "1" : "0"); } catch { /* storage unavailable */ }
  }

  destroy() {
    this.unsubscribe();
    this.teardown();
  }

  private teardown() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      this.droneOsc.forEach((o) => o.stop());
      this.choirOsc.forEach((o) => o.stop());
      if (this.ctx) void this.ctx.close();
    } catch { /* already closed */ }
    this.ctx = null;
    this.master = null;
    this.buses = {};
    this.sends = {};
    this.droneOsc = [];
    this.choirOsc = [];
  }

  /** Master and each bus follow the player's mix. The curve is normalised so the
   *  default sliders sound exactly like the score was mixed. */
  private applyMix(immediate = false) {
    if (!this.ctx || !this.master) return;
    const a = this.store.value.audio;
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(t);
      if (immediate) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, 0.035);
    };
    set(this.master.gain, a.muted ? 0 : (a.master * a.master) / DEFAULTS.master);
    for (const b of BUSES) {
      const v = (a[b] * a[b]) / (DEFAULTS[b] * DEFAULTS[b]);
      set(this.buses[b]!.gain, v);
      set(this.sends[b]!.gain, v);
    }
  }

  /** Send a node to a bus, dry and (optionally) into the shared room. */
  private out(node: AudioNode, bus: Bus, reverb: boolean) {
    node.connect(this.buses[bus]!);
    if (reverb) node.connect(this.sends[bus]!);
  }

  // ------------------------------------------------------------- per-snapshot

  /** Called at ~10Hz with each fresh snapshot. */
  update(snap: Snapshot) {
    const ctx = this.ctx;
    if (!ctx) return;
    const a = this.store.value.audio;
    const t = ctx.currentTime;
    const quiet = a.muted;
    const me = snap.players.find((p) => p.id === snap.self.id);
    const blackout = snap.now < snap.blackoutUntil;
    this.danger = snap.danger ?? 0;
    const tension = a.adaptiveMusic ? this.danger : 0;

    // layers follow the night
    const idx = Math.floor(t / CHORD_SECONDS) % ROOTS.length;
    if (idx !== this.chord) {
      this.chord = idx;
      this.retune(t);
    }
    this.droneFilter?.frequency.setTargetAtTime(420 + 320 * (1 - tension), t, 1.2);
    this.choirGain?.gain.setTargetAtTime(0.035 * Math.pow(tension, 1.5), t, 0.9);
    this.heartGain?.gain.setTargetAtTime(a.heartbeat ? 0.32 * this.danger : 0, t, 0.4);
    this.windGain?.gain.setTargetAtTime(blackout ? 0.26 : 0.16, t, 0.8);
    this.windFilter?.frequency.setTargetAtTime(blackout ? 240 : 420 + 220 * tension, t, 1.1);

    // Event edges advance even while muted, so unmuting never replays stale sounds.
    if (snap.bellAt > this.lastBell) {
      if (!quiet && (this.lastBell !== 0 || Date.now() - snap.bellAt < 4000)) this.toll(1);
      this.lastBell = snap.bellAt;
    }
    if (snap.flickerAt > this.lastFlicker) {
      if (!quiet && this.lastFlicker !== 0) this.caw();
      this.lastFlicker = snap.flickerAt;
    }
    if (blackout && !this.blackoutActive && !quiet) this.whoosh();
    this.blackoutActive = blackout;
    if (this.prevPhase === "lobby" && snap.phase === "playing" && !quiet) this.roleSting(snap.self.role === "hollow");
    if (this.prevPhase !== "ended" && snap.phase === "ended" && !quiet) this.toll(3);
    this.prevPhase = snap.phase;

    const done = snap.taskBar.done;
    if (this.lastDone >= 0 && done > this.lastDone && !quiet) this.chime();
    this.lastDone = done;

    const alive = snap.self.alive;
    const caged = snap.self.caged;
    if (this.lastAlive === true && !alive && !quiet) this.thud();
    if (this.lastCaged === true && !caged && alive && !quiet) this.riseTone();
    this.lastAlive = alive;
    this.lastCaged = caged;

    if (a.effects > 0 && !quiet && me?.moving && alive && t >= this.nextStep) {
      this.footstep();
      this.nextStep = t + 0.31;
    }
  }

  private retune(t: number) {
    const root = ROOTS[this.chord];
    this.droneOsc.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(root + DRONE_STACK[i]), t, 1.6));
    this.choirOsc.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(root + 12 + CHOIR_STACK[i]), t, 2.2));
  }

  // ----------------------------------------------------------------- scheduler

  private loop = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    const a = this.store.value.audio;
    const t = ctx.currentTime;
    if (!a.muted) {
      if (t >= this.nextMotif) {
        this.pluckMotif();
        this.nextMotif = t + 7 + Math.random() * 9;
      }
      if (t >= this.nextBell) {
        this.toll(1);
        this.nextBell = t + 42 + Math.random() * 70;
      }
      if (t >= this.nextCreak && a.ambience > 0) {
        this.creak();
        this.nextCreak = t + 11 + Math.random() * 12;
      }
      // heartbeat: scheduled ahead on the audio clock so the pulse never jitters
      if (a.heartbeat && this.danger > 0.05) {
        if (this.nextHeart < t) this.nextHeart = t + 0.05;
        while (this.nextHeart < t + 0.35) {
          this.heart(this.nextHeart);
          this.nextHeart += 1.3 - 0.7 * this.danger;
        }
      }
    }
    this.timer = setTimeout(this.loop, 250);
  };

  // ----------------------------------------------------------------- synthesis

  private pluckMotif() {
    const ctx = this.ctx;
    if (!ctx || !this.musicBox) return;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const semis = scale[Math.floor(Math.random() * scale.length)] + 24;
      const when = ctx.currentTime + i * (0.32 + Math.random() * 0.22);
      this.pluck(when, NOTE(semis + 12), 0.16 * (1 - this.danger * 0.35), this.musicBox);
    }
  }

  private pluck(when: number, freq: number, gain: number, dest: AudioNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 2.002;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 2.4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5200, when);
    lp.frequency.exponentialRampToValueAtTime(900, when + 1.6);
    o.connect(g);
    o2.connect(g);
    g.connect(lp);
    lp.connect(dest);
    o.start(when);
    o2.start(when);
    o.stop(when + 2.6);
    o2.stop(when + 2.6);
  }

  private heart(at: number) {
    const ctx = this.ctx;
    if (!ctx || !this.heartGain) return;
    const beat = (when: number, amp: number) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      const g = ctx.createGain();
      o.frequency.setValueAtTime(72, when);
      o.frequency.exponentialRampToValueAtTime(38, when + 0.16);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
      o.connect(g);
      g.connect(this.heartGain!);
      o.start(when);
      o.stop(when + 0.3);
    };
    beat(at, 1);
    beat(at + 0.26, 0.62);
  }

  /** Chapel bell: a stack of inharmonic partials with a long decay. */
  private toll(times: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let k = 0; k < times; k++) {
      const when = ctx.currentTime + k * 1.9;
      const partials = [
        { f: NOTE(26), g: 0.5, d: 6.5 },
        { f: NOTE(26) * 2.02, g: 0.28, d: 4.2 },
        { f: NOTE(26) * 2.94, g: 0.18, d: 3.1 },
        { f: NOTE(26) * 4.16, g: 0.1, d: 2.2 },
      ];
      for (const p of partials) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = p.f * (1 + (Math.random() - 0.5) * 0.004);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(p.g * 0.42, when + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, when + p.d);
        o.connect(g);
        this.out(g, "effects", true);
        o.start(when);
        o.stop(when + p.d + 0.1);
      }
    }
  }

  private whoosh() {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const when = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(1200, when);
    f.frequency.exponentialRampToValueAtTime(120, when + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.7);
    src.connect(f);
    f.connect(g);
    this.out(g, "effects", true);
    src.start(when);
    src.stop(when + 1.8);
  }

  /** A ward finished: a small bright figure, like a music box catching the light. */
  private chime() {
    const ctx = this.ctx;
    if (!ctx || !this.fxIn) return;
    const base = ctx.currentTime;
    [0, 4, 7, 12].forEach((semis, i) => this.pluck(base + i * 0.11, NOTE(semis + 36), 0.13, this.fxIn!));
  }

  /** Someone is struck down. */
  private thud() {
    const ctx = this.ctx;
    if (!ctx) return;
    const when = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(32, when + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.55, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    o.connect(g);
    this.out(g, "effects", true);
    o.start(when);
    o.stop(when + 1);
    this.whoosh();
  }

  /** Someone is let out of the iron. */
  private riseTone() {
    const ctx = this.ctx;
    if (!ctx || !this.fxIn) return;
    const when = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(NOTE(24), when);
    o.frequency.exponentialRampToValueAtTime(NOTE(36), when + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.22, when + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
    o.connect(g);
    this.out(g, "effects", true);
    o.start(when);
    o.stop(when + 1.2);
    this.pluck(when + 0.18, NOTE(31), 0.14, this.fxIn);
  }

  // ---- sounds the game already had, kept at their original loudness ----

  private footstep() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.075);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 460 + Math.random() * 130;
    const gain = ctx.createGain();
    gain.gain.value = 0.065 * LEGACY.effects;
    source.connect(lowpass);
    lowpass.connect(gain);
    this.out(gain, "effects", false);
    source.start(t);
  }

  private caw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const start = t + i * 0.21;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(730 - i * 80, start);
      o.frequency.exponentialRampToValueAtTime(390, start + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.032 * LEGACY.effects, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 1550;
      o.connect(lowpass);
      lowpass.connect(g);
      this.out(g, "effects", false);
      o.start(start);
      o.stop(start + 0.2);
    }
  }

  private creak() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(68, t + 1.1);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.014 * LEGACY.ambience, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    o.connect(filter);
    filter.connect(g);
    this.out(g, "ambience", false);
    o.start(t);
    o.stop(t + 1.2);
  }

  /** Sounds as the night begins; lower and darker for the Hollow. */
  private roleSting(hollow: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.musicBox) return;
    const t = ctx.currentTime + 0.04;
    const notes = hollow ? [146.83, 155.56, 220] : [293.66, 349.23, 440];
    notes.forEach((freq, i) => {
      const start = t + i * 0.18;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(freq, start);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime((0.065 * LEGACY.music) / 0.55, start + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.5);
      o.connect(g);
      g.connect(this.musicBox!);
      o.start(start);
      o.stop(start + 1.56);
    });
  }

  // ------------------------------------------------------------------ buffers

  private noise(ctx: AudioContext, seconds: number) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buf;
  }

  private impulse(ctx: AudioContext, seconds: number, decay: number) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
}
