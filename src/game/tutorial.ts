/**
 * HOLLOW CREEK — NIGHTJAR ADDITION · the singleplayer school.
 * Eight "feathers". Every step is gated on *doing* the thing in the real world,
 * not on reading a card. Pure data + a gate predicate so both the React client
 * and the static client can drive the same lesson from a snapshot.
 */
import type { Snapshot } from "./types";
import { STATIONS } from "./types";

export interface Feather {
  t: string;
  need: "none" | "move" | "ward" | "rest" | "danger" | "vote" | "key" | "done";
  d: string;
}

export const FEATHERS: Feather[] = [
  { t: "Meet your guide", need: "none", d: "I am Morvain, the Nightjar — the creature of the night nobody else wore. I do not drink blood. I drink warnings, out of the air, with my mouth open in the dark. Which is why I can teach you and the Strigoi cannot." },
  { t: "Two axes, not one street", need: "move", d: "The town is a valley: 6400 by 4200. Farm west, chapel at the heart, sawmill east, cemetery and creek south, harrow wood north. Walk me with WASD or the arrows — both axes, and the walls push back." },
  { t: "A ward is a game, not a key-hold", need: "ward", d: "Old Creek made you press a button for three seconds and called it labour. No more: cut the pumpkins properly. Only the ripe ones, and I will be watching your hands." },
  { t: "Vigor is the price", need: "rest", d: "Every ward and every deed costs vigor. Under thirty percent your hands slow; at zero you are exhausted and work stops until you rest back to twenty — that hysteresis is deliberate. Stand still. Breathe." },
  { t: "The thrum", need: "danger", d: "When a Hollow is near, my feathers twitch before your eyes believe it. The edges close in and the heart finds the low drum. Break line of sight, get under a lantern, and notice who walks with you instead of away." },
  { t: "Bell, square, cage", need: "vote", d: "A body in the valley. Only inside the square may you vote. We do not hang people here — we cage them in iron, still pleading. Evidence, not fear." },
  { t: "The iron key", need: "key", d: "A dropped key frees a soul, or frees the thing wearing a soul. Choose loudly, and remember who chose with you." },
  { t: "Fourteen wards, one night", need: "done", d: "Smoke the hives, bar the north gate, nail the bridge, oil the cogs, tune the tower. Light all fourteen before the dark finishes the town and you have earned the chronicle's one kind line." },
];

/** Gate for a feather, evaluated from an authoritative snapshot only. */
export function featherDone(f: Feather, snap: Snapshot, start?: { x: number; y: number }): boolean {
  const me = snap.players.find((p) => p.id === snap.self.id);
  switch (f.need) {
    case "none":
    case "done":
      return true;
    case "move":
      return !!me && !!start && Math.hypot(me.x - start.x, me.y - start.y) > 210;
    case "ward":
      return snap.tasks.some((t) => t.done);
    case "rest":
      return snap.self.stamina > 0.7 && snap.tasks.some((t) => t.done);
    case "danger":
      return snap.danger > 0.2;
    case "vote":
      return snap.self.myVote !== null;
    case "key":
      return snap.keyPos === null;
  }
}

export const lessonTarget = (i: number) => STATIONS[Math.min(i, STATIONS.length - 1)];
