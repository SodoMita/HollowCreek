// Night checkpointing: sampled snapshots of a room for time-travel replay.
// Pure functions over Room fields — no I/O, no engine imports at runtime.
import { HISTORY_SAMPLE_MS } from "./types";
import type { HistoryFrame, Room } from "./engine";

export function captureHistory(room: Room, now: number, force = false) {
  if (room.temporalShadow || (room.phase !== "playing" && room.phase !== "meeting")) return;
  if (!force && now - room.lastHistoryAt < HISTORY_SAMPLE_MS) return;
  room.lastHistoryAt = now;
  room.history.push({
    at: now, seq: room.journalSeq, phase: room.phase, meeting: structuredClone(room.meeting), winner: room.winner, winReason: room.winReason,
    nextFlicker: room.nextFlicker, blackoutReadyAt: room.blackoutReadyAt, timepieces: structuredClone(room.timepieces), timepiecePending: room.timepiecePending, endedAt: room.endedAt,
    players: structuredClone([...room.players.values()].filter((p) => p.id !== room.timeVisit?.playerId)),
    pool: structuredClone(room.pool), doors: structuredClone(room.doors), keyX: room.keyX,
    supplyDrops: structuredClone(room.supplyDrops), notes: structuredClone(room.notes), cartX: room.cartX, cartSubX: room.cartSubX ?? 0, cartPushers: room.cartPushers,
    cages: structuredClone(room.cages), bodies: structuredClone(room.bodies), feed: structuredClone(room.feed), events: structuredClone(room.historyEvents.slice(-32)),
    bellAt: room.bellAt, flickerAt: room.flickerAt, blackoutUntil: room.blackoutUntil,
  });
  // Keep the whole night selectable while progressively thinning older samples.
  if (room.history.length > 7200) {
    const older = room.history.slice(0, 3600).filter((_, index) => index % 2 === 0);
    room.history = older.concat(room.history.slice(3600));
  }
}

export function frameAt(room: Room, at: number): HistoryFrame | null {
  if (!room.history.length) return null;
  let lo = 0, hi = room.history.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (room.history[mid].at <= at) lo = mid; else hi = mid - 1;
  }
  return room.history[lo];
}

/** Restore a checkpoint without sharing mutable objects or performing I/O. */
export function restoreFrame(room: Room, frame: HistoryFrame): Room {
  return {
    ...room, replaying: true, temporalShadow: true, replayNow: frame.at, replayVisitorId: undefined,
    timeVisit: null, history: [], historyEvents: structuredClone(frame.events), journal: [], journalSeq: frame.seq,
    phase: frame.phase, meeting: structuredClone(frame.meeting), winner: frame.winner, winReason: frame.winReason,
    nextFlicker: frame.nextFlicker, blackoutReadyAt: frame.blackoutReadyAt, endedAt: frame.endedAt,
    timepieces: structuredClone(frame.timepieces), timepiecePending: frame.timepiecePending,
    players: new Map(frame.players.map((player) => [player.id, structuredClone(player)])),
    pool: structuredClone(frame.pool), doors: structuredClone(frame.doors), keyX: frame.keyX,
    supplyDrops: structuredClone(frame.supplyDrops), notes: structuredClone(frame.notes), cartX: frame.cartX, cartSubX: frame.cartSubX ?? 0, cartPushers: frame.cartPushers,
    cages: structuredClone(frame.cages), bodies: structuredClone(frame.bodies), feed: structuredClone(frame.feed),
    bellAt: frame.bellAt, flickerAt: frame.flickerAt, blackoutUntil: frame.blackoutUntil,
  };
}
