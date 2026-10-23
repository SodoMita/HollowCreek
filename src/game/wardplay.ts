// Ward play — the small games that stand between the town and dawn.
//
// Pure and deterministic from a seed: the ENGINE owns the session and scores it,
// the client draws the identical board and only ever sends intent ("strike",
// "tap"). A modified client can neither fake a ward nor skip the work — it can
// only play the same board faster.

export type PlayKind = "strike" | "sequence";

export interface WardBoard {
  kind: PlayKind;
  seed: number;
  /** strikes needed to finish (strike) */
  need: number;
  /** full sweeps of the marker per second */
  speed: number;
  /** half width of the target band, in track units */
  half: number;
  spin: 1 | -1;
  /** the order to repeat (sequence) */
  seq: number[];
}

const mul32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SEQUENCE_KINDS = new Set(["chapel", "graves", "laundry", "radio", "beehive", "scarecrow"]);

/** Which game a ward plays. The rest of the valley is struck, not recited. */
export function playKindFor(stationKind: string): PlayKind {
  return SEQUENCE_KINDS.has(stationKind) ? "sequence" : "strike";
}

export function makeBoard(stationKind: string, seed: number): WardBoard {
  const r = mul32(seed ^ 0x9e3779b9);
  const kind = playKindFor(stationKind);
  if (kind === "sequence") {
    const len = 4 + Math.floor(r() * 3); // 4..6
    return {
      kind,
      seed,
      need: len,
      speed: 0,
      half: 0,
      spin: 1,
      seq: Array.from({ length: len }, () => Math.floor(r() * 4)),
    };
  }
  return {
    kind,
    seed,
    need: 3 + Math.floor(r() * 2), // 3..4 strikes
    speed: 0.42 + r() * 0.34,
    half: 0.115 - r() * 0.035,
    spin: r() > 0.5 ? 1 : -1,
    seq: [],
  };
}

/** Marker position along the track, 0..1. `elapsed` is in seconds. */
export function markerAt(b: WardBoard, elapsed: number): number {
  const p = (elapsed * b.speed) % 2;
  const v = p < 1 ? p : 2 - p;
  return b.spin > 0 ? v : 1 - v;
}

/** Where the target band sits after `hits` strikes. Moves every hit. */
export function bandAt(b: WardBoard, hits: number): number {
  const r = mul32(b.seed + hits * 7919);
  return 0.2 + r() * 0.6;
}

export function inBand(b: WardBoard, elapsed: number, hits: number): boolean {
  return Math.abs(markerAt(b, elapsed) - bandAt(b, hits)) <= b.half;
}

export function sequenceDone(b: WardBoard, taps: number[]): boolean {
  return taps.length === b.seq.length && taps.every((t, i) => t === b.seq[i]);
}

export function sequenceSoFarGood(b: WardBoard, taps: number[]): boolean {
  return taps.every((t, i) => t === b.seq[i]);
}

/** Four glyphs for the sequence wards — drawn, not emoji. */
export const SEQ_GLYPHS = ["sun", "bell", "thorn", "eye"] as const;
export type SeqGlyph = (typeof SEQ_GLYPHS)[number];
