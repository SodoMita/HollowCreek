// Timepiece helpers — pure queries over room state (no I/O).
import { dist, INTERACT_RANGE } from "./types";
import type { P, Room, TimepieceState } from "./engine";

export const loosePieces = (room: Room) => room.timepieces.filter((tp) => !tp.consumed && tp.holder === null);
/** The unconsumed timepiece a soul is carrying, if any. */
export const heldPiece = (room: Room, playerId: string) => room.timepieces.find((tp) => tp.holder === playerId && !tp.consumed);
export const usedPieces = (room: Room) => room.timepieces.filter((tp) => tp.consumed).length;
export function nearestTimepiece(room: Room, p: P): TimepieceState | null {
  let best: TimepieceState | null = null;
  for (const tp of loosePieces(room)) {
    const distance = dist(tp.x, p.x);
    if (distance >= 55) continue;
    if (room.keyX !== null && dist(room.keyX, p.x) < INTERACT_RANGE && dist(room.keyX, p.x) < distance) continue;
    if (room.doors.some((door) => door.keyX !== null && dist(door.keyX, p.x) <= 44 && dist(door.keyX, p.x) < distance)) continue;
    if (!best || distance < dist(best.x, p.x)) best = tp;
  }
  return best;
}
export function nearTimepiece(room: Room, p: P): boolean { return nearestTimepiece(room, p) !== null; }
