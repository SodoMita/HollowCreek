// Generative WebAudio score for Hollow Creek — no downloaded audio assets.
// Independent music / ambience / effects buses feed a master compressor.
import type { Snapshot } from "./types";
import { SettingsStore } from "./settings";

const SCALE = [587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66]; // D minor pentatonic
const CHORDS = [
  [73.42, 110.0, 146.83, 174.61], // Dm
  [58.27, 87.31, 116.54, 146.83], // Bb
  [87.31, 130.81, 174.61, 220.0], // F
  [55.0, 82.41, 110.0, 130.81], // Am
];
// A repeatable sixteen-step identity with small deterministic gaps, rather
// than unrelated random notes every few seconds.
const THEME: (number | null)[] = [0, null, 2, 1, null, 3, 2, null, 0, null, 4, 3, 2, 1, null, null];
const ANSWER: (number | null)[] = [2, null, 3, 4, null, 3, 1, null, 0, 1, 2, null, 1, null, 0, null];
type Bus = "music" | "ambience" | "effects";

export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private nextNote = 0;
  private nextBeat = 0;
  private nextStep = 0;
  private nextChord = 0;
  private nextCreak = 0;
  private chordIdx = 0;
  private musicStep = 0;
  private droneOscs: OscillatorNode[] = [];
  private echoSend: DelayNode | null = null;
  private lastFlicker = 0;
  private lastBell = 0;
  private previousPhase: Snapshot["phase"] = "lobby";
  private blackoutActive = false;
  private unsubscribe: () => void;

  constructor(private store: SettingsStore = new SettingsStore()) {
    this.unsubscribe = this.store.subscribe(() => this.applyMix());
  }

  get muted() { return this.store.value.audio.muted; }

  /** Must be called from a user gesture at least once. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -15;
      compressor.knee.value = 16;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.008;
      compressor.release.value = 0.24;
      this.master.connect(compressor).connect(ctx.destination);
      for (const name of ["music", "ambience", "effects"] as Bus[]) {
        const gain = ctx.createGain();
        gain.connect(this.master);
        this.buses[name] = gain;
      }

      // Wind: a broad noise bed plus a slowly wandering resonant branch.
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + 0.018 * white) / 1.018;
        data[i] = Math.max(-1, Math.min(1, brown * 3.2 + white * 0.12));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 330; bp.Q.value = 0.55;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.085;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.065;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(bp.frequency); lfo.start();
      const breath = ctx.createOscillator(); breath.frequency.value = 0.105;
      const breathGain = ctx.createGain(); breathGain.gain.value = 0.025;
      breath.connect(breathGain).connect(this.windGain.gain); breath.start();
      noise.connect(bp).connect(this.windGain).connect(this.buses.ambience!);
      noise.start();

      // Bowed bass and inner voices, low-passed into a single coherent pad.
      this.droneGain = ctx.createGain();
      this.droneGain.gain.value = 0.055;
      this.droneFilter = ctx.createBiquadFilter();
      this.droneFilter.type = "lowpass";
      this.droneFilter.frequency.value = 720;
      this.droneFilter.Q.value = 0.7;
      this.droneGain.connect(this.droneFilter).connect(this.buses.music!);
      const gains = [0.46, 0.28, 0.19, 0.12];
      const detunes = [-3, 3, -5, 5];
      for (let i = 0; i < 4; i++) {
        const oscillator = ctx.createOscillator();
        oscillator.type = i === 0 ? "sawtooth" : "triangle";
        oscillator.frequency.value = CHORDS[0][i];
        oscillator.detune.value = detunes[i];
        const gain = ctx.createGain(); gain.gain.value = gains[i];
        const tremolo = ctx.createOscillator(); tremolo.frequency.value = 0.11 + i * 0.027;
        const tremoloGain = ctx.createGain(); tremoloGain.gain.value = gains[i] * 0.28;
        tremolo.connect(tremoloGain).connect(gain.gain); tremolo.start();
        oscillator.connect(gain).connect(this.droneGain);
        oscillator.start();
        this.droneOscs.push(oscillator);
      }

      // Dark feedback echo used only by the music bus.
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = 0.375;
      const feedback = ctx.createGain(); feedback.gain.value = 0.3;
      const lowpass = ctx.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.frequency.value = 1750;
      const wet = ctx.createGain(); wet.gain.value = 0.24;
      delay.connect(lowpass).connect(feedback).connect(delay);
      delay.connect(wet).connect(this.buses.music!);
      this.echoSend = delay;

      const t = ctx.currentTime;
      this.nextNote = t + 0.8;
      this.nextChord = t + 14;
      this.nextCreak = t + 9;
      this.applyMix(true);
    } catch {
      this.ctx = null;
      this.master = null;
      this.buses = {};
    }
  }

  setMuted(muted: boolean) {
    this.store.update((draft) => { draft.audio.muted = muted; });
    // Keep the old key in sync for older deployed clients.
    try { localStorage.setItem("hc_muted", muted ? "1" : "0"); } catch { /* storage unavailable */ }
  }

  destroy() {
    this.unsubscribe();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.buses = {};
    this.droneOscs = [];
  }

  private applyMix(immediate = false) {
    if (!this.ctx || !this.master) return;
    const a = this.store.value.audio;
    const t = this.ctx.currentTime;
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(t);
      if (immediate) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, 0.035);
    };
    set(this.master.gain, a.muted ? 0 : a.master * a.master);
    set(this.buses.music!.gain, a.music * a.music);
    set(this.buses.ambience!.gain, a.ambience * a.ambience);
    set(this.buses.effects!.gain, a.effects * a.effects);
  }

  private tone(
    frequency: number, start: number, duration: number, volume: number,
    type: OscillatorType = "sine", bus: Bus = "effects", echo = false,
  ) {
    if (!this.ctx || !this.buses[bus]) return;
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + Math.min(0.025, duration * 0.15));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.buses[bus]!);
    if (echo && this.echoSend && bus === "music") gain.connect(this.echoSend);
    oscillator.start(start); oscillator.stop(start + duration + 0.06);
  }

  private bell() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let strike = 0; strike < 3; strike++) {
      const start = t + strike * 0.86;
      // Slightly inharmonic partials make this a struck bell, not a clean chord.
      this.tone(392, start, 1.9, 0.19, "sine");
      this.tone(587.7, start, 1.45, 0.085, "sine");
      this.tone(789.4, start, 1.05, 0.045, "sine");
      this.tone(1179, start, 0.55, 0.018, "triangle");
    }
  }

  private caw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const start = t + i * 0.21;
      const oscillator = ctx.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(730 - i * 80, start);
      oscillator.frequency.exponentialRampToValueAtTime(390, start + 0.15);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.032, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
      const lowpass = ctx.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.frequency.value = 1550;
      oscillator.connect(lowpass).connect(gain).connect(this.buses.effects!);
      oscillator.start(start); oscillator.stop(start + 0.2);
    }
  }

  private creak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(105, t);
    oscillator.frequency.exponentialRampToValueAtTime(68, t + 1.1);
    const filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = 420; filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.014, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    oscillator.connect(filter).connect(gain).connect(this.buses.ambience!);
    oscillator.start(t); oscillator.stop(t + 1.2);
  }

  private whooshDown() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(310, t);
    oscillator.frequency.exponentialRampToValueAtTime(34, t + 1.35);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    oscillator.connect(gain).connect(this.buses.effects!);
    oscillator.start(t); oscillator.stop(t + 1.55);
  }

  private thump(strength: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(52, t, 0.17, 0.13 * strength, "sine");
    this.tone(47, t + 0.19, 0.14, 0.085 * strength, "sine");
  }

  private footstep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.075);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const lowpass = ctx.createBiquadFilter(); lowpass.type = "lowpass"; lowpass.frequency.value = 460 + Math.random() * 130;
    const gain = ctx.createGain(); gain.gain.value = 0.065;
    source.connect(lowpass).connect(gain).connect(this.buses.effects!);
    source.start(t);
  }

  private roleSting(hollow: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.04;
    const notes = hollow ? [146.83, 155.56, 220] : [293.66, 349.23, 440];
    notes.forEach((note, i) => this.tone(note, t + i * 0.18, 1.5, 0.065, "triangle", "music", true));
  }

  private endingSting(hollowWon: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.08;
    const notes = hollowWon ? [293.66, 311.13, 220, 146.83] : [293.66, 349.23, 440, 587.33];
    notes.forEach((note, i) => this.tone(note, t + i * 0.28, 2.1, 0.07, "sine", "music", true));
  }

  private scheduleMusic(snap: Snapshot, tension: number, meeting: boolean) {
    if (!this.ctx || this.store.value.audio.music <= 0 || snap.phase === "ended") return;
    const t = this.ctx.currentTime;
    if (this.nextNote < t - 1) this.nextNote = t + 0.05;
    const adaptive = this.store.value.audio.adaptiveMusic;
    const tempo = adaptive && meeting ? 108 : 74;
    const stepDuration = 60 / tempo / 2;
    let scheduled = 0;
    while (this.nextNote < t + 0.18 && scheduled++ < 4) {
      const start = Math.max(t + 0.01, this.nextNote);
      const step = this.musicStep % 16;
      const phrase = this.chordIdx % 2 === 0 ? THEME : ANSWER;
      const note = phrase[step];
      const calmEnough = !adaptive || (snap.danger < 0.68 && snap.phase !== "meeting");
      if (note !== null && calmEnough && (step % 2 === 0 || snap.phase === "lobby")) {
        const frequency = SCALE[Math.min(SCALE.length - 1, note + (this.chordIdx === 1 ? -1 : 0))] ?? SCALE[0];
        this.tone(frequency, start, 1.25, 0.042, "sine", "music", true);
        this.tone(frequency * 3.005, start, 0.42, 0.006, "sine", "music");
      }
      if (step % 8 === 0) {
        const root = CHORDS[this.chordIdx][0] * 2;
        this.tone(root, start, 1.7, meeting ? 0.055 : 0.035, "triangle", "music", true);
      }
      if (adaptive && meeting && step % 2 === 0) {
        this.tone(step % 4 === 0 ? 110 : 146.83, start, 0.16, 0.025, "triangle", "music");
      }
      if (adaptive && tension > 0.58 && step % 4 === 2) {
        this.tone(622.25, start, 0.65, 0.012 + tension * 0.014, "sawtooth", "music", true);
      }
      this.musicStep++;
      this.nextNote += stepDuration;
    }
  }

  /** Called at ~10Hz with each fresh snapshot. */
  update(snap: Snapshot) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const a = this.store.value.audio;
    const me = snap.players.find((p) => p.id === snap.self.id);
    const blackout = snap.now < snap.blackoutUntil;
    const meeting = snap.phase === "meeting";
    const tension = a.adaptiveMusic ? Math.max(snap.danger, meeting ? 0.34 : 0, blackout ? 0.48 : 0) : 0;

    // Event timestamps advance even while muted, preventing a burst of stale
    // sounds when the player unmutes later.
    if (snap.bellAt > this.lastBell) {
      if (!a.muted && (this.lastBell !== 0 || Date.now() - snap.bellAt < 4000)) this.bell();
      this.lastBell = snap.bellAt;
    }
    if (snap.flickerAt > this.lastFlicker) {
      if (!a.muted && this.lastFlicker !== 0) this.caw();
      this.lastFlicker = snap.flickerAt;
    }
    if (blackout && !this.blackoutActive && !a.muted) this.whooshDown();
    this.blackoutActive = blackout;
    if (this.previousPhase === "lobby" && snap.phase === "playing" && !a.muted) this.roleSting(snap.self.role === "hollow");
    if (this.previousPhase !== "ended" && snap.phase === "ended" && !a.muted) this.endingSting(snap.winner === "hollow");
    this.previousPhase = snap.phase;

    if (this.droneGain) this.droneGain.gain.setTargetAtTime(snap.phase === "ended" ? 0.025 : 0.05 + tension * 0.055, t, 0.2);
    if (this.droneFilter) this.droneFilter.frequency.setTargetAtTime(720 - tension * 390 + (blackout ? -120 : 0), t, 0.25);
    if (this.windGain) this.windGain.gain.setTargetAtTime(blackout ? 0.14 : 0.075 + tension * 0.025, t, 0.3);

    if (a.muted) {
      this.nextNote = t + 0.2;
      return;
    }

    if (a.heartbeat && snap.danger > 0.12 && snap.self.alive && t >= this.nextBeat) {
      this.thump(0.35 + snap.danger * 0.65);
      this.nextBeat = t + (1.5 - snap.danger * 1.0);
    }

    if (t >= this.nextChord) {
      this.chordIdx = (this.chordIdx + 1) % CHORDS.length;
      this.droneOscs.forEach((oscillator, i) => {
        oscillator.frequency.cancelScheduledValues(t);
        oscillator.frequency.setValueAtTime(oscillator.frequency.value, t);
        oscillator.frequency.linearRampToValueAtTime(CHORDS[this.chordIdx][i], t + 4.5);
      });
      this.nextChord = t + 14;
    }

    this.scheduleMusic(snap, tension, meeting);

    if (a.ambience > 0 && t >= this.nextCreak) {
      this.creak();
      this.nextCreak = t + 11 + Math.random() * 12;
    }
    if (a.effects > 0 && me?.moving && snap.self.alive && t >= this.nextStep) {
      this.footstep();
      this.nextStep = t + 0.31;
    }
  }
}
