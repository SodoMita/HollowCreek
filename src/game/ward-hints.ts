// Opt-in nudges for the repair workbenches. Pure functions of the *visible*
// board: a hint never changes server state, never spends vigor and never
// submits a move. Level 0 explains the rule, level 1 reads the board back,
// level 2 names the next concrete action so a confused player is never stuck.
import type { WardGameView } from "./wards";

const STONES = ["ALDER", "BELL", "CROW", "DOVE"] as const;
const BARS = ["UPPER", "LEFT", "LOWER", "RIGHT"] as const;
const CALLS = ["⌁", "✦", "☾", "◈"] as const;
const BANDS = ["wick band", "glass cage", "copper cap"] as const;
const VENTS = ["left draft", "chimney", "right draft"] as const;
const GEARS = ["driver", "transfer", "flywheel", "blade"] as const;
const JARS = ["apple", "pear", "plum", "cherry"] as const;
const CROSS: readonly number[][] = [
  [1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7],
  [2, 4, 8], [3, 7], [4, 6, 8], [5, 7],
];
const clampLevel = (level: number) => Math.max(0, Math.min(2, Math.trunc(level)));
const roman = ["I", "II", "III", "IV"] as const;
const timeOf = (hours: number, quarters: number) =>
  `${String(hours + 1).padStart(2, "0")}:${String(quarters * 15).padStart(2, "0")}`;

/** A first move that leads to a solved board, or null when none is found. */
function lanternOpening(values: number[]): string | null {
  const turn = (state: number[], ring: number, dir: number) => {
    const next = [...state];
    next[ring] = (next[ring] + dir + 8) % 8;
    for (const [a, b] of [[0, 1], [1, 2]] as const) {
      if (ring === a) next[b] = (next[b] - dir + 8) % 8;
      if (ring === b) next[a] = (next[a] - dir + 8) % 8;
    }
    return next;
  };
  const seen = new Set([values.join(",")]);
  const queue: { state: number[]; first: string }[] = [];
  for (let ring = 0; ring < 3; ring++) for (const dir of [-1, 1]) {
    const state = turn(values, ring, dir);
    queue.push({ state, first: `Turn the ${BANDS[ring]} ${dir < 0 ? "left" : "right"}.` });
  }
  for (let head = 0; head < queue.length && head < 400; head++) {
    const item = queue[head];
    if (item.state.every((v) => v === 0)) return item.first;
    for (let ring = 0; ring < 3; ring++) for (const dir of [-1, 1]) {
      const state = turn(item.state, ring, dir);
      const key = state.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ state, first: item.first });
    }
  }
  return null;
}

/** The tap that reduces Nine Candles; brute force over 2^9 masks is instant. */
function candleOpening(values: number[]): number | null {
  const tap = (board: number[], cell: number) => {
    const next = [...board];
    next[cell] = 1 - next[cell];
    for (const neighbor of CROSS[cell]) next[neighbor] = 1 - next[neighbor];
    return next;
  };
  const solved = (board: number[]) => board.every((v) => v === 1);
  let best: { cell: number; cost: number } | null = null;
  for (let cell = 0; cell < 9; cell++) {
    const start = tap(values, cell);
    let cost = Infinity;
    for (let mask = 0; mask < 512; mask++) {
      let board = start, taps = 1;
      for (let i = 0; i < 9; i++) if (mask & (1 << i)) { board = tap(board, i); taps++; }
      if (solved(board)) cost = Math.min(cost, taps);
    }
    if (cost < Infinity && (!best || cost < best.cost)) best = { cell, cost };
  }
  return best ? best.cell : null;
}

function fuseOpening(values: number[]): number | null {
  const toggle = (board: number[], i: number) => board.map((v, j) => (Math.abs(j - i) <= 1 ? 1 - v : v));
  const candidates = values.map((_, i) => ({ i, lit: toggle(values, i).filter(Boolean).length }));
  candidates.sort((a, b) => b.lit - a.lit);
  return candidates.length && candidates[0].lit > values.filter(Boolean).length ? candidates[0].i : null;
}

function pumpkinBeams(targets: number[]): number[] | null {
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
    if ([a, b, c].includes(targets[7])) continue;
    if (targets[a] + targets[b] + targets[c] === targets[6]) return [a, b, c];
  }
  return null;
}

/** Next gear turn that strictly reduces the distance to the notches. */
function gearOpening(values: number[], targets: number[]): number | null {
  const turn = (state: number[], i: number) => state.map((v, j) => {
    if (j === i) return (v + 1) % 4;
    if (j === i - 1 || j === i + 1) return (v + 3) % 4;
    return v;
  });
  const miss = (state: number[]) => state.reduce((sum, v, i) => sum + ((v - targets[i] + 4) % 4), 0);
  let best: { i: number; miss: number } | null = null;
  for (let i = 0; i < values.length; i++) {
    const score = miss(turn(values, i));
    if (!best || score < best.miss) best = { i, miss: score };
  }
  return best && best.miss < miss(values) ? best.i : null;
}

/** One adjacent swap that takes the preserves closer to harvest order. */
function pantrySwap(values: number[]): number | null {
  for (let i = 0; i < values.length - 1; i++) if (values[i] > values[i + 1]) return i;
  return null;
}

export function wardHint(view: WardGameView, level = 0): string {
  if (view.progress >= 1) return "This ward is whole. Nothing left to nudge.";
  const step = clampLevel(level);
  const v = view.values, t = view.targets;
  switch (view.kind) {
    case "pumpkins": {
      if (view.step === 0) {
        const chosen = v.reduce<number[]>((all, on, i) => (on ? [...all, i] : all), []);
        const span = chosen.reduce((sum, i) => sum + t[i], 0);
        if (step === 0) return `The roof gap is ${t[6]} ft and only sound beams bear weight. Pick exactly three.`;
        if (step === 1) return `Braced ${span} ft with ${chosen.length}/3 beams${t[7] >= 0 ? `; beam ${t[7] + 1} is splintered` : ""}.`;
        const beams = pumpkinBeams(t);
        return beams ? `Sound sets: try beams ${beams.map((i) => i + 1).join(", ")}.` : "No three sound beams fit — take the splintered one out.";
      }
      const path = t.slice(8);
      const next = path[Math.min(view.step - 1, path.length - 1)];
      if (step === 0) return "The furrow must follow touching ditch cells from ◎ to outlet; a wrong turn only refills the path.";
      if (step === 1) return `The next cut must touch your last one. ${view.step - 1}/${path.length} cells cut.`;
      return `Cut row ${Math.floor(next / 3) + 1}, column ${(next % 3) + 1}.`;
    }
    case "well": {
      const band = t[Math.min(view.step, 2)];
      const position = v[0], tension = v[1];
      if (step === 0) return "Crank while the rope is slack, ease tension, and only set the ratchet when the bucket sits in the pale band.";
      if (step === 1) return `Catch ${view.step + 1}/3: band ${band - 1}–${band + 1}, bucket at ${position}/14, rope ${tension}/4.`;
      if (position < band - 1) return "Crank the bucket up one more notch.";
      if (position > band + 1) return "Let the bucket back down a notch.";
      if (tension > 2) return "Ease the rope before it slips; two pulls is enough.";
      return "Set the ratchet — the bucket is inside the band.";
    }
    case "scarecrow": {
      const length = 3 + v[0];
      const phases = ["", "Watch once more if you need it; a replay costs vigor.", "Repeat every call in order; a miss only replays this round."];
      if (step === 0) return "Watch the stitched calls, then repeat them in order. A replay is allowed but costs vigor.";
      if (step === 1) return `Round ${v[0] + 1}/4 · ${length} calls · ${view.step} matched${phases[1] ? "" : ""}.`;
      return `Next call is ${CALLS[t[Math.min(view.step, length - 1)]]}.`;
    }
    case "lantern": {
      if (step === 0) return "Bring the bright star ✦ to the top of every band. Turning one band counter-turns its neighbour.";
      if (step === 1) return `Band faces: ${v.map((face, i) => `${BANDS[i]} ${face}`).join(", ")} (top is 0).`;
      return lanternOpening(v) ?? "Keep turning; every face can reach the top.";
    }
    case "chapel": {
      const lit = v.filter(Boolean).length;
      if (step === 0) return "Each candle you touch changes itself and its cross-neighbours. Plan pairs instead of singles.";
      if (step === 1) return `${lit}/9 burning · the shortest repair from the start took ${view.extra[0] ?? "a few"} taps.`;
      const cell = candleOpening(v);
      return cell === null ? "The board has no solution from here; leave and re-open the ward." : `Tap row ${Math.floor(cell / 3) + 1}, column ${(cell % 3) + 1}.`;
    }
    case "mill": {
      if (step === 0) return "Every gear carries a stamped notch. Turning one gear turns its neighbours the other way.";
      if (step === 1) return `Not at notch: ${v.reduce<string[]>((all, angle, i) => (angle === t[i] ? all : [...all, GEARS[i]]), []).join(", ") || "none"}.`;
      const gear = gearOpening(v, t);
      return gear === null ? "Turn any gear to break the deadlock." : `Turn the ${GEARS[gear]} gear.`;
    }
    case "graves": {
      if (step === 0) return "The ledger determines every plot. No stone has two homes — placing one frees it from another plot.";
      if (step === 1) return "Plot I is named outright; the west-of chain gives the rest from west to east.";
      const plot = v.findIndex((stone, i) => stone !== t[i]);
      return plot < 0 ? "Every name-stone is home." : `Plot ${roman[plot]} takes the ${STONES[t[plot]]} marker.`;
    }
    case "radio": {
      if (step === 0) return "Both dials must match the broadcaster; watch the meter, not the numbers.";
      if (step === 1) return `Frequency is ${v[0] < t[0] ? "too low" : v[0] > t[0] ? "too high" : "on station"} · antenna is ${v[1] < t[1] ? "too short" : v[1] > t[1] ? "too long" : "right"}.`;
      return `Set frequency ${t[0]} and antenna ${t[1]}, then lock.`;
    }
    case "silo": {
      if (step === 0) return "The three chalk rules form a chain: a bar that never has to come after another goes first.";
      if (step === 1) return `${v.filter(Boolean).length}/4 bars seated · one wrong bar springs the last brace loose.`;
      return `Seat the ${BARS[t[Math.min(view.step, 3)]].toLowerCase()} bar next.`;
    }
    case "hearth": {
      const wrong = v.reduce<number[]>((all, value, i) => (value === t[i] ? all : [...all, i]), []);
      if (step === 0) return "Turn each damper until its number meets the chalk mark; striking early only blackens the grate.";
      if (step === 1) return wrong.length ? `Still off: ${wrong.map((i) => VENTS[i]).join(", ")}.` : "All three marks line up — strike the hearth.";
      return wrong.length ? `Set the ${VENTS[wrong[0]]} to ${t[wrong[0]]}.` : "All three marks line up — strike the hearth.";
    }
    case "pantry": {
      if (step === 0) return "The keeper's order is apple → pear → plum → cherry. Only neighbouring jars can swap.";
      if (step === 1) return `Shelf reads ${v.map((j) => JARS[j]).join(", ")}.`;
      const swap = pantrySwap(v);
      return swap === null ? "The shelf is in harvest order." : `Swap jars ${swap + 1} and ${swap + 2}.`;
    }
    case "clock": {
      const hours = (t[0] - v[0] + 12) % 12;
      const quarters = (t[1] - v[1] + 4) % 4;
      if (step === 0) return "The note gives the time; the hands move independently. Wind only when both agree.";
      if (step === 1) return `Hour hand ${hours === 0 ? "is set" : `${hours} step${hours === 1 ? "" : "s"} off`} · quarter hand ${quarters === 0 ? "is set" : `${quarters} step${quarters === 1 ? "" : "s"} off`}.`;
      return `Set the clock to ${timeOf(t[0], t[1])}, then wind it.`;
    }
    case "fusebox": {
      const open = v.filter((on) => !on).length;
      if (step === 0) return "Each switch flips itself and its neighbours; start at an end of the row, never the middle.";
      if (step === 1) return `${open} circuit${open === 1 ? "" : "s"} still open.`;
      const fuse = fuseOpening(v);
      return fuse === null ? "Flip a switch to break the deadlock." : `Flip fuse ${fuse + 1}.`;
    }
  }
  return "Keep working the ward; the board is the only clue you need.";
}

/** Levels a player can cycle through, for labels in the UI. */
export const HINT_LABELS = ["rule", "board", "next move"] as const;
