// Wire cursors are transport state, never room history. Each SSE connection gets
// its OWN cursor; a reload, second tab, or plain state inspector cannot steal
// another connection's delta baseline.
import type { Room } from "./engine";
import { onRoomEvent } from "./chronicle";
import { snapshot } from "./snapshot";
import { applyFrame, compactMotion, diffView, encodeView, type EncodedView, type WireFrame } from "./wire";

export const FRAME_MS = 16; // push cadence: one position frame per display refresh
export const SLOW_MS = 1000;
export interface ViewerCursor {
  view: EncodedView | null;
  compact: boolean;
  seq: number;
  slowAt: number;
  sentAt: number;
  rev: number;
}
export function createViewerCursor(compact = false): ViewerCursor { return { view: null, compact, slowAt: 0, sentAt: 0, rev: -1, seq: 0 }; }
const polls = new WeakMap<Room, Map<string, ViewerCursor>>();
export function pollCursor(room: Room, playerId: string, compact = false, clientId = "") {
  const key = `${playerId}:${compact ? "v2" : "v1"}:${clientId.slice(0, 64)}`;
  let map = polls.get(room);
  if (!map) { map = new Map(); polls.set(room, map); }
  let cursor = map.get(key);
  if (!cursor) {
    if (map.size >= 64) map.delete(map.keys().next().value as string);
    cursor = createViewerCursor(compact); map.set(key, cursor);
  }
  return cursor;
}
export function viewerEtag(room: Room, playerId: string): string | null { return pollCursor(room, playerId).view?.etag ?? null; }

export function nextFrame(room: Room, playerId: string, holdsEtag: string | null, now: number, flush = false, cursor = pollCursor(room, playerId), minFrameMs = 0): { frame: WireFrame | null; snapNow: number; deferred?: boolean } | null {
  // Push streams pace themselves to the display: at 120 ticks/s a 60 Hz stream
  // carries the same visible positions with half the snapshot/encode work, fewer
  // socket writes and less GC on the thread that paces the tick grid. The client
  // never receives an older sample, only one per refresh interval.
  if (minFrameMs > 0 && !flush && cursor.view && cursor.sentAt && now - cursor.sentAt < minFrameMs && holdsEtag === cursor.view.etag) {
    return { frame: null, snapNow: now, deferred: true };
  }
  const snap = snapshot(room, playerId); // presence + time-dependent notices remain authoritative
  if (!snap) return null;
  const prev = cursor.view;
  const next = encodeView(snap); // computes the fingerprint ONCE, not again below
  const etag = next.etag;
  if (!prev || holdsEtag !== prev.etag) {
    Object.assign(cursor, { view: next, slowAt: now, sentAt: now, rev: room.rev });
    return { frame: { n: ++cursor.seq, etag, now: snap.now, snap }, snapNow: snap.now };
  }
  if (etag === prev.etag) return { frame: null, snapNow: snap.now };
  const d = diffView(prev, next);
  if (!d.any) return { frame: null, snapNow: snap.now };
  if (!d.fast && !flush && now - cursor.slowAt < SLOW_MS) return { frame: null, snapNow: snap.now };
  const frame: WireFrame = { n: ++cursor.seq, base: prev.etag, etag, now: snap.now };
  if (Object.keys(d.delta).length) frame.delta = d.delta;
  if (Object.keys(d.patch).length) frame.patch = d.patch;
  const carriedSlow = !d.fast || ["nightT", "time", "danger", "hint"].some(k => k in d.delta) || !!d.patch.self || !!d.patch.tasks;
  if (cursor.compact) compactMotion(frame, snap);
  Object.assign(cursor, { view: next, slowAt: carriedSlow ? now : cursor.slowAt, sentAt: now, rev: room.rev });
  return { frame, snapNow: snap.now };
}
export function slowDueIn(room: Room, playerId: string, now: number, cursor = pollCursor(room, playerId)): number {
  return cursor.view ? Math.max(0, SLOW_MS - (now - cursor.slowAt)) : 0;
}

/** Continuous long-poll. Separate slow/event timers; abort always releases the listener. */
export function waitForFrame(room: Room, playerId: string, holdsEtag: string | null, maxMs: number, signal?: AbortSignal, cursor = pollCursor(room, playerId)): Promise<WireFrame | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    let done = false, queued = false;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const finish = (frame: WireFrame | null) => {
      if (done) return;
      done = true; unsubscribe(); clearTimeout(slowTimer); clearTimeout(deadline);
      signal?.removeEventListener("abort", aborted); resolve(frame);
    };
    const aborted = () => finish(null);
    const check = (flush = false) => {
      queued = false;
      if (done) return;
      const now = Date.now();
      const result = nextFrame(room, playerId, holdsEtag, now, flush, cursor);
      if (!result || result.frame || flush) { finish(result?.frame ?? null); return; }
      const due = slowDueIn(room, playerId, now, cursor);
      if (!slowTimer && due > 0 && due < maxMs) slowTimer = setTimeout(() => { slowTimer = undefined; check(); }, due);
    };
    unsubscribe = onRoomEvent(room.code, () => {
      if (done || queued) return;
      queued = true; queueMicrotask(() => check());
    });
    deadline = setTimeout(() => check(true), maxMs);
    signal?.addEventListener("abort", aborted, { once: true });
    check();
  });
}
export { applyFrame };
