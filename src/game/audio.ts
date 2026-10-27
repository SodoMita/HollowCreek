// Generative score for Hollow Creek. No audio files: every sound is synthesised
// in the browser and follows the game state (snapshot.danger, blackout, bell).
//
//   wind       brown noise through a moving bandpass — the valley breathing
//   drone      bowed strings in D, cycling Dm · Bb · F · Am every 17s
//   music box  a sparse D-minor pentatonic motif through a feedback delay
//   tension    a 48Hz heartbeat and a detuned choir, keyed to snapshot.danger
//   bell       a partial-stacked chapel bell on a slow random schedule
//
import type { Snapshot } from "./types";
import { SettingsStore } from "./settings";

const NOTE = (semis: number) => 55 * Math.pow(2, semis / 12); // A1 reference

interface CtxNodes {
  ctx: AudioContext;
  master: GainNode;
  musicBus: GainNode;
  ambienceBus: GainNode;
  effectsBus: GainNode;
  wet: GainNode;
  musicBoxBus: GainNode;
  droneFilter: BiquadFilterNode;
  droneGain: GainNode;
  droneOsc: OscillatorNode[];
  choirGain: GainNode;
  choirOsc: OscillatorNode[];
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  heartGain: GainNode;
  tensionGain: GainNode;
  noiseBuf: AudioBuffer;
}

export class AudioDirector {
  private n: CtxNodes | null = null;
  private started = false;
  private mutedFlag = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextHeart = 0;
  private unsubscribe: () => void;
  private nextMotif = 0;
  private nextBell = 0;
  private lastPhase = "";
  private danger = 0;
  private heartDanger = 0;
  private blackoutUntil = 0;

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
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      master.connect(comp);
      comp.connect(ctx.destination);

      // hand-made plate reverb
      const convolver = ctx.createConvolver();
      convolver.buffer = this.impulse(ctx, 2.6, 2.4);
      const wet = ctx.createGain();
      wet.gain.value = 0.34;
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

      const noiseBuf = this.noise(ctx, 4);

      // ---- wind ----
      const wind = ctx.createBufferSource();
      wind.buffer = noiseBuf;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = "bandpass";
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.7;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.16;
      wind.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(ambienceBus);
      wind.start();

      // ---- drone: bowed strings, detuned ----
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 620;
      droneFilter.Q.value = 1.4;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.11;
      droneFilter.connect(droneGain);
      droneGain.connect(musicBus);
      const droneOsc: OscillatorNode[] = [];
      [0, 0.16, -0.19, 0.31].forEach((detune, i) => {
        const o = ctx.createOscillator();
        o.type = i % 2 ? "sawtooth" : "triangle";
        o.detune.value = detune * 100;
        o.connect(droneFilter);
        o.start();
        droneOsc.push(o);
      });

      // ---- choir (tension layer) ----
      const choirFilter = ctx.createBiquadFilter();
      choirFilter.type = "bandpass";
      choirFilter.frequency.value = 780;
      choirFilter.Q.value = 2.6;
      const choirGain = ctx.createGain();
      choirGain.gain.value = 0;
      choirFilter.connect(choirGain);
      choirGain.connect(musicBus);
      const choirOsc: OscillatorNode[] = [];
      [-7, 0, 7, 12].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.detune.value = det;
        o.frequency.value = NOTE(21);
        o.connect(choirFilter);
        o.start();
        choirOsc.push(o);
      });

      // ---- music box bus with feedback delay ----
      const musicBoxBus = ctx.createGain();
      musicBoxBus.gain.value = 0.55;
      const delay = ctx.createDelay(1.2);
      delay.delayTime.value = 0.38;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2200;
      musicBoxBus.connect(musicBus);
      musicBoxBus.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      delay.connect(musicBus);

      // ---- heartbeat ----
      const heartGain = ctx.createGain();
      heartGain.gain.value = 0;
      heartGain.connect(effectsBus);
      const tensionGain = ctx.createGain();
      tensionGain.gain.value = 0;
      tensionGain.connect(musicBus);

      this.n = {
        ctx, master, musicBus, ambienceBus, effectsBus, wet, musicBoxBus, droneFilter, droneGain, droneOsc,
        choirGain, choirOsc, windGain, windFilter, heartGain, tensionGain, noiseBuf,
      };

      this.applyMix();
      this.nextMotif = ctx.currentTime + 2.5;
      this.nextBell = ctx.currentTime + 12;
      this.schedule();
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
        this.n.droneOsc.forEach((o) => o.stop());
        this.n.choirOsc.forEach((o) => o.stop());
        void this.n.ctx.close();
      } catch { /* already closed */ }
    }
    this.n = null;
    this.started = false;
  }

  /** Feed the score every snapshot. */
  update(snap: Snapshot) {
    if (!this.n) return;
    const t = this.n.ctx.currentTime;
    const actualDanger = snap.danger ?? 0;
    this.heartDanger = actualDanger;
    this.danger = this.store.value.audio.adaptiveMusic ? actualDanger : 0;
    this.blackoutUntil = snap.blackoutUntil ?? 0;

    // chord cycle Dm · Bb · F · Am — 17s each
    const cycle = Math.floor(t / 17) % 4;
    const roots = [26, 22, 29, 21]; // D2 · Bb1 · F2 · A1 in semis from A1
    const root = roots[cycle];
    this.n.droneOsc.forEach((o, i) => {
      o.frequency.setTargetAtTime(NOTE(root + [0, 7, 12, 19][i]), t, 1.6);
    });
    this.n.choirOsc.forEach((o, i) => {
      o.frequency.setTargetAtTime(NOTE(root + 12 + [0, 7, 12, 15][i]), t, 2.2);
    });
    this.n.droneFilter.frequency.setTargetAtTime(420 + 320 * (1 - this.danger), t, 1.2);
    this.n.choirGain.gain.setTargetAtTime(0.035 * Math.pow(this.danger, 1.5), t, 0.9);
    this.n.tensionGain.gain.setTargetAtTime(0.25 * this.danger, t, 0.7);
    this.n.heartGain.gain.setTargetAtTime(this.store.value.audio.heartbeat ? 0.32 * actualDanger : 0, t, 0.4);

    const blackout = Date.now() < this.blackoutUntil;
    this.n.windGain.gain.setTargetAtTime(blackout ? 0.26 : 0.16, t, 0.8);
    this.n.windFilter.frequency.setTargetAtTime(blackout ? 240 : 420 + 220 * this.danger, t, 1.1);

    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      if (snap.phase === "meeting") this.toll(1);
      if (snap.phase === "ended") this.toll(3);
      if (blackout) this.whoosh();
    }
    // one-shots driven by state changes: work finished, someone fell, someone rose
    const done = snap.taskBar?.done ?? 0;
    if (done !== this.lastDone) {
      if (done > this.lastDone) this.chime();
      this.lastDone = done;
    }
    const downed = !snap.self.alive; // 1D rule: the fall is death (downed existed only in the 2D branch)
    if (downed !== this.lastDowned) {
      if (downed) this.thud();
      else this.riseTone();
      this.lastDowned = downed;
    }
    if (snap.bellAt && snap.bellAt !== this.lastBellAt) {
      this.lastBellAt = snap.bellAt;
      this.toll(1);
    }
    if (snap.blackoutUntil && snap.blackoutUntil !== this.lastBlackoutAt) {
      this.lastBlackoutAt = snap.blackoutUntil;
      this.whoosh();
    }
  }
  private lastBellAt = 0;
  private lastBlackoutAt = 0;
  private lastDone = 0;
  private lastDowned = false;

  /** A ward finished: a small bright figure, like a music box catching the light. */
  private chime() {
    const n = this.n;
    if (!n) return;
    const base = n.ctx.currentTime;
    [0, 4, 7, 12].forEach((semis, i) => this.pluck(base + i * 0.11, NOTE(semis + 36), 0.13));
  }

  /** The fog takes someone. */
  private thud() {
    const n = this.n;
    if (!n) return;
    const when = n.ctx.currentTime;
    const o = n.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(32, when + 0.7);
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.55, when + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    o.connect(g);
    g.connect(n.effectsBus);
    o.start(when);
    o.stop(when + 1);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    this.whoosh();
  }

  /** A friend is back on their feet. */
  private riseTone() {
    const n = this.n;
    if (!n) return;
    const when = n.ctx.currentTime;
    const o = n.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(NOTE(24), when);
    o.frequency.exponentialRampToValueAtTime(NOTE(36), when + 0.55);
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.22, when + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 1.1);
    o.connect(g);
    g.connect(n.effectsBus);
    o.start(when);
    o.stop(when + 1.2);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    this.pluck(when + 0.18, NOTE(31), 0.14);
  }

  // ------------------------------------------------------------- synthesis

  private schedule() {
    const n = this.n;
    if (!n) return;
    const t = n.ctx.currentTime;
    if (t >= this.nextMotif) {
      this.pluckMotif();
      this.nextMotif = t + 7 + Math.random() * 9;
    }
    if (t >= this.nextBell) {
      this.toll(1);
      this.nextBell = t + 42 + Math.random() * 70;
    }
    // One double beat per period; faster as danger grows, without accumulating timers.
    if (this.store.value.audio.heartbeat && this.heartDanger > 0.05 && t >= this.nextHeart) {
      this.heart(t);
      this.nextHeart = t + 1.25 - 0.55 * this.heartDanger;
    }
    this.timer = setTimeout(() => this.schedule(), 200);
  }

  private pluckMotif() {
    const n = this.n;
    if (!n) return;
    // D minor pentatonic: D F G A C
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const semis = scale[Math.floor(Math.random() * scale.length)] + 24;
      const when = n.ctx.currentTime + i * (0.32 + Math.random() * 0.22);
      this.pluck(when, NOTE(semis + 12), 0.16 * (1 - this.danger * 0.35));
    }
  }

  private pluck(when: number, freq: number, gain: number) {
    const n = this.n;
    if (!n) return;
    const o = n.ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const o2 = n.ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 2.002;
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 2.4);
    const lp = n.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5200, when);
    lp.frequency.exponentialRampToValueAtTime(900, when + 1.6);
    o.connect(g);
    o2.connect(g);
    g.connect(lp);
    lp.connect(n.musicBoxBus);
    o.start(when);
    o2.start(when);
    o.stop(when + 2.6);
    o2.stop(when + 2.6);
    o2.onended = () => { o.disconnect(); o2.disconnect(); g.disconnect(); lp.disconnect(); };
  }

  private heart(at: number) {
    const n = this.n;
    if (!n) return;
    const beat = (when: number, amp: number) => {
      const o = n.ctx.createOscillator();
      o.type = "sine";
      const g = n.ctx.createGain();
      o.frequency.setValueAtTime(72, when);
      o.frequency.exponentialRampToValueAtTime(38, when + 0.16);
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
    beat(at + 0.26, 0.62);
  }

  /** Chapel bell: a stack of inharmonic partials with a long decay. */
  toll(times: number) {
    const n = this.n;
    if (!n) return;
    for (let k = 0; k < times; k++) {
      const when = n.ctx.currentTime + k * 1.9;
      const partials = [
        { f: NOTE(26), g: 0.5, d: 6.5 },
        { f: NOTE(26) * 2.02, g: 0.28, d: 4.2 },
        { f: NOTE(26) * 2.94, g: 0.18, d: 3.1 },
        { f: NOTE(26) * 4.16, g: 0.1, d: 2.2 },
      ];
      for (const p of partials) {
        const o = n.ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = p.f * (1 + (Math.random() - 0.5) * 0.004);
        const g = n.ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(p.g * 0.42, when + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, when + p.d);
        o.connect(g);
        g.connect(n.effectsBus);
        o.start(when);
        o.stop(when + p.d + 0.1);
        o.onended = () => { o.disconnect(); g.disconnect(); };
      }
    }
  }

  private whoosh() {
    const n = this.n;
    if (!n) return;
    const when = n.ctx.currentTime;
    const src = n.ctx.createBufferSource();
    src.buffer = n.noiseBuf;
    const f = n.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(1200, when);
    f.frequency.exponentialRampToValueAtTime(120, when + 1.5);
    const g = n.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.5, when + 0.12);
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
