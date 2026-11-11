// Chronicle & event feed: wall-clock-safe journaling, deterministic seeds, and
// the persisted event log. record() writes to the DB (fire-and-forget).
import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import { BELL_X, JOURNAL_CAP, TICK_RATE, type InputBody } from "./types";
const JOURNAL_SLACK = TICK_RATE * 5; // ≈5 s of ticks between compactions
import { canonicalInput } from "./input";
import { randomUUID } from "node:crypto";
import type { JournalEntry, P, Room } from "./engine";

export const roomNow = (room: Room) => room.replaying ? (room.replayNow ?? 0) : Math.max(Date.now(), room.journal.at(-1)?.at ?? 0);
const observedTypes = ["pickup_key", "supply_taken", "supply_recovered", "supply_delivered", "task_complete", "ward_ruined", "kill", "door_action", "unlock_cage", "chat", "timepiece_taken", "pin_note"];

// Journal seeds only have to be unpredictable enough to make events feel varied;
// they are *recorded*, so replays use the stored number either way. crypto's
// randomInt() at TICK_RATE per room was a measurable per-tick cost on the same
// thread that paces the tick grid, so use a cheap xorshift instead. The stored
// seed still makes every replay byte-identical.
let journalSeed = (Date.now() ^ 0x9e3779b9) | 0 || 1;
function nextJournalSeed(): number {
  journalSeed ^= journalSeed << 13; journalSeed ^= journalSeed >>> 17; journalSeed ^= journalSeed << 5;
  return (journalSeed >>> 0) % 0x7ffffffe + 1;
}

export function journal(room: Room, kind: JournalEntry["kind"], at: number, playerId?: string, body?: InputBody): JournalEntry {
  // Wall clocks can move backwards; journal order must not.
  at = Math.max(at, room.journal.at(-1)?.at ?? at);
  const entry: JournalEntry = { seq: ++room.journalSeq, at, kind, seed: nextJournalSeed(), playerId, body: body ? canonicalInput(body) : undefined };
  room.journal.push(entry); room.activeSeed = entry.seed; room.activeEventId = String(entry.seq);
  // Ticks (TICK_RATE/s) and presence heartbeats flood the chronicle; evict only
  // those, oldest first. Evicting one entry per tick meant a splice() — a memmove
  // of the whole ~10k-entry array — on every tick; compact in place once the
  // journal is JOURNAL_SLACK past the cap instead (same entries go, in the same
  // order, just a few seconds later). Replay finds entries by seq, never by index.
  if (room.journal.length > JOURNAL_CAP + JOURNAL_SLACK) {
    const list = room.journal;
    let drop = list.length - JOURNAL_CAP, w = 0;
    for (let r = 0; r < list.length; r++) {
      const e = list[r];
      if (drop > 0 && (e.kind === "tick" || e.kind === "presence")) { drop--; continue; }
      list[w++] = e;
    }
    list.length = w;
  }
  return entry;
}
export function seeded(room: Room, salt: string): number {
  let h = (room.activeSeed || 1) >>> 0;
  for (const ch of salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 0x7ffffffe) + 1;
}
export function kitId(room: Room, p: P): string {
  return `kit:${room.code}:${room.round}:${room.activeEventId || randomUUID()}:${p.id}`;
}

export function record(room: Room, p: P | null, type: string, data: Record<string, unknown> = {}) {
  if (p) {
    const actions: Record<string, string> = { pickup_key: "took the iron key", supply_taken: "took a repair kit", supply_recovered: "picked up a repair kit", timepiece_taken: "took the timepiece", pin_note: "pinned a page" };
    const doorPickup = type === "door_action" && typeof data.message === "string" && data.message.includes("found") ? data.message.replace(/^You found /, "took ") : null;
    const text = actions[type] ?? doorPickup;
    if (text) { p.actionText = text; p.actionUntil = roomNow(room) + 3500; }
  }
  if ((room.replaying || !room.temporalShadow) && room.phase !== "lobby" && ((p && observedTypes.includes(type)) || type === "meeting_result")) {
    room.historyEvents.push({ at: roomNow(room), actorId: p?.id ?? "", name: p?.name ?? "", x: p?.x ?? BELL_X, inside: p?.inside ?? null, type, data: { ...data } });
    if (room.historyEvents.length > 5000) room.historyEvents.shift();
  }
  if (room.replaying) return;
  db.insert(gameEvents)
    .values({
      roomCode: room.code,
      playerId: p?.id ?? null,
      playerName: p?.name ?? null,
      type,
      data: { phase: room.phase, x: p ? Math.round(p.x) : undefined, ...(room.temporalShadow ? { pastAt: room.temporalAt } : {}), ...data },
    })
    .catch((e) => console.error("chronicle write failed", e));
}

export function feed(room: Room, text: string) {
  room.feed.push({ text, at: roomNow(room) });
  if (room.feed.length > 24) room.feed.shift();
}

// Persistence bookkeeping + SSE change listeners (moved from engine).
// ---------------------------------------------------------------------------
// Persistence — the same players repeat in the same room even across a server
// restart. Writes are queued and flushed on an interval so the tick loop never
// waits on the database.
// ---------------------------------------------------------------------------

export const gPersist = globalThis as typeof globalThis & {
  __hollowDirtyRooms?: Set<string>;
  __hollowPersistTimer?: ReturnType<typeof setInterval>;
};
export const dirtyRooms: Set<string> = gPersist.__hollowDirtyRooms ?? new Set();
gPersist.__hollowDirtyRooms = dirtyRooms;

// Change listeners for server-push (SSE) state streaming: fired on every
// mutation and every tick, so subscribers can re-fingerprint and push.
// Stored on globalThis alongside rooms/dirtyRooms so separate Next route bundles
// always share one listener table.
const gListen = globalThis as typeof globalThis & { __hollowListeners?: Map<string, Set<() => void>> };
const roomListeners: Map<string, Set<() => void>> = gListen.__hollowListeners ?? new Map();
gListen.__hollowListeners = roomListeners;
export function onRoomEvent(code: string, cb: () => void): () => void {
  let set = roomListeners.get(code);
  if (!set) { set = new Set(); roomListeners.set(code, set); }
  set.add(cb);
  return () => { set.delete(cb); if (set.size === 0) roomListeners.delete(code); };
}
export function emitRoom(code: string) {
  for (const cb of roomListeners.get(code) ?? []) { try { cb(); } catch { /* listener bug must not break the room */ } }
}

export function markDirty(room: Room) {
  if (room.replaying) return;
  room.rev++;
  dirtyRooms.add(room.code);
  emitRoom(room.code);
}
