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
  private timers: ReturnType<typeof setTimeout>[] = [];
  private nextMotif = 0;
  private nextBell = 0;
  private lastPhase = "";
  private danger = 0;
  private blackoutUntil = 0;

  constructor(private store: SettingsStore = new SettingsStore()) {
    this.mutedFlag = !!store.value?.audio?.muted;
  }

  get muted() {
    return this.mutedFlag;
  }

  start() {
    if (this.started) return;
    const AC: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.started = true;
      const master = ctx.createGain();
      master.gain.value = this.mutedFlag ? 0 : 0.85;

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
      windGain.connect(master);
      windGain.connect(wet);
      wind.start();

      // ---- drone: bowed strings, detuned ----
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 620;
      droneFilter.Q.value = 1.4;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.11;
      droneFilter.connect(droneGain);
      droneGain.connect(master);
      droneGain.connect(wet);
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
      choirGain.connect(master);
      choirGain.connect(wet);
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
      musicBoxBus.connect(master);
      musicBoxBus.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      delay.connect(master);

      // ---- heartbeat ----
      const heartGain = ctx.createGain();
      heartGain.gain.value = 0;
      heartGain.connect(master);
      const tensionGain = ctx.createGain();
      tensionGain.gain.value = 0;
      tensionGain.connect(master);
      tensionGain.connect(wet);

      this.n = {
        ctx, master, wet, musicBoxBus, droneFilter, droneGain, droneOsc,
        choirGain, choirOsc, windGain, windFilter, heartGain, tensionGain, noiseBuf,
      };

      this.nextMotif = ctx.currentTime + 2.5;
      this.nextBell = ctx.currentTime + 12;
      this.schedule();
      void ctx.resume();
    } catch {
      this.started = false;
    }
  }

  setMuted(muted: boolean) {
    this.mutedFlag = muted;
    if (this.n) {
      const t = this.n.ctx.currentTime;
      this.n.master.gain.cancelScheduledValues(t);
      this.n.master.gain.setTargetAtTime(muted ? 0 : 0.85, t, 0.12);
    }
  }

  destroy() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
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
    this.danger = snap.danger ?? 0;
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
    this.n.heartGain.gain.setTargetAtTime(0.32 * this.danger, t, 0.4);

    const blackout = Date.now() < this.blackoutUntil;
    this.n.windGain.gain.setTargetAtTime(blackout ? 0.26 : 0.16, t, 0.8);
    this.n.windFilter.frequency.setTargetAtTime(blackout ? 240 : 420 + 220 * this.danger, t, 1.1);

    if (snap.phase !== this.lastPhase) {
      this.lastPhase = snap.phase;
      if (snap.phase === "meeting") this.toll(1);
      if (snap.phase === "ended") this.toll(3);
      if (blackout) this.whoosh();
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
    // heartbeat, gated by dread
    if (this.danger > 0.05) {
      const period = 1.25 - 0.55 * this.danger;
      this.heart(t);
      this.timers.push(setTimeout(() => this.heart(n.ctx.currentTime), period * 500));
    }
    this.timers.push(setTimeout(() => this.schedule(), 1000));
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
        g.connect(n.master);
        g.connect(n.wet);
        o.start(when);
        o.stop(when + p.d + 0.1);
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
    g.connect(n.master);
    g.connect(n.wet);
    src.start(when);
    src.stop(when + 1.8);
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
