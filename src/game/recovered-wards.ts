// Recovered from the Gloamwing ward experiments, adapted to the current
// 1D cart/repair rules. Pure deterministic mechanics: no timers and no claimed
// marker positions from clients. The server owns every move and result.

export type WardRandom = () => number;
const ri = (random: WardRandom, max: number) => Math.floor(random() * max);

/** Gloamwing's Furrow: a seeded, non-repeating neighbouring path. */
export function createFurrow(random: WardRandom, cols = 3, length = 7): number[] {
  const cells = cols * cols;
  let best: number[] = [];
  for (let attempt = 0; attempt < 260 && best.length < length; attempt++) {
    const walk = [ri(random, cells)];
    const seen = new Set(walk);
    while (walk.length < length) {
      const last = walk[walk.length - 1];
      const x = last % cols, y = Math.floor(last / cols);
      const options = [
        [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
      ].filter(([nx, ny]) => nx >= 0 && nx < cols && ny >= 0 && ny < cols)
        .map(([nx, ny]) => ny * cols + nx).filter((cell) => !seen.has(cell));
      if (!options.length) break;
      const next = options[ri(random, options.length)];
      walk.push(next);
      seen.add(next);
    }
    if (walk.length > best.length) best = walk;
  }
  // A known connected path guarantees the fallback is never impossible.
  return best.length === length ? best : [0, 1, 2, 5, 4, 7, 8].slice(0, length);
}

/** Gloamwing's Nine Candles: each tap toggles the wick and its cross neighbours. */
const CROSS: readonly number[][] = [
  [1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7],
  [2, 4, 8], [3, 7], [4, 6, 8], [5, 7],
];
export function tapCandle(candles: number[], cell: number): number[] {
  if (!Number.isInteger(cell) || cell < 0 || cell >= 9) return candles;
  const next = [...candles];
  next[cell] = 1 - next[cell];
  for (const neighbour of CROSS[cell]) next[neighbour] = 1 - next[neighbour];
  return next;
}

/** Exact par: exhaustive search over the 2^9 possible press masks. */
export function candlePar(initial: number[]): number {
  let best = Infinity;
  for (let mask = 0; mask < 512; mask++) {
    let board = initial, moves = 0;
    for (let cell = 0; cell < 9; cell++) if (mask & (1 << cell)) {
      board = tapCandle(board, cell);
      moves++;
    }
    if (board.every((on) => on === 1)) best = Math.min(best, moves);
  }
  return Number.isFinite(best) ? best : -1;
}

export function createNineCandles(random: WardRandom, minPar = 3): { candles: number[]; par: number } {
  for (let attempt = 0; attempt < 60; attempt++) {
    let candles = Array(9).fill(1) as number[];
    const available = Array.from({ length: 9 }, (_, i) => i);
    for (let i = 0; i < 4; i++) candles = tapCandle(candles, available.splice(ri(random, available.length), 1)[0]);
    const par = candlePar(candles);
    if (par >= minPar) return { candles, par };
  }
  // Deterministic fallback (four independent toggles; exact par is checked).
  let candles = Array(9).fill(1) as number[];
  for (const cell of [0, 2, 6, 8]) candles = tapCandle(candles, cell);
  return { candles, par: candlePar(candles) };
}

/** Gloamwing's Crow Call: one six-rune phrase, replayed in growing rounds. */
export function createCrowCall(random: WardRandom): number[] {
  return Array.from({ length: 6 }, () => ri(random, 4));
}

/** Brass rings adapted from Lantern Rites: adjacent bands mesh like gears. */
export function turnLanternRings(rings: number[], ring: number, direction: 1 | -1): number[] {
  if (!Number.isInteger(ring) || ring < 0 || ring >= 3) return rings;
  const next = [...rings];
  next[ring] = (next[ring] + direction + 8) % 8;
  const neighbour = (ring + 1) % 3;
  next[neighbour] = (next[neighbour] - direction + 8) % 8;
  return next;
}

/** Exact shortest ring solution (at most 8³ states; only 64 are reachable). */
export function lanternPar(rings: number[]): number {
  if (rings.every((value) => value === 0)) return 0;
  const queue: { rings: number[]; depth: number }[] = [{ rings, depth: 0 }];
  const seen = new Set([rings.join(",")]);
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (let ring = 0; ring < 3; ring++) for (const direction of [-1, 1] as const) {
      const next = turnLanternRings(node.rings, ring, direction);
      const key = next.join(",");
      if (seen.has(key)) continue;
      if (next.every((value) => value === 0)) return node.depth + 1;
      seen.add(key);
      queue.push({ rings: next, depth: node.depth + 1 });
    }
  }
  return -1;
}

/** A latency-safe Long Draw: discrete bucket positions, server-owned bands. */
export function createLongDrawBands(random: WardRandom): number[] {
  return Array.from({ length: 3 }, () => 6 + 2 * ri(random, 4)); // even 6..12, reachable by crank turns
}
