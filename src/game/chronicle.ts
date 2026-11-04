// Chronicle & event feed: wall-clock-safe journaling, deterministic seeds, and
// the persisted event log. record() writes to the DB (fire-and-forget).
import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import { BELL_X, type InputBody } from "./types";
import { canonicalInput } from "./input";
import { randomInt, randomUUID } from "node:crypto";
import type { JournalEntry, P, Room } from "./engine";

export const roomNow = (room: Room) => room.replaying ? (room.replayNow ?? 0) : Math.max(Date.now(), room.journal.at(-1)?.at ?? 0);
const observedTypes = ["pickup_key", "supply_taken", "supply_recovered", "supply_delivered", "task_complete", "ward_ruined", "kill", "door_action", "unlock_cage", "chat", "timepiece_taken", "pin_note"];
export function journal(room: Room, kind: JournalEntry["kind"], at: number, playerId?: string, body?: InputBody): JournalEntry {
  // Wall clocks can move backwards; journal order must not.
  at = Math.max(at, room.journal.at(-1)?.at ?? at);
  const entry: JournalEntry = { seq: ++room.journalSeq, at, kind, seed: randomInt(1, 0x7fffffff), playerId, body: body ? canonicalInput(body) : undefined };
  room.journal.push(entry); room.activeSeed = entry.seed; room.activeEventId = String(entry.seq);
  // Ticks (10–20/s) and presence heartbeats flood the chronicle; evict only those.
  if (room.journal.length > 1500) {
    let i = 0;
    while (room.journal.length > 1500 && i < room.journal.length) {
      if (room.journal[i].kind === "tick" || room.journal[i].kind === "presence") room.journal.splice(i, 1);
      else i++;
    }
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
