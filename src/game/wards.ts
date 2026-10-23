// WARD GAMES — replaces hold-to-work with real minigames.
//
// Framework-agnostic: no DOM, no React, no imports from the server or client.
// Designed so the authoritative engine can VALIDATE a ward rather than trust it:
//
//   1. engine issues a challenge:  createChallenge(kind, seed)
//      The seed is server-side (use src/game/rng.ts). The client can rebuild the
//      exact same board from (kind, seed) — nothing secret is sent down the wire.
//   2. client plays it locally and submits the move list as intent
//      (action "ward", ward: id, moves: Move[]) — positions are never sent.
//   3. engine replays:  validateSolution(kind, seed, moves) -> { ok, moves }
//      A hacked client cannot claim a ward it did not play, and cannot skip the
//      work: the replay is the same pure function the client used.
//
// Drop-in points:
//   src/game/engine.ts   — replace TASK_HOLD_MS progress with challenge + validate
//   src/game/types.ts    — add `action: "ward"`, `moves`, `self.ward` to InputBody/Snapshot
//   GameClient.tsx / static-src/main.ts — render the five boards (see FIRSTNIGHT.md)

export type WardGameKind = "align" | "timing" | "lights" | "sequence" | "trace";

/** Every station kind on the 2D valley map gets a game. 14 wards, 5 mechanics. */
export const WARD_GAME_BY_STATION: Record<string, WardGameKind> = {
  lantern: "align",
  gate: "align",
  silo: "align",
  well: "timing",
  woodpile: "timing",
  mill: "timing",
  chapel: "lights",
  graves: "lights",
  laundry: "lights",
  scarecrow: "sequence",
  radio: "sequence",
  beehive: "sequence",
  pumpkins: "trace",
  bridge: "trace",
};

export function gameForStation(kind: string): WardGameKind {
  return WARD_GAME_BY_STATION[kind] ?? "timing";
}

/* ------------------------------------------------------------------ */
/* deterministic PRNG — challenge is reproducible from (kind, seed)    */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ri = (rnd: () => number, n: number) => Math.floor(rnd() * n);

/* ------------------------------------------------------------------ */
/* Move — the only thing a client ever sends                           */
/* ------------------------------------------------------------------ */

export type Move =
  | { t: "turn"; ring: number; dir: 1 | -1 }   // align
  | { t: "catch"; at: number }                  // timing: 0..100 marker position
  | { t: "tap"; cell: number }                  // lights
  | { t: "call"; rune: number }                 // sequence
  | { t: "step"; cell: number };                // trace: ordered path cells

/* ------------------------------------------------------------------ */
/* ALIGN — three (or more) rings, bring every notch to the wick        */
/* ------------------------------------------------------------------ */

export interface AlignChallenge {
  faces: number;          // ring is cut into this many faces (8 default)
  rings: number[];        // starting offsets, 0 = aligned
  target: number;         // face index that must sit under the wick (always 0)
}

export const RING_GLYPHS = ["✦", "☾", "◈", "✧", "◉", "❖", "☉", "⌁"];

export function createAlign(seed: number, rings = 3, faces = 8): AlignChallenge {
  const rnd = mulberry32(seed);
  const offsets: number[] = [];
  for (let i = 0; i < rings; i += 1) {
    // never start solved; never start one turn away on every ring
    offsets.push(1 + ri(rnd, faces - 1));
  }
  // avoid a single-turn solve on every ring (written without .every() so TS 5.5's
  // inferred type predicates cannot narrow number[] to 1[] mid-expression)
  const allOneTurn = offsets.reduce((sum, o) => sum + (o === 1 ? 1 : 0), 0) === offsets.length;
  if (allOneTurn) offsets[offsets.length - 1] = 2 + ri(rnd, faces - 3);
  return { faces, rings: offsets, target: 0 };
}

export function applyAlign(state: AlignChallenge, move: Move): AlignChallenge {
  if (move.t !== "turn") return state;
  if (move.ring < 0 || move.ring >= state.rings.length) return state;
  const rings = [...state.rings];
  rings[move.ring] = (rings[move.ring] + move.dir + state.faces) % state.faces;
  return { ...state, rings };
}

/** Shortest number of turns still owed — used for hints and for the HUD. */
export function alignRemaining(state: AlignChallenge): number {
  return state.rings.reduce((sum, offset) => {
    const cw = offset % state.faces;
    return sum + Math.min(cw, state.faces - cw);
  }, 0);
}

export function isAlignSolved(state: AlignChallenge): boolean {
  return state.rings.every((offset) => offset === state.target);
}

/* ------------------------------------------------------------------ */
/* TIMING — a marker sweeps 0..100; land it inside the pale band N times */
/* ------------------------------------------------------------------ */

export interface TimingChallenge {
  needed: number;      // catches required (3)
  misses: number;      // misses allowed before reset (4)
  bands: number[];     // per-catch band CENTRE, 0..100
  widths: number[];    // per-catch band WIDTH, shrinks as you succeed
  step: number;        // marker travel per tick, 0..100 units
  tickMs: number;
}

export function createTiming(seed: number, level = 0): TimingChallenge {
  const rnd = mulberry32(seed);
  const needed = 3;
  const bands: number[] = [];
  const widths: number[] = [];
  for (let i = 0; i < needed; i += 1) {
    bands.push(18 + ri(rnd, 64));
    widths.push(Math.max(8, 20 - i * 3 - level));
  }
  return { needed, misses: 4, bands, widths, step: 1.9 + level * 0.25, tickMs: 34 };
}

export interface TimingState {
  caught: number;
  missed: number;
  failed: boolean;
}

export function startTiming(): TimingState {
  return { caught: 0, missed: 0, failed: false };
}

export function applyTiming(challenge: TimingChallenge, state: TimingState, move: Move): TimingState {
  if (move.t !== "catch" || state.failed || state.caught >= challenge.needed) return state;
  const band = challenge.bands[state.caught];
  const half = challenge.widths[state.caught] / 2;
  if (Math.abs(move.at - band) <= half) {
    const caught = state.caught + 1;
    return { caught, missed: state.missed, failed: false };
  }
  const missed = state.missed + 1;
  return { caught: state.caught, missed, failed: missed >= challenge.misses };
}

/** True only when the marker is genuinely inside the band — clients use this for
 *  the affordance, the server uses the replay instead. */
export function timingInBand(challenge: TimingChallenge, state: TimingState, at: number): boolean {
  if (state.caught >= challenge.needed) return false;
  const half = challenge.widths[state.caught] / 2;
  return Math.abs(at - challenge.bands[state.caught]) <= half;
}

export function isTimingSolved(challenge: TimingChallenge, state: TimingState): boolean {
  return !state.failed && state.caught >= challenge.needed;
}

/* ------------------------------------------------------------------ */
/* LIGHTS — Lights Out on a 3x3 cross-neighbour board                  */
/* ------------------------------------------------------------------ */

/** Tapping a candle flips itself plus its cross neighbours. */
export const LIGHTS_CROSS: readonly number[][] = [
  [1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7],
];

export interface LightsChallenge {
  board: boolean[];   // true = lit; the goal is all lit
}

export function createLights(seed: number, changes = 4): LightsChallenge {
  const rnd = mulberry32(seed);
  let board = Array.from({ length: 9 }, () => true);
  for (let i = 0; i < changes; i += 1) board = applyLightsBoard(board, ri(rnd, 9));
  if (board.every(Boolean)) board = applyLightsBoard(board, 4);
  return { board };
}

export function applyLightsBoard(board: boolean[], cell: number): boolean[] {
  const next = [...board];
  next[cell] = !next[cell];
  for (const neighbour of LIGHTS_CROSS[cell]) next[neighbour] = !next[neighbour];
  return next;
}

export function applyLights(state: LightsChallenge, move: Move): LightsChallenge {
  if (move.t !== "tap" || move.cell < 0 || move.cell > 8) return state;
  return { board: applyLightsBoard(state.board, move.cell) };
}

export function isLightsSolved(state: LightsChallenge): boolean {
  return state.board.every(Boolean);
}

/** Exact minimum taps, by exhaustive search over the 2^9 press masks.
 *  Used to reject "solved in 1 tap" cheats and to grade the player. */
export function lightsPar(challenge: LightsChallenge): number {
  let best = Infinity;
  for (let mask = 0; mask < 512; mask += 1) {
    let board = [...challenge.board];
    let taps = 0;
    for (let cell = 0; cell < 9; cell += 1) {
      if (mask & (1 << cell)) {
        board = applyLightsBoard(board, cell);
        taps += 1;
      }
    }
    if (board.every(Boolean) && taps < best) best = taps;
  }
  return best === Infinity ? -1 : best;
}

/* ------------------------------------------------------------------ */
/* SEQUENCE — watch the runes, give them back (Simon, 4 runes)         */
/* ------------------------------------------------------------------ */

export interface SequenceChallenge {
  rounds: number[];       // number of runes per round, e.g. [3,4,5,6]
  calls: number[][];      // the actual rune ids, derived from the seed
  runes: number;          // distinct runes (4)
}

export function createSequence(seed: number, rounds = [3, 4, 5, 6], runes = 4): SequenceChallenge {
  const rnd = mulberry32(seed);
  const calls = rounds.map((length) => Array.from({ length }, () => ri(rnd, runes)));
  return { rounds, calls, runes };
}

export interface SequenceState {
  round: number;
  progress: number;
  strikes: number;
  failed: boolean;
}

export function startSequence(): SequenceState {
  return { round: 0, progress: 0, strikes: 0, failed: false };
}

export function applySequence(challenge: SequenceChallenge, state: SequenceState, move: Move): SequenceState {
  if (move.t !== "call" || state.failed) return state;
  const call = challenge.calls[state.round];
  if (!call) return state;
  if (call[state.progress] === move.rune) {
    if (state.progress + 1 >= call.length) {
      const round = state.round + 1;
      if (round >= challenge.rounds.length) {
        return { round, progress: 0, strikes: state.strikes, failed: false };
      }
      return { round, progress: 0, strikes: state.strikes, failed: false };
    }
    return { ...state, progress: state.progress + 1 };
  }
  const strikes = state.strikes + 1;
  // a wrong call restarts the round; three strikes fail the ward
  return { round: state.round, progress: 0, strikes, failed: strikes >= 3 };
}

export function isSequenceSolved(challenge: SequenceChallenge, state: SequenceState): boolean {
  return !state.failed && state.round >= challenge.rounds.length;
}

/* ------------------------------------------------------------------ */
/* TRACE — walk an ordered path over the board (pumpkins, bridge)      */
/* ------------------------------------------------------------------ */

export interface TraceChallenge {
  cells: number;         // grid cells, 3x3 = 9
  cols: number;
  rows: number;
  path: number[];        // the order the cells must be visited
  start: number;         // cell the player begins on (always path[0])
}

export function createTrace(seed: number, cols = 3, length = 6): TraceChallenge {
  const rnd = mulberry32(seed);
  const cells = cols * cols;
  const rows = cols;
  const index = (x: number, y: number) => y * cols + x;
  const at = (cell: number) => ({ x: cell % cols, y: Math.floor(cell / cols) });
  let best: number[] = [];
  // random walk without revisits; retry until it reaches the wanted length
  for (let attempt = 0; attempt < 240 && best.length < length; attempt += 1) {
    const start = ri(rnd, cells);
    const walk = [start];
    const seen = new Set([start]);
    for (let step = 1; step < length; step += 1) {
      const { x, y } = at(walk[walk.length - 1]);
      const options = [
        { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
      ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < cols && n.y < rows && !seen.has(index(n.x, n.y)));
      if (options.length === 0) break;
      const next = options[ri(rnd, options.length)];
      const cell = index(next.x, next.y);
      walk.push(cell);
      seen.add(cell);
    }
    if (walk.length > best.length) best = walk;
  }
  if (best.length < length) {
    best = Array.from({ length }, (_, i) => i % cells);
  }
  return { cells, cols, rows, path: best, start: best[0] };
}

export interface TraceState {
  progress: number;
  failed: boolean;
}

export function startTrace(): TraceState {
  return { progress: 1, failed: false };
}

export function applyTrace(challenge: TraceChallenge, state: TraceState, move: Move): TraceState {
  if (move.t !== "step" || state.failed) return state;
  if (challenge.path[state.progress] === move.cell) {
    return { progress: state.progress + 1, failed: false };
  }
  // a wrong step sends you back to the start of the path, not out of the ward
  return { progress: 1, failed: false };
}

export function isTraceSolved(challenge: TraceChallenge, state: TraceState): boolean {
  return !state.failed && state.progress >= challenge.path.length;
}

/* ------------------------------------------------------------------ */
/* One entry point for the engine                                      */
/* ------------------------------------------------------------------ */

export interface WardChallenge {
  kind: WardGameKind;
  seed: number;
  align?: AlignChallenge;
  timing?: TimingChallenge;
  lights?: LightsChallenge;
  sequence?: SequenceChallenge;
  trace?: TraceChallenge;
}

export function createChallenge(stationKind: string, seed: number, level = 0): WardChallenge {
  const kind = gameForStation(stationKind);
  const challenge: WardChallenge = { kind, seed };
  if (kind === "align") challenge.align = createAlign(seed, 3 + Math.min(1, level), 8);
  if (kind === "timing") challenge.timing = createTiming(seed, level);
  if (kind === "lights") challenge.lights = createLights(seed, 4 + Math.min(2, level));
  if (kind === "sequence") challenge.sequence = createSequence(seed);
  if (kind === "trace") challenge.trace = createTrace(seed, 3, 6 + Math.min(2, level));
  return challenge;
}

export interface WardResult {
  ok: boolean;
  moves: number;
  reason?: string;
}

/**
 * Replay a submitted move list against the server-generated challenge.
 * This is the authoritative check — call it from applyInput, never the client's
 * own claim. Cheap: every game is at most a few hundred moves.
 */
export function validateSolution(challenge: WardChallenge, moves: Move[]): WardResult {
  if (!Array.isArray(moves) || moves.length === 0) return { ok: false, moves: 0, reason: "no work done" };
  if (moves.length > 600) return { ok: false, moves: moves.length, reason: "too many moves" };

  if (challenge.kind === "align" && challenge.align) {
    let state = challenge.align;
    for (const move of moves) state = applyAlign(state, move);
    return { ok: isAlignSolved(state), moves: moves.length, reason: isAlignSolved(state) ? undefined : "rings not aligned" };
  }
  if (challenge.kind === "timing" && challenge.timing) {
    let state = startTiming();
    for (const move of moves) {
      if (move.t === "catch" && (move.at < 0 || move.at > 100)) {
        return { ok: false, moves: moves.length, reason: "marker out of range" };
      }
      state = applyTiming(challenge.timing, state, move);
    }
    return { ok: isTimingSolved(challenge.timing, state), moves: moves.length, reason: state.failed ? "rope slipped" : undefined };
  }
  if (challenge.kind === "lights" && challenge.lights) {
    let state = challenge.lights;
    for (const move of moves) state = applyLights(state, move);
    return { ok: isLightsSolved(state), moves: moves.length, reason: isLightsSolved(state) ? undefined : "candles not all lit" };
  }
  if (challenge.kind === "sequence" && challenge.sequence) {
    let state = startSequence();
    for (const move of moves) state = applySequence(challenge.sequence, state, move);
    return { ok: isSequenceSolved(challenge.sequence, state), moves: moves.length, reason: state.failed ? "crows gave up" : undefined };
  }
  if (challenge.kind === "trace" && challenge.trace) {
    let state = startTrace();
    for (const move of moves) state = applyTrace(challenge.trace, state, move);
    return { ok: isTraceSolved(challenge.trace, state), moves: moves.length, reason: isTraceSolved(challenge.trace, state) ? undefined : "path unfinished" };
  }
  return { ok: false, moves: moves.length, reason: "unknown ward" };
}

/* ------------------------------------------------------------------ */
/* Vigor — keeps the canonical rule: work drains, tired hands are slower */
/* ------------------------------------------------------------------ */

/**
 * Vigor cost of finishing a ward. Scales gently with the work actually done so
 * a player cannot cheese a cheap ward by mashing: the engine should divide the
 * real drain (STAMINA_WORK_DRAIN * seconds spent) by this and take the larger.
 */
export function vigorCost(kind: WardGameKind, moves: number): number {
  const base: Record<WardGameKind, number> = {
    align: 0.16,
    timing: 0.2,
    lights: 0.18,
    sequence: 0.22,
    trace: 0.14,
  };
  return Math.min(0.45, base[kind] + moves * 0.0009);
}

/** Client-facing copy for each mechanic. Keep it in the game's voice. */
export const WARD_COPY: Record<WardGameKind, { game: string; how: string; flavour: string }> = {
  align: {
    game: "Lantern Rites",
    how: "Turn each brass band until its bright sigil sits under the wick.",
    flavour: "The wick remembers being lit. Persuade it.",
  },
  timing: {
    game: "The Long Draw",
    how: "Catch the bucket inside the pale band three times. Four slips and the crank resets.",
    flavour: "The rope is older than the town and twice as stubborn.",
  },
  lights: {
    game: "Nine Candles",
    how: "Each wick you touch changes itself and its cross neighbours. Light all nine at once.",
    flavour: "The altar has a contrary draught and no patience for guessing.",
  },
  sequence: {
    game: "Crow Call",
    how: "Watch the runes the crows light, then give them back in order. Four rounds.",
    flavour: "They have learned the scarecrow's old name. So can you.",
  },
  trace: {
    game: "The Furrow",
    how: "Follow the path the work wants taken, in order, without lifting your hands.",
    flavour: "Every harvest has a shape. Walk it and the shape holds.",
  },
};
