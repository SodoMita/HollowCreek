// Generative score for Hollow Creek — the "velvet dusk" rewrite.
// No audio files: everything is synthesised in the browser and follows the
// game state (snapshot.danger, phase, blackout, bell, work, deaths).
//
//   pad        soft triangle/sine voicings, crossfaded per chord (no glides)
//   music box  a composed 6/8 lullaby in D minor, three themes, humanised
//   bass       a plucked sub on each bar, root then fifth
//   valley     breathing wind, crickets, a distant owl, blackout rumble
//   dread      a tremolo minor-second cluster and a heartbeat keyed to danger
//   meeting    the melody stops; a slow clock ticks under an uneasy pad
//   ending     a picardy D major for the crew's dawn, a low cluster for the Hollow
//
// Timing uses a lookahead step scheduler (eighth notes at dotted-quarter = 48)
// so the score stays tight even when the tab stutters.
import type { Snapshot } from "./types";
import { SettingsStore } from "./settings";

const NOTE = (semis: number) => 55 * Math.pow(2, semis / 12); // semitones above A1
const STEP = 60 / 144; // one 6/8 eighth (~0.417 s)
const BAR = 6; // eighths per bar
const CHORD_STEPS = BAR * 2; // each chord lasts two bars (5 s)
const LOOKAHEAD = 0.45; // seconds scheduled ahead of the audio clock

interface Chord { pad: number[]; bass: number }
const CH = {
  Dm: { pad: [17, 20, 24, 29], bass: 5 },
  Bb: { pad: [13, 17, 20, 25], bass: 1 },
  F: { pad: [20, 24, 27, 32], bass: 8 },
  C: { pad: [15, 19, 22, 27], bass: 3 },
  Gm: { pad: [10, 13, 17, 22], bass: 10 },
  Am: { pad: [12, 15, 19, 24], bass: 0 },
  D: { pad: [17, 21, 24, 29], bass: 5 }, // picardy third — dawn
  Low: { pad: [5, 6, 12, 17], bass: 5 }, // D · Eb · A · D — the Hollow's night
} satisfies Record<string, Chord>;
const CALM: Chord[] = [CH.Dm, CH.Bb, CH.F, CH.C];
const UNEASY: Chord[] = [CH.Dm, CH.Gm, CH.Bb, CH.Am];
const MEETING: Chord[] = [CH.Dm, CH.Am, CH.Dm, CH.Gm];

// Music-box themes: 12 eighths per chord × 4 chords per pass; 0 = rest.
// All notes are diatonic to D minor, so every theme sits on every progression.
const R = 0;
const THEMES: number[][][] = [
  [ // A — the lullaby
    [41, R, R, 36, R, R, 32, R, R, 36, R, R],
    [37, R, R, 41, R, R, 32, R, R, R, R, R],
    [36, R, 39, R, 36, R, 32, R, R, R, R, R],
    [34, R, R, 31, R, R, 27, R, R, R, 29, R],
  ],
  [ // B — the answer
    [32, R, 34, R, 36, R, 41, R, R, R, 39, R],
    [37, R, R, 36, R, R, 32, R, R, R, R, R],
    [39, R, R, 36, R, 32, R, R, R, R, R, R],
    [31, R, R, 34, R, R, 39, R, R, R, R, R],
  ],
  [ // C — high and thin
    [44, R, R, 41, R, R, R, R, 36, R, R, R],
    [41, R, R, 37, R, R, R, R, R, R, R, R],
    [39, R, R, R, R, R, 36, R, 32, R, R, R],
    [34, R, R, R, R, R, 29, R, R, R, R, R],
  ],
];

interface CtxNodes {
  ctx: AudioContext;
  master: GainNode;
  musicBus: GainNode;
  ambienceBus: GainNode;
  effectsBus: GainNode;
  wet: GainNode;
  padFilter: BiquadFilterNode;
  padGain: GainNode;
  boxBus: GainNode;
  clusterGain: GainNode;
  clusterOsc: OscillatorNode[];
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  windLfo: OscillatorNode;
  cricketGain: GainNode;
  cricketOsc: OscillatorNode;
  cricketLfo: OscillatorNode;
  rumbleGain: GainNode;
  heartGain: GainNode;
  noiseBuf: AudioBuffer;
}

export class AudioDirector {
  private n: CtxNodes | null = null;
  private started = false;
  private mutedFlag = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;

  // --- score clock ---
  private step = 0;
  private nextStepTime = 0;
  private theme = 0;
  private playPass = true;
  private chord: Chord = CH.Dm;

  // --- state fed by snapshots ---
  private phase = "";
  private danger = 0;
  private heartDanger = 0;
  private blackout = false;
  private walking = false;
  private winner: string | null = null;

  // --- free-running event timers (ctx seconds) ---
  private nextHeart = 0;
  private nextBell = 0;
  private nextOwl = 0;
  private nextCricketShift = 0;
  private nextFoot = 0;
  private footSide = 0;

  // --- edge detectors for one-shots ---
  private lastBellAt = 0;
  private lastBlackoutAt = 0;
  private lastDone = -1;
  private lastAlive = true;
  private lastPhase = "";

  constructor(private store: SettingsStore = new SettingsStore()) {
    this.mutedFlag = !!store.value?.audio?.muted;
    this.unsubscribe = store.subscribe(() => this.applyMix());
  }

  get muted() {
    return this.mutedFlag;
  }

  start() {
    if (this.started) { if (this.n?.ctx.state === "suspended") void this.n.ctx.resume(); return; }
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.started = true;
      const master = ctx.createGain();
      master.gain.value = this.mutedFlag ? 0 : this.store.value.audio.master;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 2.5;
      comp.attack.value = 0.012;
      comp.release.value = 0.3;
      master.connect(comp);
      comp.connect(ctx.destination);

      // A dark, slow hall: stereo noise tail that loses its highs as it decays.
      const convolver = ctx.createConvolver();
      convolver.buffer = this.impulse(ctx, 3.4);
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      wet.connect(convolver);
      convolver.connect(master);

      // Post-fader reverb sends: silencing a bus also silences its wet path.
      const musicBus = ctx.createGain();
      const ambienceBus = ctx.createGain();
      const effectsBus = ctx.createGain();
      musicBus.gain.value = this.store.value.audio.music;
      ambienceBus.gain.value = this.store.value.audio.ambience;
      effectsBus.gain.value = this.store.value.audio.effects;
      for (const bus of [musicBus, ambienceBus, effectsBus]) { bus.connect(master); bus.connect(wet); }

      const noiseBuf = this.noise(ctx, 5);

      // ---- pad: one shared low-pass so danger/blackout can darken every voice ----
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = "lowpass";
      padFilter.frequency.value = 820;
      padFilter.Q.value = 0.6;
      const padGain = ctx.createGain();
      padGain.gain.value = 1;
      padFilter.connect(padGain);
      padGain.connect(musicBus);

      // ---- music box bus: dotted-eighth echo, damped so repeats sit behind ----
      const boxBus = ctx.createGain();
      boxBus.gain.value = 0.7;
      const delay = ctx.createDelay(2);
      delay.delayTime.value = STEP * 1.5;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 1800;
      const echoOut = ctx.createGain();
      echoOut.gain.value = 0.45;
      boxBus.connect(musicBus);
      boxBus.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(echoOut);
      echoOut.connect(musicBus);

      // ---- dread cluster: D5 · Eb5 · E5 under a 5.5 Hz tremolo ----
      const clusterFilter = ctx.createBiquadFilter();
      clusterFilter.type = "bandpass";
      clusterFilter.frequency.value = 640;
      clusterFilter.Q.value = 1.4;
      const tremolo = ctx.createGain();
      tremolo.gain.value = 0.5;
      const tremLfo = ctx.createOscillator();
      tremLfo.frequency.value = 5.5;
      const tremDepth = ctx.createGain();
      tremDepth.gain.value = 0.5;
      tremLfo.connect(tremDepth);
      tremDepth.connect(tremolo.gain);
      tremLfo.start();
      const clusterGain = ctx.createGain();
      clusterGain.gain.value = 0;
      clusterFilter.connect(tremolo);
      tremolo.connect(clusterGain);
      clusterGain.connect(musicBus);
      const clusterOsc: OscillatorNode[] = [tremLfo];
      [41, 42, 43].forEach((semis, i) => {
        const o = ctx.createOscillator();
        o.type = i === 1 ? "triangle" : "sine";
        o.frequency.value = NOTE(semis);
        o.detune.value = (i - 1) * 6;
        o.connect(clusterFilter);
        o.start();
        clusterOsc.push(o);
      });

      // ---- wind: brown noise through a slowly wandering band-pass ----
      const wind = ctx.createBufferSource();
      wind.buffer = noiseBuf;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 380;
      windFilter.Q.value = 0.8;
      const windLfo = ctx.createOscillator();
      windLfo.frequency.value = 0.07;
      const windLfoDepth = ctx.createGain();
      windLfoDepth.gain.value = 140;
      windLfo.connect(windLfoDepth);
      windLfoDepth.connect(windFilter.frequency);
      windLfo.start();
      const windGain = ctx.createGain();
      windGain.gain.value = 0.11;
      const windBreath = ctx.createOscillator();
      windBreath.frequency.value = 0.045;
      const windBreathDepth = ctx.createGain();
      windBreathDepth.gain.value = 0.035;
      windBreath.connect(windBreathDepth);
      windBreathDepth.connect(windGain.gain);
      windBreath.start();
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(ambienceBus);
      wind.start();
      clusterOsc.push(windBreath);

      // ---- crickets: a 4.3 kHz tine chopped at 17 Hz, fading in and out ----
      const cricketOsc = ctx.createOscillator();
      cricketOsc.type = "sine";
      cricketOsc.frequency.value = 4300;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const cricketLfo = ctx.createOscillator();
      cricketLfo.type = "square";
      cricketLfo.frequency.value = 17;
      const chopDepth = ctx.createGain();
      chopDepth.gain.value = 0.5;
      cricketLfo.connect(chopDepth);
      chopDepth.connect(chop.gain);
      const cricketGain = ctx.createGain();
      cricketGain.gain.value = 0;
      cricketOsc.connect(chop);
      chop.connect(cricketGain);
      cricketGain.connect(ambienceBus);
      cricketOsc.start();
      cricketLfo.start();

      // ---- blackout rumble: the same noise, only the floor of it ----
      const rumble = ctx.createBufferSource();
      rumble.buffer = noiseBuf;
      rumble.loop = true;
      rumble.playbackRate.value = 0.5;
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = "lowpass";
      rumbleFilter.frequency.value = 90;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0;
      rumble.connect(rumbleFilter);
      rumbleFilter.connect(rumbleGain);
      rumbleGain.connect(ambienceBus);
      rumble.start();

      // ---- heartbeat bus ----
      const heartGain = ctx.createGain();
      heartGain.gain.value = 0;
      heartGain.connect(effectsBus);

      this.n = {
        ctx, master, musicBus, ambienceBus, effectsBus, wet, padFilter, padGain, boxBus,
        clusterGain, clusterOsc, windGain, windFilter, windLfo, cricketGain, cricketOsc, cricketLfo,
        rumbleGain, heartGain, noiseBuf,
      };

      this.applyMix();
      const t = ctx.currentTime;
      this.nextStepTime = 0;
      this.nextBell = t + 25 + Math.random() * 30;
      this.nextOwl = t + 14 + Math.random() * 20;
      this.nextCricketShift = t + 2;
      this.tick();
      void ctx.resume();
    } catch {
      this.started = false;
    }
  }

  private applyMix() {
    const a = this.store.value.audio;
    this.mutedFlag = a.muted;
    if (!this.n) return;
    const t = this.n.ctx.currentTime;
    for (const [node, value] of [
      [this.n.master, a.muted ? 0 : a.master],
      [this.n.musicBus, a.music],
      [this.n.ambienceBus, a.ambience],
      [this.n.effectsBus, a.effects],
    ] as const) {
      node.gain.cancelScheduledValues(t);
      node.gain.setTargetAtTime(value, t, 0.08);
    }
  }

  setMuted(muted: boolean) {
    if (this.store.value.audio.muted !== muted) this.store.update((draft) => { draft.audio.muted = muted; });
    else this.applyMix();
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe();
    if (this.n) {
      try {
        this.n.clusterOsc.forEach((o) => o.stop());
        this.n.windLfo.stop();
        this.n.cricketOsc.stop();
        this.n.cricketLfo.stop();
        void this.n.ctx.close();
      } catch { /* already closed */ }
    }
    this.n = null;
    this.started = false;
  }

  /** Feed the score every snapshot. Continuous layers follow immediately; the
   *  metric layers (pad, melody) only read this state at chord boundaries. */
  update(snap: Snapshot) {
    if (!this.n) return;
    const n = this.n;
    const t = n.ctx.currentTime;
    const now = snap.now ?? Date.now();
    const actualDanger = Math.max(0, Math.min(1, snap.danger ?? 0));
    this.heartDanger = actualDanger;
    this.danger = this.store.value.audio.adaptiveMusic ? actualDanger : 0;
    this.blackout = (snap.blackoutUntil ?? 0) > now;
    this.phase = snap.phase;
    this.winner = snap.winner ?? null;
    const me = snap.players?.find((p) => p.id === snap.self?.id);
    this.walking = !!me?.moving && !!snap.self?.alive && snap.phase === "playing";

    // continuous dread + darkness
    const d = this.danger;
    const cutoff = (this.blackout ? 330 : 820 - 420 * d) * (snap.phase === "meeting" ? 0.8 : 1);
    n.padFilter.frequency.setTargetAtTime(cutoff, t, 1.2);
    n.clusterGain.gain.setTargetAtTime(0.03 * Math.pow(d, 1.6), t, 0.9);
    n.heartGain.gain.setTargetAtTime(this.store.value.audio.heartbeat ? 0.22 * actualDanger : 0, t, 0.4);
    n.windGain.gain.setTargetAtTime(this.blackout ? 0.26 : 0.11 + 0.05 * d, t, 0.8);
    n.windFilter.frequency.setTargetAtTime(this.blackout ? 220 : 380 + 160 * d, t, 1.1);
    n.rumbleGain.gain.setTargetAtTime(this.blackout ? 0.22 : 0, t, 0.5);

    // phase stings
    if (snap.phase !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = snap.phase;
      if (snap.phase === "meeting") this.toll(1);
      if (snap.phase === "ended" && prev) { this.toll(3); this.cadence(); }
      if (snap.phase === "playing" && prev === "lobby") this.pluckChord(CH.Dm, 0.1);
    }
    // one-shots driven by state edges: work finished, someone fell, someone rose
    const done = snap.taskBar?.done ?? 0;
    if (this.lastDone >= 0 && done > this.lastDone) this.chime();
    this.lastDone = done;
    const alive = !!snap.self?.alive;
    if (alive !== this.lastAlive) {
      if (!alive) this.thud();
      else if (snap.phase !== "ended") this.riseTone();
      this.lastAlive = alive;
    }
    if (snap.bellAt && snap.bellAt !== this.lastBellAt) {
      this.lastBellAt = snap.bellAt;
      this.toll(1);
    }
    if (snap.blackoutUntil && snap.blackoutUntil !== this.lastBlackoutAt) {
      this.lastBlackoutAt = snap.blackoutUntil;
      if (this.blackout) this.whoosh();
    }
  }

  // ------------------------------------------------------------- scheduler

  private tick() {
    const n = this.n;
    if (!n) return;
    const t = n.ctx.currentTime;
    if (this.nextStepTime === 0) this.nextStepTime = t + 0.15;
    // If the tab slept, jump the clock instead of flushing a burst of notes.
    if (this.nextStepTime < t - 1) {
      const missed = Math.ceil((t - this.nextStepTime) / STEP);
      this.step += missed;
      this.nextStepTime += missed * STEP;
    }
    while (this.nextStepTime < t + LOOKAHEAD) {
      this.onStep(this.step, this.nextStepTime);
      this.step++;
      this.nextStepTime += STEP;
    }

    if (t >= this.nextBell && this.phase !== "meeting") {
      this.toll(1, 0.55);
      this.nextBell = t + 70 + Math.random() * 90;
    }
    if (t >= this.nextOwl) {
      if (!this.blackout && this.danger < 0.5) this.owl(t);
      this.nextOwl = t + 28 + Math.random() * 50;
    }
    if (t >= this.nextCricketShift) {
      const level = this.blackout || this.danger > 0.6 ? 0 : (Math.random() < 0.7 ? 0.006 + Math.random() * 0.008 : 0);
      n.cricketGain.gain.setTargetAtTime(level, t, 1.5);
      n.cricketLfo.frequency.setTargetAtTime(15 + Math.random() * 5, t, 0.5);
      this.nextCricketShift = t + 5 + Math.random() * 8;
    }
    // One double beat per period; faster as danger grows, without stacking timers.
    if (this.store.value.audio.heartbeat && this.heartDanger > 0.05 && t >= this.nextHeart) {
      this.heart(t);
      this.nextHeart = t + 1.25 - 0.55 * this.heartDanger;
    }
    if (this.walking && t >= this.nextFoot) {
      this.footstep(t);
      this.nextFoot = t + 0.36;
    }
    this.timer = setTimeout(() => this.tick(), 100);
  }

  private progression(): Chord[] {
    if (this.phase === "meeting") return MEETING;
    if (this.phase === "ended") return this.winner === "crew" ? [CH.D, CH.Bb, CH.F, CH.D] : [CH.Low, CH.Gm, CH.Low, CH.Low];
    return this.danger > 0.45 ? UNEASY : CALM;
  }

  private onStep(step: number, when: number) {
    const inChord = step % CHORD_STEPS;
    const chordIdx = Math.floor(step / CHORD_STEPS) % 4;
    if (inChord === 0) {
      if (chordIdx === 0) {
        // A new pass: pick a theme and decide whether the box plays at all,
        // so the lullaby comes and goes instead of looping forever.
        this.theme = Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * (THEMES.length - 1));
        this.playPass = this.phase === "lobby" ? Math.random() < 0.8 : Math.random() < 0.65;
      }
      this.chord = this.progression()[chordIdx];
      this.pad(when, this.chord);
      this.bass(when, this.chord.bass, 0.13);
    }
    if (inChord === BAR) this.bass(when, this.chord.bass + 7, 0.08);

    const melodic = this.phase === "lobby" || this.phase === "playing";
    if (melodic && this.playPass && this.danger < 0.8) {
      const semis = THEMES[this.theme][chordIdx][inChord];
      if (semis) {
        const vel = 0.19 * (1 - 0.45 * this.danger) * (inChord % 3 === 0 ? 1 : 0.78);
        this.box(when + (Math.random() - 0.5) * 0.012, NOTE(semis), vel);
      }
    }
    if (this.phase === "meeting" && inChord % 3 === 0) this.clock(when, inChord === 0);
  }

  // ------------------------------------------------------------- instruments

  /** Four voices, two slightly detuned oscillators each, crossfaded per chord. */
  private pad(when: number, chord: Chord) {
    const n = this.n;
    if (!n) return;
    const dur = CHORD_STEPS * STEP;
    const attack = 1.4;
    const release = 1.8;
    const level = (this.phase === "ended" ? 0.04 : 0.03) * (this.blackout ? 0.6 : 1);
    chord.pad.forEach((semis, i) => {
      const g = n.ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(level * (i === 0 ? 1.1 : 0.9), when + attack);
      g.gain.setValueAtTime(level * (i === 0 ? 1.1 : 0.9), when + dur - 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur + release);
      g.connect(n.padFilter);
      const voices = [
        { type: "triangle" as OscillatorType, detune: 4 },
        { type: "sine" as OscillatorType, detune: -5 },
      ];
      voices.forEach(({ type, detune }, k) => {
        const o = n.ctx.createOscillator();
        o.type = type;
        o.frequency.value = NOTE(semis);
        o.detune.value = detune + (i % 2 ? 2 : -2);
        o.connect(g);
        o.start(when);
        o.stop(when + dur + release + 0.1);
        if (k === voices.length - 1) o.onended = () => { g.disconnect(); };
      });
    });
  }

  /** Plucked sub: a sine with a soft triangle edge, one note a bar. */
  private bass(when: number, semis: number, gain: number) {
    const n = this.n;
    if (!n) return;
    const o = n.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = NOTE(semis);
    const o2 = n.ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = NOTE(semis);
    const g2 = n.ctx.createGain();
    g2.gain.value = 0.25;
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.05);
    g.gain.exponentialRampToValueAtTime(gain * 0.5, when + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 2.6);
    const lp = n.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(lp);
    lp.connect(n.musicBus);
    o.start(when);
    o2.start(when);
    o.stop(when + 2.8);
    o2.stop(when + 2.8);
    o2.onended = () => { o.disconnect(); o2.disconnect(); g.disconnect(); g2.disconnect(); lp.disconnect(); };
  }

  /** Music box tine: fundamental + a bright partial that dies first + a tick. */
  private box(when: number, freq: number, gain: number) {
    const n = this.n;
    if (!n) return;
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, when + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.9);
    g.connect(n.boxBus);
    const o = n.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    o.connect(g);
    const o2 = n.ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 3.98;
    const g2 = n.ctx.createGain();
    g2.gain.setValueAtTime(0.28, when);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    o2.connect(g2);
    g2.connect(g);
    const o3 = n.ctx.createOscillator();
    o3.type = "triangle";
    o3.frequency.value = freq * 2;
    const g3 = n.ctx.createGain();
    g3.gain.value = 0.12;
    o3.connect(g3);
    g3.connect(g);
    for (const osc of [o, o2, o3]) { osc.start(when); osc.stop(when + 2); }
    o.onended = () => { o.disconnect(); o2.disconnect(); o3.disconnect(); g.disconnect(); g2.disconnect(); g3.disconnect(); };
  }

  /** The meeting clock: a dull woodblock tick, heavier on the downbeat. */
  private clock(when: number, down: boolean) {
    const n = this.n;
    if (!n) return;
    const o = n.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(down ? 920 : 1240, when);
    o.frequency.exponentialRampToValueAtTime(down ? 620 : 900, when + 0.05);
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(down ? 0.15 : 0.09, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    o.connect(g);
    g.connect(n.effectsBus);
    o.start(when);
    o.stop(when + 0.1);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  /** Soft footfalls on packed earth, alternating left/right colour. */
  private footstep(when: number) {
    const n = this.n;
    if (!n) return;
    this.footSide ^= 1;
    const src = n.ctx.createBufferSource();
    src.buffer = n.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = n.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = (this.footSide ? 520 : 680) + Math.random() * 60;
    f.Q.value = 1.3;
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.45, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    src.connect(f);
    f.connect(g);
    g.connect(n.effectsBus);
    src.start(when);
    src.stop(when + 0.1);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  }

  /** Two hoots from somewhere past the mill. */
  private owl(at: number) {
    const n = this.n;
    if (!n) return;
    const hoot = (when: number, len: number, amp: number) => {
      const o = n.ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(392, when);
      o.frequency.exponentialRampToValueAtTime(340, when + len);
      const g = n.ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.06);
      g.gain.setValueAtTime(amp, when + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      o.connect(g);
      g.connect(n.ambienceBus);
      o.start(when);
      o.stop(when + len + 0.05);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    };
    hoot(at, 0.32, 0.07);
    hoot(at + 0.42, 0.55, 0.06);
  }

  // ------------------------------------------------------------- one-shots

  /** A ward finished: a small bright figure, like a music box catching the light. */
  private chime() {
    const n = this.n;
    if (!n) return;
    const base = n.ctx.currentTime + 0.02;
    [29, 36, 41, 48].forEach((semis, i) => this.box(base + i * 0.1, NOTE(semis), 0.13));
  }

  /** The night begins: one soft strum of the home chord. */
  private pluckChord(chord: Chord, gain: number) {
    const n = this.n;
    if (!n) return;
    const base = n.ctx.currentTime + 0.02;
    chord.pad.forEach((semis, i) => this.box(base + i * 0.07, NOTE(semis + 12), gain));
  }

  /** Match end: the music box answers the bells with a final figure. */
  private cadence() {
    const n = this.n;
    if (!n) return;
    const base = n.ctx.currentTime + 0.9;
    const notes = this.winner === "crew" ? [36, 41, 45, 48, 53] : [29, 28, 24, 22, 17];
    notes.forEach((semis, i) => this.box(base + i * 0.22, NOTE(semis), 0.12));
  }

  /** The fog takes someone. */
  private thud() {
    const n = this.n;
    if (!n) return;
    const when = n.ctx.currentTime;
    const o = n.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, when);
    o.frequency.exponentialRampToValueAtTime(30, when + 0.7);
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.32, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    o.connect(g);
    g.connect(n.effectsBus);
    o.start(when);
    o.stop(when + 1);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    this.whoosh(0.5);
  }

  /** A friend is back on their feet. */
  private riseTone() {
    const n = this.n;
    if (!n) return;
    const base = n.ctx.currentTime + 0.02;
    [29, 32, 36].forEach((semis, i) => this.box(base + i * 0.12, NOTE(semis), 0.14));
  }

  private heart(at: number) {
    const n = this.n;
    if (!n) return;
    const beat = (when: number, amp: number) => {
      const o = n.ctx.createOscillator();
      o.type = "sine";
      const g = n.ctx.createGain();
      o.frequency.setValueAtTime(70, when);
      o.frequency.exponentialRampToValueAtTime(36, when + 0.16);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
      o.connect(g);
      g.connect(n.heartGain);
      o.start(when);
      o.stop(when + 0.3);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    };
    beat(at, 1);
    beat(at + 0.26, 0.6);
  }

  /** Chapel bell: a stack of inharmonic partials with a long decay. */
  toll(times: number, level = 1) {
    const n = this.n;
    if (!n) return;
    for (let k = 0; k < times; k++) {
      const when = n.ctx.currentTime + 0.02 + k * 1.9;
      const partials = [
        { f: NOTE(17), g: 0.5, d: 6.5 },
        { f: NOTE(17) * 2.02, g: 0.26, d: 4.2 },
        { f: NOTE(17) * 2.94, g: 0.16, d: 3.1 },
        { f: NOTE(17) * 4.16, g: 0.08, d: 2.2 },
      ];
      for (const p of partials) {
        const o = n.ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = p.f * (1 + (Math.random() - 0.5) * 0.004);
        const g = n.ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(p.g * 0.28 * level, when + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, when + p.d);
        o.connect(g);
        g.connect(n.effectsBus);
        o.start(when);
        o.stop(when + p.d + 0.1);
        o.onended = () => { o.disconnect(); g.disconnect(); };
      }
    }
  }

  private whoosh(level = 0.65) {
    const n = this.n;
    if (!n) return;
    const when = n.ctx.currentTime;
    const src = n.ctx.createBufferSource();
    src.buffer = n.noiseBuf;
    const f = n.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(1100, when);
    f.frequency.exponentialRampToValueAtTime(110, when + 1.5);
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.7);
    src.connect(f);
    f.connect(g);
    g.connect(n.effectsBus);
    src.start(when);
    src.stop(when + 1.8);
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
  }

  // --------------------------------------------------------------- buffers

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

  /** Stereo hall: exponential noise tail whose highs decay faster than its lows. */
  private impulse(ctx: AudioContext, seconds: number) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const p = i / len;
        const env = Math.exp(-5.5 * p);
        const alpha = 0.55 - 0.45 * p; // the tail darkens as it fades
        lp += alpha * ((Math.random() * 2 - 1) - lp);
        data[i] = lp * env * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }
}
