// Physical repair games for the nine structures on Hollow Creek's street.
// Recovered named games: Gloamwing's Lantern Rites, The Long Draw,
// Nine Candles, Crow Call and The Furrow (adapted for physical structures).
// All moves are turn-based and checked on the server. No time window, claimed
// solution, client position, or arbitrary progress value enters this module.

import {
  createCrowCall, createFurrow, createLongDrawBands, createNineCandles,
  lanternPar, tapCandle, turnLanternRings,
} from "./recovered-wards";

export type WardKind =
  | "pumpkins" | "well" | "scarecrow" | "lantern" | "chapel"
  | "mill" | "graves" | "radio" | "silo";

export interface WardPuzzle {
  kind: WardKind;
  seed: number;
  values: number[];  // position, selection, orientation or physical state
  targets: number[]; // construction tolerances / route / answer (not always shown)
  extra: number[];   // damage, clues or component labels
  step: number;      // completed phases in a multi-step repair
  mistakes: number;
  moves: number;
}

export interface WardGameView {
  stationId: string;
  name: string;
  kind: WardKind;
  values: number[];
  targets: number[];
  extra: number[];
  step: number;
  mistakes: number;
  moves: number;
  progress: number;
  /** Only Crow Call hides inputs while the crows show a fresh phrase. */
  revealMs: number;
}

/** Titles are the repair jobs, not generic symbols pasted over unrelated props. */
export const WARD_JOBS: Record<WardKind, { title: string; instruction: string }> = {
  pumpkins: { title: "Roof Truss · The Furrow", instruction: "Brace the shed with three sound beams. Then trace a drainage furrow around its foundation without lifting the tool." },
  well: { title: "The Long Draw", instruction: "Three draws of the bucket: crank to the pale catch band, ease rope tension before it slips, then lock the ratchet. Every catch moves the band." },
  scarecrow: { title: "Crow Call", instruction: "Drive crows from the torn scarecrow: watch their four calls, repeat each from memory as the pattern grows, and sew their feathers back into the straw." },
  lantern: { title: "Lantern Rites", instruction: "Set three meshed brass bands beneath the lamp wick. Each band has eight faces; turning one counter-turns its neighbour." },
  chapel: { title: "Nine Candles", instruction: "Relight the chapel altar: a touch changes that candle and its cross-neighbours. Restore all nine wicks, not just one." },
  mill: { title: "Gear Train", instruction: "Set driver, transfer, flywheel and blade cogs to their marked notches. Turning one gear turns its neighbours the other way." },
  graves: { title: "Marker Ledger", instruction: "Match four fallen name-stones to their plots using the surviving ledger clues. One stone belongs in each plot." },
  radio: { title: "Signal Lock", instruction: "Tune frequency and antenna against the signal meter. When the voice clears the static, lock the receiver." },
  silo: { title: "Crossbar Lock", instruction: "Seat the four door bars in load-bearing order, then throw the main bolt. A wrong bar knocks the last brace loose." },
};

const ALL_KINDS = Object.keys(WARD_JOBS) as WardKind[];
const mod4 = (v: number) => (v + 40) % 4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const randomFrom = (seed: number) => {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0x100000000; };
};
const shuffle = (n: number, rand: () => number) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function wardKindFor(stationKind: string): WardKind {
  if (ALL_KINDS.includes(stationKind as WardKind)) return stationKind as WardKind;
  throw new Error(`Unknown repair structure: ${stationKind}`);
}

function turnGear(values: number[], i: number): number[] {
  const next = [...values];
  next[i] = mod4(next[i] + 1);
  if (i > 0) next[i - 1] = mod4(next[i - 1] - 1);
  if (i < 3) next[i + 1] = mod4(next[i + 1] - 1);
  return next;
}

/** Every generated board has a constructive solution, even after errors. */
export function createWardPuzzle(stationKind: string, seed: number): WardPuzzle {
  const kind = wardKindFor(stationKind);
  const rand = randomFrom(seed ^ 0x8f13a9b);
  const base = { kind, seed, step: 0, mistakes: 0, moves: 0 };
  if (kind === "pumpkins") {
    const lengths = Array.from({ length: 6 }, () => 2 + Math.floor(rand() * 5));
    const splinter = Math.floor(rand() * 6);
    const sound = shuffle(6, rand).filter((i) => i !== splinter);
    const span = sound.slice(0, 3).reduce((sum, i) => sum + lengths[i], 0);
    const furrow = createFurrow(rand, 3, 7);
    return { ...base, values: Array(6).fill(0), targets: [...lengths, span, splinter, ...furrow], extra: [] };
  }
  if (kind === "well") {
    return { ...base, values: [0, 1, 0], targets: createLongDrawBands(rand), extra: [] };
  }
  if (kind === "scarecrow") {
    return { ...base, values: [0], targets: createCrowCall(rand), extra: [0] };
  }
  if (kind === "lantern") {
    let rings = [0, 0, 0];
    for (let attempt = 0; attempt < 40; attempt++) {
      rings = [0, 0, 0];
      for (let k = 0; k < 7; k++) rings = turnLanternRings(rings, Math.floor(rand() * 3), rand() < 0.5 ? 1 : -1);
      if (lanternPar(rings) >= 4) break;
    }
    if (lanternPar(rings) < 4) rings = [4, 0, 4]; // sum zero, guaranteed solvable
    return { ...base, values: rings, targets: [0, 0, 0], extra: [lanternPar(rings)] };
  }
  if (kind === "chapel") {
    const { candles, par } = createNineCandles(rand, 3);
    return { ...base, values: candles, targets: [], extra: [par] };
  }
  if (kind === "mill") {
    const targets = [0, 2, 0, 2];
    let values = [...targets];
    for (let k = 0; k < 3; k++) values = turnGear(values, Math.floor(rand() * 4));
    if (values.every((v, i) => v === targets[i])) values = turnGear(values, 0);
    return { ...base, values, targets, extra: [] };
  }
  if (kind === "graves") {
    return { ...base, values: [-1, -1, -1, -1], targets: shuffle(4, rand), extra: [] };
  }
  if (kind === "radio") {
    const targets = [2 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 3)];
    const values = [Math.floor(rand() * 2), 3 + Math.floor(rand() * 2)];
    return { ...base, values, targets, extra: [] };
  }
  // Each bar depends on the one carrying the load before it.
  return { ...base, values: [0, 0, 0, 0], targets: shuffle(4, rand), extra: [] };
}

export function validWardMove(game: WardPuzzle, index: number): boolean {
  const max: Record<WardKind, number> = {
    pumpkins: 16, well: 3, scarecrow: 5, lantern: 6, chapel: 9,
    mill: 4, graves: 16, radio: 5, silo: 5,
  };
  return Number.isInteger(index) && index >= 0 && index < max[game.kind];
}

/** A client submits one physical action. It never submits state or a win claim. */
export function applyWardMove(game: WardPuzzle, index: number): WardPuzzle {
  if (!validWardMove(game, index) || wardSolved(game)) return game;
  const next: WardPuzzle = { ...game, values: [...game.values], targets: [...game.targets], extra: [...game.extra], moves: game.moves + 1 };
  switch (game.kind) {
    case "pumpkins": {
      if (game.step === 0) {
        if (index < 6) next.values[index] = 1 - next.values[index];
        else if (index === 6) {
          const chosen = next.values.map((v, i) => v ? i : -1).filter((i) => i >= 0);
          const length = chosen.reduce((sum, i) => sum + game.targets[i], 0);
          if (chosen.length === 3 && !chosen.includes(game.targets[7]) && length === game.targets[6]) next.step = 1;
          else next.mistakes++;
        }
      } else if (index >= 7) {
        const furrow = game.targets.slice(8);
        if (furrow[game.step - 1] === index - 7) next.step++;
        else { next.step = 1; next.mistakes++; }
      }
      break;
    }
    case "well": {
      const [position, tension, slips] = game.values;
      const catchAt = game.targets[game.step];
      if (index === 0) {
        if (tension >= 4) { next.values = [Math.max(0, position - 2), 1, slips + 1]; next.mistakes++; }
        else next.values = [Math.min(14, position + 2), tension + 1, slips];
      } else if (index === 1) next.values[1] = Math.max(1, tension - 1);
      else if (Math.abs(position - catchAt) <= 1 && tension <= 2) {
        next.step++;
        next.values = [0, 1, slips];
      } else { next.values = [Math.max(0, position - 2), 1, slips + 1]; next.mistakes++; }
      break;
    }
    case "scarecrow": {
      if (index === 4) next.extra[0]++; // request another preview of this round
      else if (game.targets[game.step] === index) {
        next.step++;
        if (next.step >= 3 + game.values[0]) {
          next.values[0]++;
          next.step = 0;
          next.extra[0]++;
        }
      } else { next.step = 0; next.mistakes++; next.extra[0]++; }
      break;
    }
    case "lantern": {
      const ring = Math.floor(index / 2);
      next.values = turnLanternRings(game.values, ring, index % 2 === 0 ? -1 : 1);
      break;
    }
    case "chapel": next.values = tapCandle(game.values, index); break;
    case "mill": next.values = turnGear(game.values, index); break;
    case "graves": {
      const plot = Math.floor(index / 4), stone = index % 4;
      for (let i = 0; i < 4; i++) if (i !== plot && next.values[i] === stone) next.values[i] = -1;
      next.values[plot] = stone;
      break;
    }
    case "radio": {
      if (index < 4) {
        const axis = index < 2 ? 0 : 1;
        next.values[axis] = clamp(next.values[axis] + (index % 2 === 0 ? -1 : 1), 0, axis === 0 ? 9 : 4);
      } else if (next.values[0] === game.targets[0] && next.values[1] === game.targets[1]) next.step = 1;
      else next.mistakes++;
      break;
    }
    case "silo": {
      if (index === 4) {
        if (game.step === 4) next.step = 5;
        else next.mistakes++;
      } else if (game.targets[game.step] === index) {
        next.values[index] = 1;
        next.step++;
      } else {
        next.mistakes++;
        if (game.step > 0) {
          next.step--;
          next.values[game.targets[next.step]] = 0;
        }
      }
      break;
    }
  }
  return next;
}

export function wardSolved(game: WardPuzzle): boolean {
  if (game.kind === "pumpkins") return game.step === game.targets.length - 7;
  if (game.kind === "well") return game.step === 3;
  if (game.kind === "scarecrow") return game.values[0] === 4;
  if (game.kind === "lantern") return game.values.every((ring) => ring === 0);
  if (game.kind === "chapel") return game.values.every((lit) => lit === 1);
  if (game.kind === "radio") return game.step === 1;
  if (game.kind === "mill" || game.kind === "graves") return game.values.every((v, i) => v === game.targets[i]);
  return game.step === 5; // silo: four bars then the main bolt
}

export function wardProgress(game: WardPuzzle): number {
  if (wardSolved(game)) return 1;
  switch (game.kind) {
    case "pumpkins": return game.step === 0
      ? Math.min(0.34, game.values.filter(Boolean).length * 0.11)
      : 0.35 + ((game.step - 1) / (game.targets.length - 8)) * 0.65;
    case "well": return Math.min(0.96, (game.step + game.values[0] / game.targets[game.step] * 0.65) / 3);
    case "scarecrow": return (game.values[0] + game.step / (3 + game.values[0])) / 4;
    case "lantern": return Math.max(0, 1 - game.values.reduce((sum, value) => sum + Math.min(value, 8 - value), 0) / 12);
    case "chapel": return game.values.filter((lit) => lit === 1).length / 9;
    case "mill": case "graves": return game.values.filter((v, i) => v === game.targets[i]).length / 4;
    case "radio": return Math.max(0, 0.9 - (Math.abs(game.values[0] - game.targets[0]) * 0.12 + Math.abs(game.values[1] - game.targets[1]) * 0.1));
    case "silo": return game.step / 5;
  }
}

export function wardView(stationId: string, name: string, game: WardPuzzle, revealMs = 0): WardGameView {
  return { stationId, name, kind: game.kind, values: [...game.values], targets: [...game.targets], extra: [...game.extra],
    step: game.step, mistakes: game.mistakes, moves: game.moves, progress: wardProgress(game), revealMs };
}
