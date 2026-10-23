/**
 * A very small generative audio bed for the creek: wind, a bowed drone,
 * and a handful of hand-struck tones. No files, no network, no autoplay.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { noise: AudioBufferSourceNode; drones: OscillatorNode[] } | null = null;
let enabled = false;

type Kind = "click" | "chime" | "bell" | "error" | "seal";

function ensure(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function startAmbience(audio: AudioContext, out: GainNode) {
  if (ambient) return;
  const bed = audio.createGain();
  bed.gain.value = 0.14;
  bed.connect(out);

  const buffer = audio.createBuffer(1, audio.sampleRate * 3, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const wind = audio.createBiquadFilter();
  wind.type = "bandpass";
  wind.frequency.value = 420;
  wind.Q.value = 0.7;
  const windGain = audio.createGain();
  windGain.gain.value = 0.12;
  noise.connect(wind).connect(windGain).connect(bed);
  noise.start();

  const droneGain = audio.createGain();
  droneGain.gain.value = 0.035;
  droneGain.connect(bed);
  const drones: OscillatorNode[] = [];
  [55, 82.41, 110].forEach((frequency, index) => {
    const osc = audio.createOscillator();
    osc.type = index === 2 ? "triangle" : "sine";
    osc.frequency.value = frequency;
    osc.detune.value = index === 1 ? 7 : -4;
    const lfo = audio.createOscillator();
    lfo.frequency.value = 0.06 + index * 0.017;
    const lfoGain = audio.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain).connect(osc.detune);
    osc.connect(droneGain);
    osc.start();
    lfo.start();
    drones.push(osc);
  });

  ambient = { noise, drones };
}

function tone(freq: number, duration: number, type: OscillatorType, volume: number, delay = 0) {
  if (!enabled) return;
  const audio = ensure();
  if (!audio || !master) return;
  const at = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

export function setSound(on: boolean) {
  enabled = on;
  if (!on) {
    if (master && ctx) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
    return;
  }
  const audio = ensure();
  if (!audio || !master) return;
  master.gain.setTargetAtTime(0.5, audio.currentTime, 0.15);
  if (!ambient) startAmbience(audio, master);
  tone(523.25, 2.2, "sine", 0.05);
  tone(783.99, 2.8, "sine", 0.025, 0.12);
}

export function sfx(kind: Kind) {
  if (!enabled) return;
  switch (kind) {
    case "click":
      tone(196, 0.09, "triangle", 0.035);
      break;
    case "chime":
      tone(659.25, 1.4, "sine", 0.06);
      tone(987.77, 1.1, "sine", 0.025, 0.04);
      break;
    case "bell":
      tone(146.83, 3.4, "sine", 0.12);
      tone(293.66, 2.1, "sine", 0.045, 0.05);
      tone(440, 1.4, "triangle", 0.018, 0.1);
      break;
    case "seal":
      tone(392, 0.7, "sine", 0.05);
      tone(523.25, 0.9, "sine", 0.045, 0.12);
      tone(783.99, 1.6, "sine", 0.04, 0.26);
      break;
    case "error":
      tone(155.56, 0.45, "triangle", 0.06);
      tone(146.83, 0.5, "sine", 0.05, 0.06);
      break;
  }
}

export function isSoundOn() {
  return enabled;
}
