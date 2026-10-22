// Generative WebAudio score for Hollow Creek — no asset files.
// Layers: wind bed, bowed drone in D, sparse music-box motif (D minor pentatonic),
// proximity heartbeat driven by server-computed snapshot.danger, blackout whoosh,
// crow caws, footsteps, and the meeting bell.

import type { Snapshot } from "./types";

const SCALE = [587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66]; // D5 F5 G5 A5 C6 D6
// slow chord cycle for the drone bed: Dm → Bb → F → Am (ported from Agent-Hollow)
const CHORDS = [
  [73.42, 110.0, 146.83, 174.61],
  [58.27, 87.31, 116.54, 146.83],
  [87.31, 130.81, 174.61, 220.0],
  [55.0, 82.41, 110.0, 130.81],
];

export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private nextMotif = 0;
  private nextBeat = 0;
  private nextStep = 0;
  private nextChord = 0;
  private chordIdx = 0;
  private droneOscs: OscillatorNode[] = [];
  private echoSend: DelayNode | null = null;
  private lastFlicker = 0;
  private lastBell = 0;
  private blackoutActive = false;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem("hc_muted") === "1"; } catch { /* ssr */ }
  }

  /** Must be called from a user gesture at least once. */
  start() {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(ctx.destination);

      // --- wind: looped noise through a wandering bandpass ---
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 380; bp.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.05;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain(); lfoG.gain.value = 190;
      lfo.connect(lfoG).connect(bp.frequency); lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.11;
      const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.025;
      lfo2.connect(lfo2G).connect(this.windGain.gain); lfo2.start();
      noise.connect(bp).connect(this.windGain).connect(this.master);
      noise.start();

      // --- bowed drone stack, cycling Dm → Bb → F → Am every 17s ---
      this.droneGain = ctx.createGain();
      this.droneGain.gain.value = 0.045;
      this.droneGain.connect(this.master);
      const gains = [0.5, 0.32, 0.22, 0.12];
      const dets = [0, 3, -4, 6];
      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator();
        o.type = "triangle"; o.frequency.value = CHORDS[0][i]; o.detune.value = dets[i];
        const og = ctx.createGain(); og.gain.value = gains[i];
        const trem = ctx.createOscillator(); trem.frequency.value = 0.13 + Math.random() * 0.1;
        const tremG = ctx.createGain(); tremG.gain.value = gains[i] * 0.4;
        trem.connect(tremG).connect(og.gain); trem.start();
        o.connect(og).connect(this.droneGain);
        o.start();
        this.droneOscs.push(o);
      }

      // --- feedback echo for the music box ---
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.34;
      const fb = ctx.createGain(); fb.gain.value = 0.34;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1900;
      const wet = ctx.createGain(); wet.gain.value = 0.22;
      delay.connect(lp).connect(fb).connect(delay);
      delay.connect(wet).connect(this.master);
      this.echoSend = delay;

      this.nextMotif = ctx.currentTime + 2;
      this.nextChord = ctx.currentTime + 17;
    } catch { this.ctx = null; }
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem("hc_muted", m ? "1" : "0"); } catch { /* noop */ }
    if (this.master && this.ctx) this.master.gain.linearRampToValueAtTime(m ? 0 : 0.9, this.ctx.currentTime + 0.2);
  }

  private tone(freq: number, t0: number, dur: number, gain: number, type: OscillatorType = "sine", echo = false) {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    if (echo && this.echoSend) g.connect(this.echoSend);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  bell() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t0 = t + i * 0.9;
      this.tone(392, t0, 1.6, 0.22);
      this.tone(587, t0, 1.4, 0.1);
      this.tone(784, t0, 1.1, 0.05);
    }
  }

  private caw() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * 0.22;
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(720, t0);
      o.frequency.exponentialRampToValueAtTime(420, t0 + 0.14);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.035, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1600;
      o.connect(lp).connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.2);
    }
  }

  private whooshDown() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.6);
  }

  private thump(strength: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(52, t, 0.16, 0.14 * strength);
    this.tone(48, t + 0.19, 0.13, 0.09 * strength);
  }

  private footstep() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.06;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
  }

  /** Called at ~10Hz with each fresh snapshot. */
  update(snap: Snapshot) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const me = snap.players.find((p) => p.id === snap.self.id);

    // events
    if (snap.bellAt > this.lastBell) {
      if (this.lastBell !== 0 || Date.now() - snap.bellAt < 4000) this.bell();
      this.lastBell = snap.bellAt;
    }
    if (snap.flickerAt > this.lastFlicker) {
      if (this.lastFlicker !== 0) this.caw();
      this.lastFlicker = snap.flickerAt;
    }
    const blackout = snap.now < snap.blackoutUntil;
    if (blackout && !this.blackoutActive) this.whooshDown();
    this.blackoutActive = blackout;

    // adaptive bed levels
    const tension = Math.max(snap.danger, snap.phase === "meeting" ? 0.3 : 0, blackout ? 0.45 : 0);
    if (this.droneGain) this.droneGain.gain.linearRampToValueAtTime(0.045 + tension * 0.05, t + 0.4);
    if (this.windGain) this.windGain.gain.linearRampToValueAtTime(blackout ? 0.1 : 0.05, t + 0.6);

    // heartbeat — you hear the Hollow before you see them
    if (snap.danger > 0.12 && snap.self.alive && t >= this.nextBeat) {
      this.thump(0.4 + snap.danger * 0.6);
      this.nextBeat = t + (1.5 - snap.danger * 1.0);
    }

    // slow chord drift in the drone bed
    if (t >= this.nextChord) {
      this.chordIdx = (this.chordIdx + 1) % CHORDS.length;
      this.droneOscs.forEach((o, i) => {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setValueAtTime(o.frequency.value, t);
        o.frequency.linearRampToValueAtTime(CHORDS[this.chordIdx][i], t + 5);
      });
      this.nextChord = t + 17;
    }

    // sparse music box motif through the echo — falls silent when danger is near
    if (t >= this.nextMotif) {
      if (snap.danger < 0.35 && snap.phase !== "ended") {
        const n = 3 + Math.floor(Math.random() * 3);
        let tt = t + 0.1;
        let idx = Math.floor(Math.random() * SCALE.length);
        for (let i = 0; i < n; i++) {
          this.tone(SCALE[idx], tt, 1.3, 0.045, "sine", true);
          this.tone(SCALE[idx] * 3.01, tt, 0.5, 0.008); // glassy partial
          idx = Math.max(0, Math.min(SCALE.length - 1, idx + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2))));
          tt += 0.34 + Math.random() * 0.22;
        }
      }
      this.nextMotif = t + 6 + Math.random() * 7;
    }

    // footsteps
    if (me?.moving && snap.self.alive && t >= this.nextStep) {
      this.footstep();
      this.nextStep = t + 0.31;
    }
  }
}