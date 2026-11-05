// Room registry: the in-memory map of live rooms (survives HMR via globalThis),
// one-flight hydration loads, code generation, and public listing.
import { randomInt } from "node:crypto";
import type { RoomListing } from "./types";
import type { Room } from "./engine";

const gReg = globalThis as typeof globalThis & {
  __hollowRooms?: Map<string, Room>;
  __hollowRoomLoads?: Map<string, Promise<Room | undefined>>;
};
export const rooms: Map<string, Room> = gReg.__hollowRooms ?? new Map();
gReg.__hollowRooms = rooms;
// Concurrent join/state requests after a restart must share one hydration.
// Otherwise each request can build a room and overwrite the previous one,
// leaving a player whose join already succeeded as "Unknown soul".
export const roomLoads: Map<string, Promise<Room | undefined>> = gReg.__hollowRoomLoads ?? new Map();
gReg.__hollowRoomLoads = roomLoads;

// Concurrent join/state requests after a restart must share one hydration.
// Otherwise each request can build a room and overwrite the previous one,
// leaving a player whose join already succeeded as "Unknown soul".
export function makeCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => chars[randomInt(0, chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function listRoomsSync(): RoomListing[] {
  return [...rooms.values()]
    .filter((r) => r.players.size > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24)
    .map((r) => {
      const ps = [...r.players.values()];
      return {
        code: r.code,
        phase: r.phase,
        playerCount: ps.length,
        hostName: ps.find((p) => p.isHost)?.name ?? "—",
        names: ps.map((p) => p.name),
        createdAt: r.createdAt,
        round: r.round,
      };
    });
}

