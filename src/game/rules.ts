// Core game rules: drops, cages, repairs, meetings, kills, win checks.
// endTimeVisit/spawnNextTimepiece live in engine (time-travel machinery), so
// engine injects them once via bindEngineHooks — no import cycle.
import { clampWorld, dropBuildingKeys } from "./buildings";
import { feed, journal, markDirty, record, roomNow, seeded, kitId } from "./chronicle";
import { inMeetingArea, nearestOccupiedCage, nearestBody, stationNear } from "./proximity";
import { heldPiece } from "./timepieces";
import { bumpStats } from "./stats";
import { createWardPuzzle } from "./wards";
import {
  CAGE_UNLOCK_RANGE, INTERACT_RANGE, KILL_COOLDOWN_MS, KILL_RANGE, MEETING_FROM, MEETING_MS, MEETING_TO,
  STAMINA_KILL_COST, STATIONS, TIMEPIECE_X, WORLD_W, CELL_HALF, ix,
  type InputBody, type Role,
} from "./types";
import type { P, Room, TaskState } from "./engine";

import { endTimeVisit, spawnNextTimepiece } from "./time-travel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dist = (a: number, b: number) => Math.abs(a - b);
/** Unused, unheld timepieces still lying on the road. */


export function dropKey(room: Room, p: P) {
  if (p.hasKey) {
    p.hasKey = false;
    room.keyX = clampWorld(p.x, 60);
  }
}

export function dropTimepiece(room: Room, p: P) {
  const tp = heldPiece(room, p.id);
  if (tp) { tp.holder = null; tp.x = clampWorld(p.x); }
}

export function dropSupply(room: Room, p: P) {
  if (!p.hasSupply) return;
  const id = p.supplyId ?? kitId(room, p);
  p.hasSupply = false;
  p.supplyId = null;
  room.supplyDrops.push({ id, x: clampWorld(p.x) });
  // Carts can always provide more; don't retain unbounded abandoned kits.
  if (room.supplyDrops.length > 24) room.supplyDrops.shift();
}


/** When carrying a kit, the ward directly beside you wins over loose items. */
export function tryDeliverSupply(room: Room, p: P): boolean {
  if (room.phase !== "playing" || p.caged || !p.hasSupply) return false;
  const ward = room.pool.find((t) => !t.done && !t.delivered && stationNear(p, t.id));
  if (!ward) return false;
  ward.delivered = true;
  ward.supplyId = p.supplyId;
  p.hasSupply = false;
  p.supplyId = null;
  feed(room, `${p.name} delivers a repair kit to ${STATIONS.find((st) => st.id === ward.id)!.name.toLowerCase()}.`);
  p.match.kitsDelivered++;
  record(room, p, "supply_delivered", { ward: ward.id, supplyId: ward.supplyId });
  if (canRepair(room, p) && !p.exhausted && p.stamina > 0) void beginRepair(room, p, ward);
  return true;
}

export function cagePlayer(room: Room, p: P): boolean {
  const idx = room.cages.findIndex((c) => c.occupant === null);
  if (idx === -1) return false;
  dropTimepiece(room, p);
  dropBuildingKeys(room.doors, p.id, p.x, p.inside);
  dropKey(room, p);
  dropSupply(room, p);
  p.inside = null;
  room.cages[idx].occupant = p.id;
  p.caged = true;
  p.cageIndex = idx;
  p.match.timesCaged++;
  p.x = room.cages[idx].x;
  p.dir = 0;
  p.activeWard = null;
  return true;
}

export function freePlayer(room: Room, p: P, stepOutside = true) {
  if (!p.caged || p.cageIndex < 0) return;
  const cage = room.cages[p.cageIndex];
  cage.occupant = null;
  p.caged = false;
  p.cageIndex = -1;
  if (stepOutside) {
    p.x = ix(Math.min(WORLD_W - 30, cage.x + CELL_HALF + 18));
    p.dir = 0;
  }
}

export function canRepair(room: Room, p: P) { return p.role === "crew" || (!!room.temporalShadow && (!room.replaying || p.temporalVisitor === true)); }
export function beginRepair(room: Room, p: P, task: TaskState): { ok: boolean; error?: string } {
  if (!canRepair(room, p)) return { ok: true }; // In the present the Hollow only pretends; in the past they may do real work.
  if (p.exhausted || p.stamina <= 0) return { ok: false, error: "Rest your vigor before repairing." };
  const st = STATIONS.find((s) => s.id === task.id)!;
  if (!stationNear(p, st.id)) return { ok: false, error: "Stand beside this ward in its room." };
  if (!task.puzzle) {
    task.puzzle = createWardPuzzle(st.kind, seeded(room, `ward:${st.id}`));
    if (task.puzzle.kind === "scarecrow") task.previewUntil = roomNow(room) + 3200;
  }
  p.activeWard = task.id;
  p.dir = 0;
  p.cartHeld = false;
  p.interactHeld = false;
  record(room, p, "ward_started", { task: task.id, kind: task.puzzle.kind });
  return { ok: true };
}

export function beginMeeting(room: Room, reason: string, caller: P | null) {
  if (room.timeVisit) { const visitor = room.players.get(room.timeVisit.playerId); if (visitor) endTimeVisit(room, visitor, "meeting"); }
  room.phase = "meeting";
  room.cartPushers = 0;
  room.blackoutUntil = 0; // the gathering rekindles the lanterns
  room.meeting = { endsAt: roomNow(room) + MEETING_MS, reason };
  room.bellAt = roomNow(room);
  for (const p of room.players.values()) { p.vote = null; p.interactHeld = false; p.cartHeld = false; p.activeWard = null; }
  feed(room, "🔔 The bell tolls. All souls must walk to the square.");
  record(room, caller, "meeting_start", { reason });
}

export function doKill(room: Room, killer: P, victim: P) {
  const victimWasCaged = victim.caged;
  const deathLayer = victim.inside;
  dropTimepiece(room, victim);
  dropBuildingKeys(room.doors, victim.id, victim.x, victim.inside);
  victim.alive = false;
  victim.dir = 0;
  victim.activeWard = null;
  dropKey(room, victim);
  dropSupply(room, victim);
  freePlayer(room, victim, false); // a killed prisoner dies inside the cell; body remains there
  room.bodies.push({ x: victim.x, color: victim.color, name: victim.name, id: victim.id, at: roomNow(room), inside: deathLayer });
  victim.inside = null; // ghosts cannot be trapped by a locked door
  killer.killAt = roomNow(room) + KILL_COOLDOWN_MS;
  killer.stamina = Math.max(0, killer.stamina - STAMINA_KILL_COST);
  killer.x = victim.x; // lunge
  feed(room, "A scream cuts through the fog, then silence.");
  killer.match.kills++;
  victim.match.deaths++;
  record(room, killer, "kill", { victim: victim.name, victimId: victim.id, victimCaged: victimWasCaged });
  if (!room.replaying) bumpStats(killer.id, killer.name, { kills: 1 });
  if (!room.replaying) bumpStats(victim.id, victim.name, { deaths: 1 });
  checkWin(room);
}

export function checkWin(room: Room) {
  if ((room.temporalShadow && !room.replaying) || room.phase === "lobby" || room.phase === "ended") return;
  const ps = [...room.players.values()].filter((player) => !(room.replaying && player.temporalVisitor));
  const hollowFree = ps.filter((p) => p.role === "hollow" && p.alive && !p.caged).length;
  const crewFree = ps.filter((p) => p.role === "crew" && p.alive && !p.caged).length;
  const crewAll = ps.filter((p) => p.role === "crew");
  const tasksDone = room.pool.length > 0 && room.pool.every((t) => t.done);
  let winner: Role | null = null;
  let reason = "";
  if (tasksDone && crewAll.length > 0) { winner = "crew"; reason = "Every ward is restored. The Hollow starves and retreats."; }
  else if (crewAll.every((p) => !p.alive)) { winner = "hollow"; reason = "No living townfolk remain to mend the wards."; }
  else if (hollowFree > 0 && hollowFree >= crewFree) { winner = "hollow"; reason = "The Hollow outnumber the free living townfolk. Hollow Creek belongs to them now."; }
  // Cages are not proof and never grant a crew win. The town must finish wards.
  if (winner) {
    if (room.timeVisit) { const visitor = room.players.get(room.timeVisit.playerId); if (visitor) endTimeVisit(room, visitor, "night ended"); }
    room.phase = "ended";
    room.endedAt = roomNow(room);
    markDirty(room);
    room.winner = winner;
    room.winReason = reason;
    room.meeting = null;
    feed(room, winner === "crew" ? "Dawn breaks over Hollow Creek." : "The last lantern goes out.");
    record(room, null, "game_end", { winner, reason });
    const playtimeSec = Math.max(0, Math.round((roomNow(room) - room.startedAt) / 1000));
    for (const p of room.players.values()) {
      if (!room.replaying) bumpStats(p.id, p.name, {
        games: 1,
        wins: p.role === winner ? 1 : 0,
        losses: p.role === winner ? 0 : 1,
        playtimeSec,
      });
    }
  }
}

export function resolveMeeting(room: Room) {
  const votes = new Map<string, number>();
  for (const p of room.players.values()) if (!p.temporalAbsent && p.vote) votes.set(p.vote, (votes.get(p.vote) ?? 0) + 1);
  let top: string | null = null;
  let topN = 0;
  let tie = false;
  for (const [k, n] of votes) {
    if (n > topN) { top = k; topN = n; tie = false; }
    else if (n === topN) tie = true;
  }
  record(room, null, "meeting_result", { tally: Object.fromEntries(votes), top: tie ? null : top });
  if (!top || tie || top === "skip") {
    feed(room, "The town could not agree. The cages stay as they are.");
  } else if (top.startsWith("free:")) {
    const p = room.players.get(top.slice(5));
    if (p && p.caged) {
      freePlayer(room, p);
      feed(room, `${p.name} is released from the iron cage.`);
    }
  } else {
    const p = room.players.get(top);
    if (p && p.alive && !p.caged) {
      if (cagePlayer(room, p)) {
        feed(room, `The town drags ${p.name} into a cage. They can still speak…`);
        if (!room.replaying) bumpStats(p.id, p.name, { cagings: 1 });
      } else feed(room, "Every cage is already full. The verdict is void.");
    }
  }
  room.bodies = [];
  room.meeting = null;
  room.phase = "playing";
  for (const p of room.players.values()) { p.vote = null; if (p.role === "hollow") p.killAt = roomNow(room) + 10000; }
  if (!room.replaying && room.timepiecePending) spawnNextTimepiece(room, roomNow(room));
  checkWin(room);
}

