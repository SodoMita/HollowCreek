// The keeper's music box — a composed 8-bar theme in D minor on a 66 BPM grid.
// It is NOT the road score: the AudioDirector wakes it only for intimate
// moments (hands on a ward, or walking the recorded past), then lets it sleep.
// Same WebAudio graph, no downloads; every note is a synthesised tine.

const F = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const BEAT = 60 / 66;
const PHRASE_BEATS = 32;

interface Note { b: number; n: number; d: number; v: number }
// Theme and answer, hand-written; the C# only lands at the loop's end so it
// pulls back to D like a held breath.
const THEME: Note[] = [
  { b: 0, n: 69, d: 1.5, v: 0.9 }, { b: 2, n: 74, d: 1, v: 0.8 }, { b: 3, n: 77, d: 1, v: 0.85 },
  { b: 4, n: 76, d: 1.5, v: 0.8 }, { b: 6, n: 74, d: 1, v: 0.7 }, { b: 7, n: 72, d: 0.5, v: 0.55 },
  { b: 8, n: 70, d: 1.5, v: 0.85 }, { b: 10, n: 74, d: 1, v: 0.75 }, { b: 11, n: 77, d: 1, v: 0.8 },
  { b: 12, n: 76, d: 2, v: 0.8 }, { b: 14.5, n: 74, d: 1.5, v: 0.7 },
  { b: 16, n: 67, d: 1, v: 0.75 }, { b: 17, n: 70, d: 1, v: 0.7 }, { b: 18, n: 74, d: 1.5, v: 0.85 },
  { b: 20, n: 77, d: 1, v: 0.8 }, { b: 21, n: 76, d: 1, v: 0.6 }, { b: 22, n: 74, d: 1.5, v: 0.75 },
  { b: 24, n: 69, d: 1, v: 0.8 }, { b: 25, n: 74, d: 1, v: 0.7 }, { b: 26, n: 76, d: 1.5, v: 0.8 },
  { b: 28, n: 73, d: 1.5, v: 0.85 }, { b: 30, n: 76, d: 1, v: 0.7 }, { b: 31, n: 74, d: 1, v: 0.75 },
];
const ANSWER: Note[] = [
  { b: 0, n: 74, d: 1.5, v: 0.8 }, { b: 2, n: 77, d: 1, v: 0.7 }, { b: 3, n: 81, d: 1, v: 0.8 },
  { b: 4, n: 79, d: 1.5, v: 0.8 }, { b: 6, n: 77, d: 1, v: 0.7 }, { b: 7, n: 76, d: 0.5, v: 0.55 },
  { b: 8, n: 77, d: 1.5, v: 0.8 }, { b: 10, n: 74, d: 1, v: 0.7 }, { b: 11, n: 70, d: 1, v: 0.75 },
  { b: 12, n: 72, d: 2, v: 0.7 }, { b: 14.5, n: 74, d: 1.5, v: 0.65 },
  { b: 16, n: 70, d: 1, v: 0.75 }, { b: 17, n: 74, d: 1, v: 0.7 }, { b: 18, n: 79, d: 1.5, v: 0.8 },
  { b: 20, n: 77, d: 1, v: 0.7 }, { b: 21, n: 74, d: 1, v: 0.6 }, { b: 22, n: 70, d: 1.5, v: 0.7 },
  { b: 24, n: 76, d: 1, v: 0.75 }, { b: 25, n: 73, d: 1, v: 0.7 }, { b: 26, n: 69, d: 1.5, v: 0.75 },
  { b: 28, n: 69, d: 2, v: 0.8 }, { b: 30.5, n: 62, d: 1.5, v: 0.7 },
];

export class MusicBox {
  private out: GainNode;
  private bus: GainNode;
  private active = false;
  private gridStart = 0;
  private nextBeat = 0;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0; // asleep until the director wakes it
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.8;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1900;
    this.bus.connect(this.out);
    this.bus.connect(delay);
    delay.connect(damp); damp.connect(fb); fb.connect(delay);
    delay.connect(this.out);
    this.out.connect(dest);
  }

  /** Fade the box in for ward work / the past; let it ring out afterwards. */
  setActive(on: boolean, t: number) {
    if (on === this.active) return;
    this.active = on;
    if (on) { this.gridStart = t + 0.2; this.nextBeat = 0; }
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(on ? 0.5 : 0, t, on ? 0.6 : 1.4);
  }

  /** Called by the director's scheduler; keeps the theme on its beat grid. */
  tick(t: number) {
    if (!this.active) return;
    while (this.gridStart + this.nextBeat * BEAT < t + 0.4) {
      const beat = this.nextBeat;
      const when = this.gridStart + beat * BEAT;
      const inPhrase = beat % PHRASE_BEATS;
      const phraseIdx = Math.floor(beat / PHRASE_BEATS);
      const phrase = phraseIdx % 2 === 0 ? THEME : ANSWER;
      const octave = phraseIdx % 4 === 3 ? 12 : 0;
      for (const note of phrase) {
        if (Math.floor(note.b) !== inPhrase) continue;
        this.tine(when + (note.b - inPhrase) * BEAT, F(note.n + octave), note.v * 0.16, note.d * BEAT);
      }
      this.nextBeat++;
    }
  }

  private tine(when: number, freq: number, gain: number, dur: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = freq * 3.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const g = ctx.createGain();
    const tail = Math.max(1.6, dur + 1.2);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + tail);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(4600, when);
    lp.frequency.exponentialRampToValueAtTime(1100, when + tail * 0.7);
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(lp); lp.connect(this.bus);
    o.start(when); o2.start(when);
    o.stop(when + tail + 0.1); o2.stop(when + tail + 0.1);
    o2.onended = () => { o.disconnect(); o2.disconnect(); g.disconnect(); g2.disconnect(); lp.disconnect(); };
  }

  destroy() {
    try { this.out.disconnect(); this.bus.disconnect(); } catch { /* already gone */ }
  }
}
