// Merging the authoritative echo of an input POST into the last snapshot.
// The server answers each accepted input with the acting soul's own state, so a
// keypress is visible after one round trip instead of waiting for the next push.
// This module decides *which* echoed fields are newer than what we already hold.
// It never invents motion: it only orders two server-authored samples.

export interface SelfEcho {
  /** Server clock when this echo was produced. */
  at?: number;
  x?: number;
  drawX?: number;
  facing?: number;
  inside?: string | null;
  /** True when the server rejected the steering as out of order. */
  stale?: boolean;
}

export interface SelfSyncState {
  /** Server clock of the newest *position* sample applied for ourselves. */
  posAt: number;
}

export interface SelfMergeDecision {
  /** Apply x/drawX: this echo is at least as new as the newest position held. */
  takePosition: boolean;
  /** Apply facing/inside: intent echoes, not positions, so they are always current. */
  takeIntent: boolean;
  posAt: number;
}

/**
 * `state.posAt` is the server timestamp of the newest position we already show.
 * An echo stamped at least that recently carries a position we do not have yet;
 * an older echo is superseded by a push we already applied. Intent fields are
 * safe either way, and a rejected (stale) echo applies nothing.
 */
export function decideSelfEcho(state: SelfSyncState, echo: SelfEcho | null | undefined): SelfMergeDecision {
  if (!echo || echo.stale) return { takePosition: false, takeIntent: false, posAt: state.posAt };
  const at = typeof echo.at === "number" && Number.isFinite(echo.at) ? echo.at : null;
  const takePosition = at === null ? true : at >= state.posAt;
  return {
    takePosition,
    takeIntent: true,
    posAt: takePosition && at !== null ? at : state.posAt,
  };
}

/** Record a position sample that arrived by push (snapshot or motion patch). */
export function notePushedPosition(state: SelfSyncState, serverNow: number | undefined): void {
  if (typeof serverNow === "number" && Number.isFinite(serverNow) && serverNow > state.posAt) state.posAt = serverNow;
}
