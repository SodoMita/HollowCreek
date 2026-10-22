// Unbiased randomness — sort(() => Math.random() - 0.5) is NOT a fair shuffle
// (comparator sort biases depend on engine internals). Use crypto-backed
// Fisher–Yates with rejection sampling so every seat is equally likely Hollow.

function cryptoU32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/** Uniform integer in [0, n) without modulo bias. */
export function randInt(n: number): number {
  if (n <= 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x = cryptoU32();
  while (x >= limit) x = cryptoU32();
  return x % n;
}

/** Returns a new, uniformly shuffled array (Fisher–Yates). */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}