// Per-viewer room snapshot + ETag fingerprint. Depends on the time-travel past
// layer (pastSnapshot/endTimeVisit) and the extracted helper modules.
import { journal, markDirty, roomNow } from "./chronicle";
import { endTimeVisit, pastSnapshot } from "./time-travel";
import { inMeetingArea, killTarget, nearestBody, nearestOccupiedCage, stationNear } from "./proximity";
import { heldPiece, loosePieces, nearTimepiece } from "./timepieces";
import { BUILDINGS, buildingHint, doorX } from "./buildings";
import { canRepair } from "./rules";
import { wardView } from "./wards";
import { snapshotEtag } from "./fingerprint";
import {
  BELL_X, CART_PUSH_RANGE, INTERACT_RANGE, NIGHT_LENGTH_MS, STATIONS, VISION_BLACKOUT, VISION_CREW, VISION_HOLLOW,
  VISION_MARGIN, ix, type Snapshot,
} from "./types";
import type { Room } from "./engine";

const dist = (a: number, b: number) => Math.abs(a - b);

// Indexed once instead of scanned per viewer per tick: snapshot() runs for every
// open stream on every tick (TICK_RATE/s), and Array.find() over six buildings
// times six doors plus a station scan per ward added up under load.
const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

/** The arrow keeps its side until you have moved 12 units past the crossover, so it cannot flicker left/right while you stand beside the cart. */
function cartSide(host: object, cartX: number, meX: number, d: number): number {
  let m = hintMemory.get(host);
  if (!m) { m = {}; hintMemory.set(host, m); }
  const at = m.cartSideAt as number | undefined;
  if (at === undefined || Math.abs(d - at) > 12) { m.cartSide = cartX < meX ? -1 : 1; m.cartSideAt = d; }
  return (m.cartSide as number) ?? 1;
}

/**
 * Hysteresis for proximity booleans: true once `d <= on`, and it stays true
 * until `d > on + slack`. Purely presentational — kept out of the player record
 * so history, persistence and replay never see it.
 */
const hintMemory = new WeakMap<object, Record<string, number | boolean>>();
function sticky(host: object, key: string, d: number, on: number, slack: number): boolean {
  let m = hintMemory.get(host);
  if (!m) { m = {}; hintMemory.set(host, m); }
  if (typeof m[key] === "boolean") {
    const was = m[key] as boolean;
    if (was ? d <= on + slack : d > on) return was; // still inside the slack band: keep the old answer
  }
  const now = d <= on;
  m[key] = now;
  if (now) m[key + "At"] = d;
  return now;
}

// ---------------------------------------------------------------------------
// Snapshot (per-viewer, roles hidden)
// ---------------------------------------------------------------------------

/** ETag for a viewer's snapshot, cached per room revision so 10 pollers share one hash per tick. */
export function roomEtag(room: Room, playerId: string, snap: Snapshot): string {
  const cached = room.etags.get(playerId);
  if (cached && cached.rev === room.rev) return cached.etag;
  const etag = snapshotEtag(snap);
  if (room.etags.size > 32) room.etags.clear();
  room.etags.set(playerId, { rev: room.rev, etag });
  return etag;
}

export function snapshot(room: Room, playerId: string): Snapshot | null {
  const me = room.players.get(playerId);
  if (!me) return null;
  if (me.parked) {
    me.parked = false; // its player just asked for a snapshot
    markDirty(room);
  }
  const now = roomNow(room);
  me.lastSeen = now; // the 100ms state poll IS the presence heartbeat
  if (!room.replaying && !room.temporalShadow && room.phase !== "lobby" && room.phase !== "ended" && now - (me.lastPresenceAt ?? 0) > 30_000) { // presence is journaled at most twice a minute per soul; the poll itself stays the heartbeat
    me.lastPresenceAt = now;
    journal(room, "presence", now, me.id);
  }
  if (!room.temporalShadow && room.timeVisit?.playerId === me.id) {
    if (now >= room.timeVisit.endsAt) endTimeVisit(room, me, "time expired");
    else return pastSnapshot(room, me, room.timeVisit, now);
  }
  const ps = [...room.players.values()];
  const killCd = Math.max(0, me.killAt - now);
  const target = me.role === "hollow" ? killTarget(room, me) : null;
  const ruinTarget = room.pool.find((t) => !t.sabotaged && (t.done || t.delivered) && stationNear(me, t.id));
  const canSabotage = me.role === "hollow" && me.alive && !me.caged &&
    room.phase === "playing" && now >= me.sabotageAt && !!ruinTarget;

  let hint: string | null = null;
  if (me.alive && room.phase !== "lobby") {
    const b = room.phase === "playing" && !me.caged ? nearestBody(room, me) : null;
    const cageIdx = me.hasKey ? nearestOccupiedCage(room, me.x) : -1;
    const ward = room.pool.find((t) => !t.done && stationNear(me, t.id));
    const dropped = !me.inside && room.supplyDrops.some((item) => dist(item.x, me.x) < INTERACT_RANGE);
    // Range hints stick until the player has clearly left the range. Without the
    // slack, standing on the boundary flaps the text on and off several times a
    // second — a glitch that never shows up in a single screenshot — and each
    // flap was a stream frame plus a HUD rewrite.
    const slack = 14;
    const cartRange = sticky(me, "atCart", dist(room.cartX, me.x), INTERACT_RANGE, slack);
    const pushRange = sticky(me, "nearCart", dist(room.cartX, me.x), CART_PUSH_RANGE, slack);
    const atCart = !me.inside && cartRange;
    const nearCart = !me.inside && pushRange;
    if (room.phase === "playing" && me.caged && ps.filter((p) => p.alive).every((p) => p.caged))
      hint = "E — call a vote to free someone";
    else if (cageIdx >= 0) hint = `E — unlock ${room.players.get(room.cages[cageIdx].occupant!)?.name}'s cage`;
    else if (b) hint = `Report ${b.name}'s body`;
    else if (room.phase === "playing" && !me.caged && ward && !ward.delivered && me.hasSupply)
      hint = "E — deliver kit and open repair";
    else if (room.keyX !== null && !me.caged && dist(room.keyX, me.x) < INTERACT_RANGE) hint = "Take the iron key";
    else if (room.phase === "playing" && !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE) hint = "Ring the bell";
    else if (room.phase === "playing" && !me.caged) {
      if (canSabotage) hint = "R — ruin this ward";
      else if (!me.hasSupply && dropped) hint = "E — recover fallen repair kit";
      else if (!me.hasSupply && atCart) hint = "E — take kit · hold Shift + A/D to push";
      else if (ward && !ward.delivered) hint = "Needs kit — find a supply cart";
      else if (ward && ward.delivered) {
        hint = !canRepair(room, me) ? "E — pretend to repair" : me.exhausted
          ? "Spent — stand still and catch your breath" : "E — open the repair puzzle";
      } else if (me.hasSupply && nearCart) hint = "Hands full — G to drop kit, then push";
      else if (me.hasSupply) hint = "Hauling kit (slower) — G to drop";
      else if (nearCart) hint = "Hold Shift + A/D to push the cart";
      else if (room.pool.some((t) => !t.done && !t.delivered)) {
        // The step count is bucketed and the arrow keeps its side until the cart
        // has genuinely crossed over, so this line stops rewriting itself every
        // tick while you walk towards it.
        const d = dist(room.cartX, me.x);
        const side = cartSide(me, room.cartX, me.x, d);
        hint = `Supply cart ${side < 0 ? "←" : "→"} ${Math.min(9999, Math.round(d / 25) * 25)} steps`;
      }
    }
  }

  if (me.alive && !me.caged && room.phase !== "lobby") hint = buildingHint(room.doors, me.id, me.x, me.inside) ?? hint;
  if (me.alive && !me.caged && !me.inside && room.phase === "playing" && nearTimepiece(room, me)) hint = "E — take the timepiece";
  else if (me.alive && heldPiece(room, me.id) && !hint) hint = room.temporalShadow ? "M — travel deeper into the past" : "M — choose a moment in the past";

  const abilityLabel = me.role === "hollow" ? "Kill" : "Ring Bell";
  const abilityReady = me.alive && room.phase === "playing" && (
    me.role === "hollow" ? killCd <= 0 && !!target : !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE + 20
  );

  const doneTasks = room.pool.filter((t) => t.done).length;
  const activeTask = room.phase === "playing" && me.alive && !me.caged && canRepair(room, me)
    ? room.pool.find((t) => t.id === me.activeWard && t.delivered && !t.done)
    : undefined;
  const activeStation = activeTask && STATIONS.find((s) => s.id === activeTask.id);
  const minigame = activeTask?.puzzle && activeStation
    ? wardView(activeTask.id, activeStation.name, activeTask.puzzle, Math.max(0, activeTask.previewUntil - now)) : null;
  const results = room.phase === "ended" ? {
    durationSec: Math.max(0, Math.round((room.endedAt - room.startedAt) / 1000)),
    players: ps.slice().sort((a, b) => a.joinedAt - b.joinedAt).map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role,
      alive: p.alive, caged: p.caged,
      stats: { ...p.match, distance: Math.round(p.match.distance) },
    })),
  } : null;

  // ---- server-side vision: a hacked client cannot wallhack ----
  const blackout = now < room.blackoutUntil;
  const ghostView = !me.alive;
  let vision = ghostView ? 99999
    : room.phase === "meeting" ? 900
    : me.role === "hollow" ? VISION_HOLLOW
    : blackout ? VISION_BLACKOUT
    : VISION_CREW;
  if (room.phase === "lobby" || room.phase === "ended") vision = 99999;
  // Everything the client can put on screen has to arrive. A wide window shows
  // more world than the vision circle reaches, and the darkness overlay's own
  // gradient is still partly transparent out to its edge, so culling at exactly
  // `vision` made figures pop in and out at the rim — and on wide aspect ratios
  // it deleted things sitting in the middle of the picture. `VISION_MARGIN`
  // covers the gradient's visible tail plus a wide viewport; the overlay still
  // hides it all, so nothing is revealed to an honest client.
  const reach = ghostView ? Infinity : vision + VISION_MARGIN;
  const canSee = (x: number) => ghostView || dist(x, me.x) <= reach;

  // proximity dread for the living crew — drives heartbeat / tension audio
  let danger = 0;
  if (me.alive && me.role === "crew" && room.phase === "playing") {
    let nearest = Infinity;
    for (const p of ps) if (p.id !== room.timeVisit?.playerId && p.role === "hollow" && p.alive && !p.caged && p.inside === me.inside) nearest = Math.min(nearest, dist(p.x, me.x));
    danger = Math.max(0, Math.min(1, 1 - nearest / 340));
    if (blackout) danger = Math.max(danger, 0.35);
  }

  // Per-tick values are quantised so an idle town produces an identical
  // snapshot tick after tick: the SSE stream and the 304 poll then send
  // nothing. 1/1000 of a night is 2.4 s; cooldowns are shown as whole
  // seconds (Math.ceil), so sending them rounded up to the second is lossless.
  const nightT = room.phase === "lobby" ? 0.15
    : room.phase === "ended" ? 1
    : room.replaying || !room.startedAt ? 0.5
    : Math.round(Math.min(1, Math.max(0, (now - room.startedAt) / NIGHT_LENGTH_MS)) * 1000) / 1000;
  const coarseMs = (ms: number) => (ms <= 0 ? 0 : Math.ceil(ms / 1000) * 1000);

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    now,
    nightT,
    self: {
      id: me.id,
      role: me.role,
      alive: me.alive,
      caged: me.caged,
      hasKey: me.hasKey,
      hasSupply: me.hasSupply,
      doorKeys: room.doors.filter((d) => d.holder === me.id).map((d) => d.id),
      hasTimepiece: !!heldPiece(room, me.id),
      bellUsed: me.bellUsed,
      killCooldownMs: me.role === "hollow" ? coarseMs(killCd) : 0, // townfolk never see it; the grace timer would churn their stream
      canKill: !!target && killCd <= 0,
      stamina: Math.round(me.stamina * 100) / 100,
      exhausted: me.exhausted,
      blackoutCooldownMs: coarseMs(room.blackoutReadyAt - now),
      canBlackout: me.role === "hollow" && me.alive && room.phase === "playing" && now >= room.blackoutReadyAt,
      sabotageCooldownMs: coarseMs(me.sabotageAt - now),
      canSabotage,
      teammates: me.role === "hollow" ? ps.filter((p) => p.role === "hollow" && p.id !== me.id).map((p) => p.id) : [],
      myVote: me.vote,
    },
    players: ps
      .filter((p) => p.id === me.id || (!p.temporalAbsent && p.id !== room.timeVisit?.playerId && (canSee(p.x) || room.phase === "meeting" || room.phase === "lobby" || room.phase === "ended")))
      .map((p) => {
        const seen = p.id === me.id || canSee(p.x);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          x: seen ? ix(p.x) : -9999, // positions are integers; meeting roster hides them
          facing: p.facing,
          moving: seen && p.moving && p.dir !== 0,
          alive: p.alive,
          caged: p.caged,
          hasKey: seen && p.hasKey,
          hasSupply: seen && p.hasSupply,
          inside: seen ? p.inside : null,
          echo: room.temporalShadow && p.id.startsWith("echo:"),
          hasTimepiece: seen && !!heldPiece(room, p.id),
          doorKeys: seen ? room.doors.filter((door) => door.holder === p.id).map((door) => door.id) : [],
          action: seen && p.actionUntil > now ? { text: p.actionText, until: p.actionUntil } : null,
          voted: p.vote !== null,
          isHost: p.isHost,
          bubble:
            seen && p.bubbleUntil > now && (me.alive ? p.alive : true)
              ? { text: p.bubbleText, until: p.bubbleUntil }
              : null,
        };
      }),
    bodies: room.bodies.filter((b) => canSee(b.x)).map((b) => ({ x: b.x, color: b.color, name: b.name, id: b.id, at: b.at, inside: b.inside })),
    doors: room.doors.map((d) => {
      const b = BUILDING_BY_ID.get(d.id)!;
      const visible = canSee(doorX(b));
      const owner = d.holder ? room.players.get(d.holder) : null;
      return { id: d.id, locked: visible ? d.locked : true, open: visible && d.open,
        keyX: d.keyX !== null && canSee(d.keyX) ? d.keyX : null,
        holder: d.holder === me.id || (owner && canSee(owner.x)) ? d.holder : null };
    }),
    keyX: room.keyX !== null && canSee(room.keyX) ? room.keyX : null,
    notes: room.notes.filter((n) => (n.house ? me.inside === n.house : !me.inside && canSee(n.x))).map((n) => ({ id: n.id, x: n.x, kind: n.kind, house: n.house, author: n.authorName, text: n.text })),
    timepieces: loosePieces(room).filter((tp) => canSee(tp.x)).map((tp) => tp.x),
    timepieceX: (() => { const tp = loosePieces(room).find((t2) => canSee(t2.x)); return tp ? tp.x : null; })(),
    // latest is floored to five-second steps; clamp so a young match never has latest < earliest (the timepiece would silently not open).
    time: room.temporalShadow ? undefined : { mode: "present", earliest: room.history[0]?.at ?? room.startedAt, latest: Math.max(room.history[0]?.at ?? room.startedAt, Math.floor((room.history.at(-1)?.at ?? room.startedAt) / 5000) * 5000) }, // five-second steps: the scrubber label tolerates it, and it keeps the idle stream to a bare clock tick
    supplyDrops: room.supplyDrops.filter((item) => canSee(item.x)).map((item) => item.x),
    cartX: ix(room.cartX),
    cartPushers: room.cartPushers,
    cages: room.cages.map((c) => ({ x: c.x, occupant: c.occupant })),
    tasks: room.pool.map((t) => {
      const st = STATION_BY_ID.get(t.id)!;
      return { id: t.id, name: st.name, x: st.x, inside: st.inside, done: t.done, delivered: t.delivered, sabotaged: t.sabotaged, progress: Math.round(t.progress * 100) / 100 };
    }),
    minigame,
    taskBar: { done: doneTasks, total: room.pool.length },
    meeting: room.meeting
      ? { endsAt: room.meeting.endsAt, reason: room.meeting.reason, inArea: inMeetingArea(me) }
      : null,
    feed: room.feed.slice(-8),
    winner: room.winner,
    winReason: room.winReason,
    results,
    bellAt: room.bellAt,
    flickerAt: room.flickerAt,
    blackoutUntil: room.blackoutUntil,
    danger: Math.round(danger * 100) / 100,
    visionRadius: Math.min(vision, 9999), // the darkness overlay radius; culling reach is larger by VISION_MARGIN
    hint,
    abilityLabel,
    abilityReady,
    hostId: ps.find((p) => p.isHost)?.id ?? "",
    playerCount: ps.length,
  };
}

