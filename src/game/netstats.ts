// Server-side timing diagnostics for the ?net=1 readout: how evenly the tick
// loop really runs, how long each tick's work takes, how long the event loop
// was blocked, and how long garbage collection paused it. Read-only
// instrumentation — nothing here changes game timing or state.
//
// Stored on globalThis so the tick loop (started by whichever route bundle
// loads first) and the /api/game/netstats route share a single store.
import { constants as perfConstants, monitorEventLoopDelay, PerformanceObserver, type IntervalHistogram } from "node:perf_hooks";
import { TICK_MS } from "./types";

const RING = 1200; // ≈10 s of ticks at 120 Hz
const WINDOW_MS = 10_000;

interface Window { loopMaxMs: number; loopP99Ms: number; gcMaxMs: number; gcCount: number; gcTotalMs: number; minorMaxMs: number; majorMaxMs: number; majorCount: number; incMaxMs: number; weakMaxMs: number }
interface Store {
  intervals: Float64Array; work: Float64Array; at: number; filled: number; lastTickAt: number;
  loop: IntervalHistogram | null;
  cur: Window; prev: Window; rotatedAt: number;
}

const g = globalThis as typeof globalThis & { __hollowNetStats?: Store };
const emptyWindow = (): Window => ({ loopMaxMs: 0, loopP99Ms: 0, gcMaxMs: 0, gcCount: 0, gcTotalMs: 0, minorMaxMs: 0, majorMaxMs: 0, majorCount: 0, incMaxMs: 0, weakMaxMs: 0 });

function store(): Store {
  if (g.__hollowNetStats) return g.__hollowNetStats;
  const s: Store = {
    intervals: new Float64Array(RING), work: new Float64Array(RING), at: 0, filled: 0, lastTickAt: 0,
    loop: null, cur: emptyWindow(), prev: emptyWindow(), rotatedAt: Date.now(),
  };
  try { s.loop = monitorEventLoopDelay({ resolution: 2 }); s.loop.enable(); } catch { s.loop = null; }
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        s.cur.gcCount++;
        s.cur.gcTotalMs += e.duration;
        if (e.duration > s.cur.gcMaxMs) s.cur.gcMaxMs = e.duration;
        // Which collector paused us: a young-generation scavenge (allocation
        // rate) or a major mark-compact (long-lived growth: journal, history).
        const kind = (e as unknown as { detail?: { kind?: number }; kind?: number }).detail?.kind ?? (e as unknown as { kind?: number }).kind;
        if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) { s.cur.majorCount++; if (e.duration > s.cur.majorMaxMs) s.cur.majorMaxMs = e.duration; }
        else if (kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) { if (e.duration > s.cur.minorMaxMs) s.cur.minorMaxMs = e.duration; }
        else if (kind === perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL) { if (e.duration > s.cur.incMaxMs) s.cur.incMaxMs = e.duration; }
        else if (kind === perfConstants.NODE_PERFORMANCE_GC_WEAKCB) { if (e.duration > s.cur.weakMaxMs) s.cur.weakMaxMs = e.duration; }
      }
    });
    obs.observe({ entryTypes: ["gc"] });
  } catch { /* gc entries unavailable on this runtime */ }
  g.__hollowNetStats = s;
  return s;
}

function rotate(s: Store, now: number) {
  if (now - s.rotatedAt < WINDOW_MS) return;
  if (s.loop) {
    s.cur.loopMaxMs = s.loop.max / 1e6;
    s.cur.loopP99Ms = s.loop.percentile(99) / 1e6;
    s.loop.reset();
  }
  s.prev = s.cur;
  s.cur = emptyWindow();
  s.rotatedAt = now;
}

/** One scheduled tick: `start` is performance.now() when it fired, `workMs` how long tickRooms() took. */
export function recordTick(start: number, workMs: number) {
  const s = store();
  if (s.lastTickAt) {
    s.intervals[s.at] = start - s.lastTickAt;
    s.work[s.at] = workMs;
    s.at = (s.at + 1) % RING;
    if (s.filled < RING) s.filled++;
  }
  s.lastTickAt = start;
  rotate(s, Date.now());
}

const r2 = (v: number) => Math.round(v * 100) / 100;

function quantiles(buf: Float64Array, n: number) {
  const sorted = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
  const q = (f: number) => (n ? sorted[Math.min(n - 1, Math.floor(f * n))] : 0);
  return { p50: r2(q(0.5)), p99: r2(q(0.99)), max: r2(q(1)) };
}

/** Snapshot of the last ~10 s. Reading does not reset anything, so several viewers can poll it. */
export function readNetStats() {
  const s = store();
  rotate(s, Date.now());
  const n = s.filled;
  let late = 0;
  for (let i = 0; i < n; i++) if (s.intervals[i] > TICK_MS * 2) late++;
  const loopNowMax = s.loop ? s.loop.max / 1e6 : 0;
  const loopNowP99 = s.loop ? s.loop.percentile(99) / 1e6 : 0;
  return {
    tickMs: r2(TICK_MS),
    tick: { samples: n, ...quantiles(s.intervals, n), late },
    work: quantiles(s.work, n),
    loop: { p99: r2(Math.max(loopNowP99, s.prev.loopP99Ms)), max: r2(Math.max(loopNowMax, s.prev.loopMaxMs)) },
    gc: {
      max: r2(Math.max(s.cur.gcMaxMs, s.prev.gcMaxMs)), count: s.cur.gcCount + s.prev.gcCount, totalMs: r2(s.cur.gcTotalMs + s.prev.gcTotalMs),
      minorMax: r2(Math.max(s.cur.minorMaxMs, s.prev.minorMaxMs)), majorMax: r2(Math.max(s.cur.majorMaxMs, s.prev.majorMaxMs)), majorCount: s.cur.majorCount + s.prev.majorCount,
      incrementalMax: r2(Math.max(s.cur.incMaxMs, s.prev.incMaxMs)), weakCallbackMax: r2(Math.max(s.cur.weakMaxMs, s.prev.weakMaxMs)),
    },
    heapMB: Math.round(process.memoryUsage().heapUsed / 1e5) / 10,
  };
}
