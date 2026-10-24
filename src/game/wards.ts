// Physical repair games for the nine structures on Hollow Creek's street.
// All moves are turn-based and checked on the server. No time window, claimed
// solution, client position, or arbitrary progress value enters this module.

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
}

/** Titles are the repair jobs, not generic symbols pasted over unrelated props. */
export const WARD_JOBS: Record<WardKind, { title: string; instruction: string }> = {
  pumpkins: { title: "Roof Truss", instruction: "Choose three sound beams whose lengths span the shed's gap. Avoid splintered timber, then fasten the brace." },
  well: { title: "Rope & Ratchet", instruction: "Crank the bucket up, but ease the rope before tension slips. Once raised, lock the ratchet while the line is safe." },
  scarecrow: { title: "Seam Stitch", instruction: "Follow the torn seam from its first stitch to its last. Work along neighbouring holes; a missed hole loosens one stitch." },
  lantern: { title: "Wick & Draft", instruction: "Raise the wick and adjust the vent. Read the flame and smoke before you strike the match; a bad light soots the glass." },
  chapel: { title: "Stained Glass", instruction: "Turn the four loose panes until their lead lines join at the centre. Moving a pane pulls its neighbours in the frame." },
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

function rotatePane(values: number[], i: number): number[] {
  const next = [...values];
  next[i] = mod4(next[i] + 1);
  next[i ^ 1] = mod4(next[i ^ 1] - 1); // the lead strip beside it pulls back
  next[i ^ 2] = mod4(next[i ^ 2] + 1); // vertical brace turns with it
  return next;
}

function turnGear(values: number[], i: number): number[] {
  const next = [...values];
  next[i] = mod4(next[i] + 1);
  if (i > 0) next[i - 1] = mod4(next[i - 1] - 1);
  if (i < 3) next[i + 1] = mod4(next[i + 1] - 1);
  return next;
}

const SEAMS: number[][] = [
  [0, 1, 5, 6, 10, 11, 15],
  [0, 4, 5, 9, 10, 14, 15],
  [3, 2, 6, 5, 9, 8, 12],
  [12, 13, 9, 10, 6, 7, 3],
];

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
    return { ...base, values: Array(6).fill(0), targets: [...lengths, span, splinter], extra: [] };
  }
  if (kind === "well") {
    return { ...base, values: [0, 1, 0], targets: [4 + Math.floor(rand() * 2)], extra: [] };
  }
  if (kind === "scarecrow") {
    return { ...base, values: [], targets: SEAMS[Math.floor(rand() * SEAMS.length)], extra: [] };
  }
  if (kind === "lantern") {
    const targets = [2 + Math.floor(rand() * 4), 2 + Math.floor(rand() * 4)];
    return { ...base, values: [Math.floor(rand() * 3), 5 + Math.floor(rand() * 2)], targets, extra: [] };
  }
  if (kind === "chapel" || kind === "mill") {
    const targets = kind === "chapel" ? [0, 1, 2, 3] : [0, 2, 0, 2];
    let values = [...targets];
    for (let k = 0; k < 3; k++) values = kind === "chapel"
      ? rotatePane(values, Math.floor(rand() * 4))
      : turnGear(values, Math.floor(rand() * 4));
    if (values.every((v, i) => v === targets[i]))
      values = kind === "chapel" ? rotatePane(values, 0) : turnGear(values, 0);
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
    pumpkins: 7, well: 3, scarecrow: 16, lantern: 5, chapel: 4,
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
      if (index < 6) next.values[index] = 1 - next.values[index];
      else {
        const chosen = next.values.map((v, i) => v ? i : -1).filter((i) => i >= 0);
        const length = chosen.reduce((sum, i) => sum + game.targets[i], 0);
        if (chosen.length === 3 && !chosen.includes(game.targets[7]) && length === game.targets[6]) next.step = 1;
        else next.mistakes++;
      }
      break;
    }
    case "well": {
      const [height, tension, slips] = game.values;
      if (index === 0) {
        if (tension >= 3) { next.values = [Math.max(0, height - 1), 1, slips + 1]; next.mistakes++; }
        else next.values = [Math.min(game.targets[0], height + 1), tension + 1, slips];
      } else if (index === 1) next.values[1] = Math.max(1, tension - 1);
      else if (height >= game.targets[0] && tension <= 2) next.step = 1;
      else { next.values = [Math.max(0, height - 1), 1, slips + 1]; next.mistakes++; }
      break;
    }
    case "scarecrow": {
      if (game.targets[game.step] === index) next.step++;
      else { next.step = Math.max(0, game.step - 1); next.mistakes++; }
      break;
    }
    case "lantern": {
      if (index < 4) {
        const axis = index < 2 ? 0 : 1;
        next.values[axis] = clamp(next.values[axis] + (index % 2 === 0 ? -1 : 1), 0, 6);
      } else if (next.values[0] === game.targets[0] && next.values[1] === game.targets[1]) next.step = 1;
      else { next.mistakes++; next.values[0] = Math.max(0, next.values[0] - 1); }
      break;
    }
    case "chapel": next.values = rotatePane(game.values, index); break;
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
  if (["pumpkins", "well", "lantern", "radio"].includes(game.kind)) return game.step === 1;
  if (game.kind === "scarecrow") return game.step === game.targets.length;
  if (game.kind === "chapel" || game.kind === "mill") return game.values.every((v, i) => v === game.targets[i]);
  if (game.kind === "graves") return game.values.every((v, i) => v === game.targets[i]);
  return game.step === 5; // silo: four bars then the main bolt
}

export function wardProgress(game: WardPuzzle): number {
  if (wardSolved(game)) return 1;
  switch (game.kind) {
    case "pumpkins": return Math.min(0.85, game.values.filter(Boolean).length / 4);
    case "well": return game.values[0] / game.targets[0] * 0.85;
    case "scarecrow": return game.step / game.targets.length;
    case "lantern": return Math.max(0, 0.8 - (Math.abs(game.values[0] - game.targets[0]) + Math.abs(game.values[1] - game.targets[1])) * 0.09);
    case "chapel": case "mill": return game.values.filter((v, i) => v === game.targets[i]).length / 4;
    case "graves": return game.values.filter((v, i) => v === game.targets[i]).length / 4;
    case "radio": return Math.max(0, 0.9 - (Math.abs(game.values[0] - game.targets[0]) * 0.12 + Math.abs(game.values[1] - game.targets[1]) * 0.1));
    case "silo": return game.step / 5;
  }
}

export function wardView(stationId: string, name: string, game: WardPuzzle): WardGameView {
  return { stationId, name, kind: game.kind, values: [...game.values], targets: [...game.targets], extra: [...game.extra],
    step: game.step, mistakes: game.mistakes, moves: game.moves, progress: wardProgress(game) };
}
