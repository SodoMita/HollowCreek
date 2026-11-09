// Per-viewer stream state on the server: what each player's client holds, so
// the SSE route and the long-poll route can both answer with deltas and both
// honour the one-second beat for slow values. Kept outside the Room record so
// persistence and history checkpoints never see it.
import type { Room } from "./engine";
import { onRoomEvent } from "./chronicle";
import { roomEtag, snapshot } from "./snapshot";
import { applyFrame, diffView, encodeView, type EncodedView, type WireFrame } from "./wire";

export const FRAME_MS = 16; // coalesce bursts within one display frame; do not wait a whole tick
export const SLOW_MS = 1000; // slow-class values ride at most once a second

interface ViewerState {
  view: EncodedView;
  slowAt: number; // last time a frame carrying slow values went out
}

const store = new WeakMap<Room, Map<string, ViewerState>>();

function states(room: Room) {
  let m = store.get(room);
  if (!m) { m = new Map(); store.set(room, m); }
  if (m.size > 64) m.clear();
  return m;
}

export function viewerEtag(room: Room, playerId: string): string | null {
  return states(room).get(playerId)?.view.etag ?? null;
}

/**
 * The next frame for a viewer, or null when nothing needs sending yet.
 * `holdsEtag` is what the client says it has; anything else resyncs with a
 * full snapshot. Slow-only changes are held until SLOW_MS has passed since
 * the last slow beat, unless `flush` forces them out (the long-poll deadline).
 */
export function nextFrame(room: Room, playerId: string, holdsEtag: string | null, now: number, flush = false): { frame: WireFrame | null; snapNow: number } | null {
  const snap = snapshot(room, playerId); // also the presence heartbeat
  if (!snap) return null;
  const etag = roomEtag(room, playerId, snap);
  const m = states(room);
  const prev = m.get(playerId);
  if (!prev || holdsEtag !== prev.view.etag) {
    m.set(playerId, { view: encodeView(snap, etag), slowAt: now });
    return { frame: { etag, now: snap.now, snap }, snapNow: snap.now };
  }
  if (etag === prev.view.etag) return { frame: null, snapNow: snap.now };
  const next = encodeView(snap, etag);
  const d = diffView(prev.view, next);
  if (!d.any) { prev.view = next; return { frame: null, snapNow: snap.now }; }
  if (!d.fast && !flush && now - prev.slowAt < SLOW_MS) return { frame: null, snapNow: snap.now };
  const frame: WireFrame = { etag, now: snap.now };
  if (Object.keys(d.delta).length) frame.delta = d.delta;
  if (Object.keys(d.patch).length) frame.patch = d.patch;
  // Did this frame carry slow values? Then the beat restarts; fast-only frames leave it alone.
  const carriedSlow = !d.fast || Object.keys(d.delta).some((k) => k === "nightT" || k === "time" || k === "danger") || !!d.patch.self || !!d.patch.tasks;
  m.set(playerId, { view: next, slowAt: carriedSlow ? now : prev.slowAt });
  return { frame, snapNow: snap.now };
}

/** Milliseconds until the held slow values may go out (0 when nothing is held). */
export function slowDueIn(room: Room, playerId: string, now: number): number {
  const s = states(room).get(playerId);
  return s ? Math.max(0, SLOW_MS - (now - s.slowAt)) : 0;
}

/**
 * Long-poll support: resolve as soon as the viewer would get a frame (a fast
 * change, or the slow beat coming due), or after `maxMs`. Checks are
 * coalesced to one per FRAME_MS so a busy room costs one snapshot per viewer
 * per 100 ms, not one per tick.
 */
export function waitForFrame(room: Room, playerId: string, holdsEtag: string | null, maxMs: number, signal?: AbortSignal): Promise<WireFrame | null> {
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const finish = (frame: WireFrame | null) => {
      if (done) return;
      done = true;
      unsub();
      if (timer) clearTimeout(timer);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      resolve(frame);
    };
    const check = () => {
      timer = null;
      if (done) return;
      const now = Date.now();
      const elapsed = now - started;
      const r = nextFrame(room, playerId, holdsEtag, now, elapsed >= maxMs);
      if (!r) { finish(null); return; }
      if (r.frame) { finish(r.frame); return; }
      // A room event fired but nothing changed for THIS viewer (somebody else moved,
      // a field outside this viewer's vision). Keep holding instead of ending the
      // request: otherwise every input from anyone churns every viewer's poll.
      if (elapsed < maxMs) timer = setTimeout(check, FRAME_MS);
    };
    const onEvent = () => { if (!timer && !done) timer = setTimeout(check, FRAME_MS); };
    const unsub = onRoomEvent(room.code, onEvent);
    const deadline = setTimeout(() => { if (!done) { const now = Date.now(); const r = nextFrame(room, playerId, holdsEtag, now, true); finish(r?.frame ?? null); } }, maxMs);
    const onAbort = () => finish(null);
    signal?.addEventListener("abort", onAbort);
    onEvent();
  });
}

export { applyFrame };
