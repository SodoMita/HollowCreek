// Proximity queries — pure helpers over room state (no I/O).
import { CAGE_UNLOCK_RANGE, INTERACT_RANGE, MEETING_FROM, MEETING_TO } from "./types";
import type { P, Room } from "./engine";

const dist = (a: number, b: number) => Math.abs(a - b);

export const inMeetingArea = (p: P) => p.caged || (p.x >= MEETING_FROM && p.x <= MEETING_TO);

/** A key always targets the closest occupied lock within arm's reach. */
export function nearestOccupiedCage(room: Room, x: number): number {
  let best = -1;
  let bestDistance = CAGE_UNLOCK_RANGE;
  room.cages.forEach((c, i) => {
    const d = Math.abs(c.x - x);
    if (c.occupant && d <= bestDistance) { best = i; bestDistance = d; }
  });
  return best;
}

export function nearestBody(room: Room, p: P) {
  let best: Room["bodies"][number] | null = null;
  for (const b of room.bodies) if (b.inside === p.inside && dist(b.x, p.x) < INTERACT_RANGE + 20 && (!best || dist(b.x, p.x) < dist(best.x, p.x))) best = b;
  return best;
}
