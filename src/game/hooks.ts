// Engine↔module hook bridge: engine owns snapshot() (per-viewer view, which
// depends on the time-travel past layer) and tickRoom() (the authoritative loop
// that time-travel simulation re-enters) — called through these wrappers, so
// the module dependency graph stays one-directional (no import cycles).
import type { Snapshot } from "./types";
import type { Room } from "./engine";

let fns: {
  snapshot: (room: Room, playerId: string) => Snapshot | null;
  tickRoom: (room: Room, now: number) => void;
} = {
  snapshot: () => { throw new Error("engine hooks not bound"); },
  tickRoom: () => { throw new Error("engine hooks not bound"); },
};
export function bindEngineHooks(h: Partial<typeof fns>) { fns = { ...fns, ...h }; }
export const snapshot = (room: Room, playerId: string) => fns.snapshot(room, playerId);
export const tickRoom = (room: Room, now: number) => fns.tickRoom(room, now);
