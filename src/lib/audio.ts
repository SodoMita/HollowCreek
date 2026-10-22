"use client";

/**
 * Generative score for Hollow Creek - no audio files, everything is synthesised.
 *
 * Bed (always on while unmuted):
 *   wind    - brown-ish noise through a slowly sweeping bandpass
 *   strings - a slow chord bed (Dm -> Bb -> F -> Am) of detuned oscillators
 *   motif   - sparse music-box notes from the D minor pentatonic through a
 *             feedback delay, played at random intervals
 * Tension layer (faded in and out by the game state):
 *   pulse   - a gated low sine heartbeat
 *   choir   - two detuned saws through a narrow bandpass
 */

type Score = ReturnType<typeof createScore>;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let score: Score | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number, brown = false) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    } else {
      data[i] = white;
    }
  }
  return buf;
}

const D = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Dm, Bb, F, Am as midi note stacks
const CHORDS: number[][] = [
  [38, 50, 53, 57],
  [34, 46, 50, 53],
  [41, 53, 57, 60],
  [33, 45, 48, 52],
];
const PENT = [74, 77, 79, 81, 84, 86, 89, 91];

function createScore(c: AudioContext, out: AudioNode) {
  const bed = c.createGain();
  bed.gain.value = 0;
  const tension = c.createGain();
  tension.gain.value = 0;
  const delay = c.createDelay(1.5);
  delay.delayTime.value = 0.42;
  const feedback = c.createGain();
  feedback.gain.value = 0.34;
  const wet = c.createGain();
  wet.gain.value = 0.5;
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(bed);
  bed.connect(out);
  tension.connect(out);

  // ---- wind
  const wind = c.createBufferSource();
  wind.buffer = noiseBuffer(c, 5, true);
  wind.loop = true;
  const windFilter = c.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 380;
  windFilter.Q.value = 0.7;
  const windGain = c.createGain();
  windGain.gain.value = 0.16;
  const windLfo = c.createOscillator();
  windLfo.frequency.value = 0.06;
  const windLfoGain = c.createGain();
  windLfoGain.gain.value = 260;
  windLfo.connect(windLfoGain).connect(windFilter.frequency);
  const windSwell = c.createOscillator();
  windSwell.frequency.value = 0.11;
  const windSwellGain = c.createGain();
  windSwellGain.gain.value = 0.09;
  windSwell.connect(windSwellGain).connect(windGain.gain);
  wind.connect(windFilter).connect(windGain).connect(bed);
  wind.start();
  windLfo.start();
  windSwell.start();

  // ---- string bed
  const stringGain = c.createGain();
  stringGain.gain.value = 0.09;
  const stringFilter = c.createBiquadFilter();
  stringFilter.type = "lowpass";
  stringFilter.frequency.value = 900;
  stringGain.connect(stringFilter).connect(bed);
  const voices: { osc: OscillatorNode; gain: GainNode }[] = [];
  for (let i = 0; i < 4; i++) {
    const osc = c.createOscillator();
    osc.type = i % 2 === 0 ? "sawtooth" : "triangle";
    osc.detune.value = (i - 1.5) * 7;
    const g = c.createGain();
    g.gain.value = 0.0001;
    osc.connect(g).connect(stringGain);
    osc.start();
    voices.push({ osc, gain: g });
  }
  let chordIndex = 0;
  const playChord = (idx: number) => {
    const notes = CHORDS[idx % CHORDS.length];
    const t0 = c.currentTime;
    notes.forEach((n, i) => {
      const v = voices[i];
      v.osc.frequency.setValueAtTime(v.osc.frequency.value, t0);
      v.osc.frequency.linearRampToValueAtTime(D(n), t0 + 6);
      v.gain.gain.cancelScheduledValues(t0);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t0);
      v.gain.gain.linearRampToValueAtTime(0.25, t0 + 7);
    });
  };
  playChord(0);
  const chordTimer = setInterval(() => {
    chordIndex = (chordIndex + 1) % CHORDS.length;
    playChord(chordIndex);
  }, 17_000);

  // ---- music box motif
  let motifTimer: ReturnType<typeof setTimeout> | null = null;
  const motif = () => {
    const t0 = c.currentTime;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const note = PENT[Math.floor(Math.random() * PENT.length)];
      const at = t0 + i * (0.22 + Math.random() * 0.2);
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = D(note);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.14, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
      const bp = c.createBiquadFilter();
      bp.type = "highpass";
      bp.frequency.value = 400;
      osc.connect(g).connect(bp);
      bp.connect(bed);
      bp.connect(delay);
      osc.start(at);
      osc.stop(at + 2.8);
    }
    motifTimer = setTimeout(motif, 3200 + Math.random() * 7000);
  };
  motifTimer = setTimeout(motif, 2500);

  // ---- tension: heartbeat pulse + detuned choir
  const pulse = c.createOscillator();
  pulse.type = "sine";
  pulse.frequency.value = 48;
  const pulseGain = c.createGain();
  pulseGain.gain.value = 0;
  const pulseShaper = c.createGain();
  pulseShaper.gain.value = 1;
  const pulseLfo = c.createOscillator();
  pulseLfo.type = "square";
  pulseLfo.frequency.value = 1.05;
  const pulseLfoGain = c.createGain();
  pulseLfoGain.gain.value = 0.5;
  const pulseOffset = c.createConstantSource();
  pulseOffset.offset.value = 0.5;
  const pulseGate = c.createGain();
  pulseGate.gain.value = 0;
  pulseLfo.connect(pulseLfoGain).connect(pulseGate.gain);
  pulseOffset.connect(pulseGate.gain);
  pulse.connect(pulseGain).connect(pulseGate).connect(tension);
  pulse.start();
  pulseLfo.start();
  pulseOffset.start();

  const choirGain = c.createGain();
  choirGain.gain.value = 0.1;
  const choirFilter = c.createBiquadFilter();
  choirFilter.type = "bandpass";
  choirFilter.frequency.value = 320;
  choirFilter.Q.value = 2.5;
  choirGain.connect(choirFilter).connect(tension);
  const choir: OscillatorNode[] = [];
  [50, 62, 74].forEach((n, i) => {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = D(n);
    o.detune.value = i === 1 ? 11 : -9;
    const g = c.createGain();
    g.gain.value = 0.3;
    o.connect(g).connect(choirGain);
    o.start();
    choir.push(o);
  });
  const choirLfo = c.createOscillator();
  choirLfo.frequency.value = 0.23;
  const choirLfoGain = c.createGain();
  choirLfoGain.gain.value = 120;
  choirLfo.connect(choirLfoGain).connect(choirFilter.frequency);
  choirLfo.start();

  return {
    fadeBed(to: number, secs = 3) {
      bed.gain.cancelScheduledValues(c.currentTime);
      bed.gain.linearRampToValueAtTime(to, c.currentTime + secs);
    },
    setTension(level: number) {
      const target = Math.max(0, Math.min(1, level));
      tension.gain.cancelScheduledValues(c.currentTime);
      tension.gain.linearRampToValueAtTime(target * 0.55, c.currentTime + 1.4);
    },
    setChoirPitch(semitones: number) {
      choir.forEach((o, i) => {
        o.frequency.linearRampToValueAtTime(D(50 + semitones + i * 12), c.currentTime + 2);
      });
    },
    stop() {
      if (motifTimer) clearTimeout(motifTimer);
      clearInterval(chordTimer);
      this.fadeBed(0, 0.6);
      tension.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
      const nodes = [wind, windLfo, windSwell, pulse, pulseLfo, pulseOffset, choirLfo, ...choir, ...voices.map((v) => v.osc)];
      setTimeout(() => {
        nodes.forEach((n) => {
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        });
      }, 900);
    },
  };
}

export function startScore() {
  const c = ac();
  if (!c || !master || score) return;
  score = createScore(c, master);
  score.fadeBed(1, 4);
}

export function stopScore() {
  score?.stop();
  score = null;
}

export function setTension(level: number) {
  score?.setTension(level);
}

export function nudgeChoir(semitones: number) {
  score?.setChoirPitch(semitones);
}

export function unlockAudio() {
  ac();
}

export function setMuted(m: boolean) {
  muted = m;
  const c = ac();
  if (!c || !master) return;
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.linearRampToValueAtTime(m ? 0 : 0.6, c.currentTime + 0.25);
}

// ---------------------------------------------------------------- one-shots
function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  gain = 0.2,
  bendTo?: number,
) {
  const c = ac();
  if (!c || !master) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, c.currentTime + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(c.currentTime + dur + 0.05);
}

function noise(dur: number, freq: number, gain = 0.15, q = 1) {
  const c = ac();
  if (!c || !master) return null;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  src.connect(f).connect(g).connect(master);
  src.start();
  src.stop(c.currentTime + dur);
  return src;
}

export const sfx = {
  bell() {
    [180, 270, 405, 540].forEach((f, i) => {
      setTimeout(() => {
        tone(f, 3.4 - i * 0.4, "sine", 0.24 / (i + 1));
        tone(f * 1.01, 2.2, "triangle", 0.09 / (i + 1));
      }, i * 90);
    });
    setTimeout(() => noise(1.6, 900, 0.05, 0.7), 60);
  },
  kill() {
    noise(0.5, 140, 0.4, 0.6);
    tone(320, 0.9, "sawtooth", 0.14, 60);
    setTimeout(() => tone(880, 0.5, "square", 0.05, 180), 60);
  },
  report() {
    tone(660, 0.7, "sawtooth", 0.13, 220);
    setTimeout(() => noise(0.8, 500, 0.2, 0.5), 80);
  },
  snuff() {
    noise(1.4, 260, 0.34, 0.4);
    tone(120, 1.6, "sine", 0.13, 40);
  },
  flare() {
    noise(0.8, 1800, 0.2, 0.6);
    tone(520, 0.5, "triangle", 0.09, 900);
  },
  cage() {
    noise(0.35, 2600, 0.28, 2);
    tone(150, 0.5, "square", 0.13, 90);
    setTimeout(() => noise(0.3, 3200, 0.2, 3), 110);
  },
  free() {
    tone(700, 0.16, "square", 0.11);
    setTimeout(() => tone(1050, 0.2, "square", 0.09), 90);
  },
  task() {
    tone(880, 0.18, "sine", 0.13);
    setTimeout(() => tone(1320, 0.25, "sine", 0.1), 90);
  },
  step() {
    noise(0.06, 220, 0.05, 1.2);
  },
  heartbeat() {
    tone(58, 0.14, "sine", 0.3);
    setTimeout(() => tone(48, 0.16, "sine", 0.22), 190);
  },
  whisper() {
    noise(0.9, 1500 + Math.random() * 900, 0.05, 0.8);
  },
  end(winner: string) {
    if (winner === "crew") {
      tone(392, 1.2, "sine", 0.15);
      setTimeout(() => tone(523, 1.6, "sine", 0.13), 200);
      setTimeout(() => tone(659, 2.4, "sine", 0.11), 400);
    } else {
      tone(110, 2.6, "sawtooth", 0.17, 40);
      noise(2.2, 200, 0.22, 0.4);
    }
  },
};
