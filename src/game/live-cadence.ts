// Live scheduling only. Deterministic replay still applies every recorded tick.
// Old matches must not consume a 250Hz CPU budget forever after everyone leaves.
import type { Room } from "./engine";
const sleeping = new WeakSet<Room>();
const lobbyBeat = new WeakMap<Room, number>();
export function shouldTickRoom(room: Room, now: number): boolean {
  if (room.phase === "ended") return false;
  if (room.phase === "lobby") {
    if (now - (lobbyBeat.get(room) ?? -Infinity) < 100) return false;
    lobbyBeat.set(room, now); return true;
  }
  for (const p of room.players.values()) {
    if (!p.parked && now - p.lastSeen < 15_000) { sleeping.delete(room); return true; }
  }
  if (sleeping.has(room)) return false;
  sleeping.add(room);
  // One final real tick performs stale-player releases and drops before sleeping.
  return true;
}
