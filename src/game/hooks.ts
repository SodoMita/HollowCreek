// Engine↔module hook bridge: engine owns the deeply-entangled time-travel and
// lifecycle functions; rule/action modules call them through these wrappers,
// so the dependency graph stays one-directional (no import cycles).
import type { P, Room } from "./engine";

interface EngineHooks {
  endTimeVisit: (room: Room, p: P, reason: string) => void;
  spawnNextTimepiece: (room: Room, now: number) => void;
}
let hooks: EngineHooks = {
  endTimeVisit: () => { throw new Error("engine hooks not bound"); },
  spawnNextTimepiece: () => { throw new Error("engine hooks not bound"); },
};
export function bindEngineHooks(h: Partial<EngineHooks>) { hooks = { ...hooks, ...h }; }
export const endTimeVisit = (room: Room, p: P, reason: string) => hooks.endTimeVisit(room, p, reason);
export const spawnNextTimepiece = (room: Room, now: number) => hooks.spawnNextTimepiece(room, now);

