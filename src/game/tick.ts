// Authoritative tick loop: advances every live room, emits change events for
// SSE, and GCs dead rooms. Time-travel reconciliation is injected via hooks.
import { emitRoom, feed, journal, roomNow, seeded } from "./chronicle";
import { endTimeVisit, pastRoom, reconcileFuture } from "./time-travel";
import { dropKey, dropSupply, dropTimepiece, resolveMeeting } from "./rules";
import { leaveRoom } from "./actions";
import { rooms } from "./registry";
import { captureHistory } from "./history";
import { clampWorld, dropBuildingKeys, walkThroughBuildings } from "./buildings";
import { stationNear } from "./proximity";
import { CARRY_SPEED, CARRY_VIGOR_DRAIN, CART_HELPER_BONUS, CART_MAX_SPEED, CART_PUSH_RANGE, CART_SOLO_SPEED, CELL_HALF, GHOST_SPEED, INTERACT_RANGE, SPEED, STAMINA_IDLE_REGEN, STATIONS, TICK_MS } from "./types";
import type { Room } from "./engine";

const dist = (a: number, b: number) => Math.abs(a - b);
// Sub-unit carry for the supply cart, kept per room object. A replay restores
// into a *new* room object, so its carry starts at zero and replays stay
// deterministic without the field being part of history or persistence.
const cartCarry = new WeakMap<object, number>();
// The same carry for walkers, keyed by the player record.
const stepRemainder = new WeakMap<object, number>();
const g = globalThis as typeof globalThis & { __hollowLoop?: boolean; __hollowTimer?: ReturnType<typeof setTimeout>; __hollowGrid?: number };

// ---------------------------------------------------------------------------
// Authoritative tick loop
// ---------------------------------------------------------------------------

export function tickRoom(room: Room, now: number) {
  const dt = TICK_MS / 1000;
    if (room.timeVisit && (now >= room.timeVisit.endsAt || room.phase !== "playing")) {
      const visitor = room.players.get(room.timeVisit.playerId);
      if (visitor) endTimeVisit(room, visitor, now >= room.timeVisit.endsAt ? "time expired" : "night changed");
      else room.timeVisit = null;
    }
    if (!room.replaying && now - room.createdAt > 6 * 3600_000 && room.players.size === 0) { rooms.delete(room.code); return; }
    if (room.phase === "lobby") {
      // prune souls who have been gone 75s so seats (and the lantern) never rot
      for (const p of [...room.players.values()]) {
        if (p.parked) continue; // a restored seat waits for its player
        if (now - p.lastSeen > 75000) leaveRoom(room.code, p.id);
      }
      // invariant: while anyone is in the lobby, SOMEONE holds the lantern
      const host = [...room.players.values()].find((p) => p.isHost);
      if (!host && room.players.size > 0) {
        const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
        next.isHost = true;
        feed(room, `${next.name} now holds the town lantern (host).`);
      }
      // hand the lantern to someone present if the host went stale
      if (host && now - host.lastSeen > 12000) {
        const fresh = [...room.players.values()]
          .filter((p) => p.id !== host.id && now - p.lastSeen < 8000)
          .sort((a, b) => b.joinedAt - a.joinedAt)[0];
        if (fresh) {
          host.isHost = false;
          fresh.isHost = true;
          feed(room, `${fresh.name} now holds the town lantern (host).`);
        }
      }
      return;
    }
    if (room.phase === "ended") return;

    // The cart follows the majority direction among nearby players actively
    // holding Push + a direction. Ties stop it; hands full of kits cannot push.
    const pushers = room.phase === "playing"
      ? [...room.players.values()].filter((p) => !p.temporalAbsent && p.id !== room.timeVisit?.playerId && p.alive && !p.caged && !p.inside && !p.hasSupply &&
          p.cartHeld && p.dir !== 0 && now - p.lastSeen < 15000 && dist(p.x, room.cartX) <= CART_PUSH_RANGE)
      : [];
    const right = pushers.filter((p) => p.dir > 0);
    const left = pushers.filter((p) => p.dir < 0);
    const team = right.length > left.length ? right : left.length > right.length ? left : [];
    const pushingIds = new Set(team.map((p) => p.id));
    const cartSpeed = Math.min(CART_MAX_SPEED, CART_SOLO_SPEED + Math.max(0, team.length - 1) * CART_HELPER_BONUS);
    room.cartPushers = team.length;
    const prevCartX = room.cartX;
    if (team.length) {
      // World positions stay integers (the wire and the time-travel history both
      // rely on it), so the fractional part of the cart's step carries over to the
      // next tick instead of being lost: rounding the per-tick step to whole units
      // made the cart's real speed depend on the tick rate.
      const carry = cartCarry.get(room) ?? 0;
      const want = carry + cartSpeed * dt;
      const step = Math.trunc(want);
      cartCarry.set(room, want - step);
      if (step > 0) room.cartX = clampWorld(room.cartX + team[0].dir * step, 90);
    }
    const cartDelta = room.cartX - prevCartX;

    for (const p of room.players.values()) {
      if (p.temporalAbsent) continue;
      if (room.replaying && p.temporalVisitor === true) p.lastSeen = now;
      if (room.timeVisit?.playerId === p.id) {
        if (now - p.lastSeen > 15000) { endTimeVisit(room, p, "connection lost"); }
        else {
          const visit = room.timeVisit, shadow = pastRoom(room, visit, now);
          const traveler = shadow?.players.get(visit.visitorId);
          if (traveler) {
            p.x = traveler.x; p.inside = traveler.inside; p.facing = traveler.facing; p.dir = traveler.dir; p.moving = traveler.moving;
            p.stamina = traveler.stamina; p.exhausted = traveler.exhausted; p.hasKey = traveler.hasKey; p.hasSupply = traveler.hasSupply; p.supplyId = traveler.supplyId; p.activeWard = traveler.activeWard;
            continue;
          }
          endTimeVisit(room, p, "history unavailable");
        }
      }
      if (now - p.lastSeen > 15000) { p.dir = 0; p.cartHeld = false; dropTimepiece(room, p); dropKey(room, p); dropSupply(room, p); dropBuildingKeys(room.doors, p.id, p.x, p.inside); } // stale connection releases movement and unique items
      const speed = !p.alive ? GHOST_SPEED : p.hasSupply ? CARRY_SPEED : pushingIds.has(p.id) ? cartSpeed : SPEED;
      p.moving = p.dir !== 0;
      if (p.dir !== 0) p.facing = p.dir;
      const wasX = p.x;
      // Same-direction pushers move by the exact cartDelta so pushers and cart never drift apart.
      const nextX = pushingIds.has(p.id) && team.length && p.dir === team[0].dir
        ? p.x + cartDelta
        : p.x + p.dir * speed * dt;
      if (p.caged && p.cageIndex >= 0) {
        const cx = room.cages[p.cageIndex].x;
        p.x = Math.max(cx - CELL_HALF + 8, Math.min(cx + CELL_HALF - 8, nextX));
      } else if (!p.alive) {
        p.x = clampWorld(nextX);
      } else {
        // round=false: rounding the *step* to whole pixels made every soul jump a
        // flat 2 px per tick (Math.round(190 * 1/120 s) = 2), so walking was
        // really 240 px/s — and at any other tick rate it would be a different
        // speed again. The sub-pixel remainder is kept in the player record and
        // carried into the next tick, so the pace is exact while `x` itself stays
        // an integer (the replay/compare invariant in types.ts).
        const step = walkThroughBuildings(p.x, nextX, p.inside, room.doors, false);
        const want = step.x + (stepRemainder.get(p) ?? 0);
        const whole = Math.trunc(want);
        stepRemainder.set(p, want - whole);
        p.x = whole;
        p.inside = step.inside;
      }
      p.moving = Math.abs(p.x - wasX) > 0.01;
      if (p.alive && !p.caged && p.dir !== 0 && (p.hasSupply || pushingIds.has(p.id))) {
        p.stamina = Math.max(0, p.stamina - CARRY_VIGOR_DRAIN * dt * (pushingIds.has(p.id) ? 1.2 : 1));
        if (p.stamina <= 0) p.exhausted = true;
      }
      if (p.alive) p.match.distance += Math.abs(p.x - wasX);
      // Repair sessions are driven by validated tile moves, never by a held key.
      if (p.activeWard) {
        const task = room.pool.find((t) => t.id === p.activeWard);
        const station = task && STATIONS.find((s) => s.id === task.id);
        if (room.phase !== "playing" || !p.alive || p.caged || p.dir !== 0 ||
            !task?.delivered || task.done || !station || !stationNear(p, station.id, INTERACT_RANGE + 35)) {
          p.activeWard = null;
        }
      }
      if (p.dir === 0) {
        p.stamina = Math.min(1, p.stamina + STAMINA_IDLE_REGEN * dt * (p.activeWard ? 0.5 : 1));
        if (p.exhausted && p.stamina >= 0.2) p.exhausted = false;
      }
    }

    if (room.phase === "meeting" && room.meeting && now >= room.meeting.endsAt) resolveMeeting(room);

    if (room.phase === "playing" && now >= room.nextFlicker) {
      room.flickerAt = now;
      room.nextFlicker = now + 20000 + seeded(room, "flicker-delay") % 25000;
      const lines = [
        "The lanterns flicker. Something passed between them.",
        "Crows lift from the church roof all at once.",
        "A cold wind carries a whisper no one spoke.",
        "Every window in town goes dark for a heartbeat.",
      ];
      feed(room, lines[seeded(room, "flicker-line") % lines.length]);
    }
    if (!room.replaying && room.timeVisit && now - room.timeVisit.lastReconcileAt >= 500) {
      const visit = room.timeVisit, visitor = room.players.get(visit.playerId);
      reconcileFuture(room, visit, now);
      if (visitor && (!visitor.alive || visitor.caged || room.phase !== "playing")) endTimeVisit(room, visitor, "timeline changed");
    }
    captureHistory(room, now);
}

export function tickRooms() {
  for (const room of rooms.values()) {
    const now = roomNow(room);
    if (room.phase === "playing" || room.phase === "meeting") journal(room, "tick", now);
    tickRoom(room, now);
    room.rev++;
    emitRoom(room.code);
  }
}

/** Length of one server tick, for harnesses that drive the loop by hand. */
export const TICK = TICK_MS;

// Drift-corrected scheduler: one tick per slot on a fixed TICK_MS grid. Node
// truncates timer delays to whole milliseconds, so a plain setInterval(TICK_MS)
// at 60/s would run at 62.5/s, and a wall-clock accumulator on top of integer
// timestamps double-ticks every few slots — a visible hitch for a client that
// draws raw server positions. When the loop falls behind (GC, a slow request)
// the missed slots run back-to-back; after a long stall the grid resets instead
// of bursting more than ten ticks at once.
export function tick() {
  tickRooms();
}
function scheduleTick() {
  const now = Date.now();
  if (g.__hollowGrid === undefined || g.__hollowGrid < now - TICK_MS * 10) g.__hollowGrid = now;
  g.__hollowGrid += TICK_MS;
  const delay = Math.max(0, g.__hollowGrid - now);
  g.__hollowTimer = setTimeout(() => { tick(); scheduleTick(); }, delay);
}

/** Deterministic test harness: advances one room by a recorded server tick. */
export function advanceRoomForTest(room: Room, now: number) {
  if (room.phase === "playing" || room.phase === "meeting") journal(room, "tick", now);
  tickRoom(room, now);
}

if (!g.__hollowLoop) {
  g.__hollowLoop = true;
  scheduleTick();
}

