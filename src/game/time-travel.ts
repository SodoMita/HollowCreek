// Time travel: the server-owned replay of recorded night snapshots — a single
// temporary past layer per room. Depends on rules/actions for game effects and
// on the snapshot hook for building per-viewer views.
import { randomInt, randomUUID } from "node:crypto";
import { clampWorld, dropBuildingKeys, snapAnchor } from "./buildings";
import { feed, journal, markDirty, record, roomNow, seeded, kitId } from "./chronicle";
import { snapshot, tickRoom } from "./hooks";
import { bumpStats, newMatchStats } from "./stats";
import { canonicalInput } from "./input";
import { cagePlayer, checkWin, dropKey, dropSupply, dropTimepiece } from "./rules";
import { handleInput } from "./actions";
import { captureHistory, frameAt, restoreFrame } from "./history";
import { heldPiece, loosePieces, usedPieces, nearTimepiece } from "./timepieces";
import { inMeetingArea, killTarget, nearestBody, stationNear } from "./proximity";
import { TIME_VISIT_MS, TIMEPIECE_X, type InputBody, type MatchStats, type Snapshot } from "./types";
import type { HistoryEvent, HistoryFrame, JournalEntry, ReplayAction } from "./engine";
import type { P, Room, TimeVisit } from "./engine";

const dist = (a: number, b: number) => Math.abs(a - b);

// ---------------------------------------------------------------------------
// The timepiece: server-owned snapshots and a single temporary past layer.
// History is sampled rather than trusting a client-provided world state.
// ---------------------------------------------------------------------------


export function replayDeparture(room: Room, playerId: string, pieceId?: string) {
  const player = room.players.get(playerId);
  if (!player) return;
  dropKey(room, player); dropSupply(room, player); dropBuildingKeys(room.doors, player.id, player.x, player.inside);
  const spent = pieceId ? room.timepieces.find((tp) => tp.id === pieceId) : undefined;
  if (spent && !spent.consumed) { spent.consumed = true; spent.holder = null; }
  for (const tp of room.timepieces) if (tp.holder === playerId) { tp.consumed = true; tp.holder = null; }
  player.temporalAbsent = true; player.dir = 0; player.cartHeld = false; player.interactHeld = false; player.activeWard = null;
  feed(room, "The timepiece breaks. A soul slips out of the present.");
}

export function replayLeave(room: Room, playerId: string) {
  const player = room.players.get(playerId);
  if (!player) return;
  record(room, player, "leave", { lobby: false });
  dropTimepiece(room, player); dropKey(room, player); dropSupply(room, player); dropBuildingKeys(room.doors, player.id, player.x, player.inside);
  player.dir = 0; player.cartHeld = false; player.activeWard = null; player.lastSeen = 0;
  if (player.isHost) {
    player.isHost = false;
    const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
    if (next) { next.isHost = true; feed(room, `${next.name} now holds the town lantern (host).`); }
  }
}

export function replayReturn(room: Room, playerId: string, visitorId: string, cursor: number, at: number, lastSeen: number) {
  const original = room.players.get(playerId), visitor = room.players.get(visitorId);
  if (!original || !visitor) return;
  const match = mergeMatch(original.match, visitor.match), role = original.role, host = original.isHost;
  if (original.alive && !original.caged && visitor.alive && !visitor.caged) {
    const next = structuredClone(visitor);
    next.id = playerId; next.role = role; next.isHost = host; next.match = match; next.temporalAbsent = false; next.temporalVisitor = false; next.lastSeen = lastSeen;
    next.dir = 0; next.moving = false; next.cartHeld = false; next.interactHeld = false; next.activeWard = null;
    next.killAt = at + Math.max(0, visitor.killAt - cursor); next.sabotageAt = at + Math.max(0, visitor.sabotageAt - cursor);
    next.bubbleUntil = visitor.bubbleUntil ? at + Math.max(0, visitor.bubbleUntil - cursor) : 0;
    next.actionUntil = visitor.actionUntil ? at + Math.max(0, visitor.actionUntil - cursor) : 0;
    Object.assign(original, next);
    for (const door of room.doors) if (door.holder === visitorId) door.holder = playerId;
  } else {
    if (!visitor.alive && original.alive) {
      original.x = visitor.x; original.inside = visitor.inside;
      dropBuildingKeys(room.doors, original.id, original.x, original.inside); dropKey(room, original); dropSupply(room, original);
      original.alive = false; original.caged = false; original.cageIndex = -1; original.inside = null; original.dir = 0;
      const body = room.bodies.find((item) => item.id === visitorId);
      if (body) body.id = playerId;
      else if (!room.bodies.some((item) => item.id === playerId)) room.bodies.push({ x: visitor.x, color: visitor.color, name: visitor.name, id: playerId, at, inside: visitor.inside });
    } else if (visitor.caged && original.alive && !original.caged) cagePlayer(room, original);
    dropBuildingKeys(room.doors, visitor.id, visitor.x, visitor.inside); dropKey(room, visitor); dropSupply(room, visitor);
    original.match = match; original.temporalAbsent = false; original.temporalVisitor = false; original.lastSeen = lastSeen;
    original.dir = 0; original.moving = false; original.cartHeld = false; original.interactHeld = false; original.activeWard = null;
  }
  room.players.delete(visitorId);
  feed(room, `${original.name} returns as the timepiece falls silent.`);
  checkWin(room);
}

export function applyJournalEntry(room: Room, entry: JournalEntry): { ok: boolean; error?: string } | undefined {
  room.replayNow = entry.at; room.activeSeed = entry.seed; room.activeEventId = String(entry.seq);
  if (entry.kind === "tick") tickRoom(room, entry.at);
  else if (entry.kind === "presence" && entry.playerId) { const player = room.players.get(entry.playerId); if (player) player.lastSeen = entry.at; }
  else if (entry.kind === "leave" && entry.playerId) replayLeave(room, entry.playerId);
  else if (entry.kind === "depart" && entry.playerId) replayDeparture(room, entry.playerId, entry.pieceId);
  else if (entry.kind === "return" && entry.playerId && entry.visitorId) replayReturn(room, entry.playerId, entry.visitorId, entry.cursor ?? entry.at, entry.at, entry.lastSeen ?? entry.at);
  else if (entry.kind === "respawn") { room.timepieces.push({ id: `tp${room.timepieces.length}`, x: TIMEPIECE_X, holder: null, consumed: false }); room.timepiecePending = false; }
  else if (entry.kind === "input" && entry.body) return handleInput(room, entry.body);
  return undefined;
}

/** Test hook: nearest pinnable wall/tree anchor to a world x. */
export const snapAnchorForTest = (x: number) => snapAnchor(x);

/** Test hook: the shadow past-world a live visit currently sees at `until`. */
export function simulatePastForTest(room: Room, until: number): Room | null {
  return room.timeVisit ? simulatePast(room, room.timeVisit, until).room : null;
}

/** Internal replay entry point, also used by deterministic regression tests. */
export function replayRecordedState(room: Room, checkpointSeq: number, throughSeq: number): Room | null {
  const frame = room.history.find((item) => item.seq === checkpointSeq);
  if (!frame) return null;
  const replay = restoreFrame(room, frame);
  for (const entry of room.journal) if (entry.seq > frame.seq && entry.seq <= throughSeq) applyJournalEntry(replay, entry);
  return replay;
}

export function visitCursor(visit: TimeVisit, now: number) {
  return Math.min(now, visit.originAt + Math.max(0, now - visit.startedAt));
}

type ReplayTimelineItem = { at: number; rank: number; order: number; original?: JournalEntry; arrival?: { id: string; initial: P }; action?: { id: string; entry: ReplayAction }; consume?: { id: string; entry: ReplayAction }; suspend?: string };

export function timelineItems(room: Room, visit: TimeVisit, until: number): ReplayTimelineItem[] {
  // Sequence numbers are contiguous, so skip the unchanged prefix instead of
  // scanning the entire night on every past frame.
  const items: ReplayTimelineItem[] = [];
  for (let i = visit.base.seq; i < room.journal.length; i++) {
    const entry = room.journal[i];
    if (entry.at > until) break;
    items.push({ at: entry.at, rank: 0, order: entry.seq, original: entry });
  }
  for (const revision of room.revisions) {
    if (revision.originAt >= visit.base.at && revision.originAt <= until) items.push({ at: revision.originAt, rank: 1, order: 0, arrival: { id: revision.visitorId, initial: revision.initial } });
    for (const entry of revision.actions) if (entry.at >= visit.base.at && entry.at <= until) {
      if (entry.body.action === "time_travel") items.push({ at: entry.at, rank: 2, order: entry.order, consume: { id: revision.visitorId, entry } });
      else items.push({ at: entry.at, rank: 2, order: entry.order, action: { id: revision.visitorId, entry } });
    }
    if (revision.endCursor >= visit.base.at && revision.endCursor <= until) items.push({ at: revision.endCursor, rank: 3, order: 0, suspend: revision.visitorId });
  }
  if (visit.originAt <= until) items.push({ at: visit.originAt, rank: 1, order: 1, arrival: { id: visit.visitorId, initial: visit.initial } });
  for (const entry of visit.actions) if (entry.at <= until) {
    if (entry.body.action === "time_travel") items.push({ at: entry.at, rank: 2, order: entry.order, consume: { id: visit.visitorId, entry } });
    else items.push({ at: entry.at, rank: 2, order: entry.order, action: { id: visit.visitorId, entry } });
  }
  return items.sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order);
}

export function applyTimelineItem(sim: Room, item: ReplayTimelineItem): { ok: boolean; error?: string } | undefined {
  if (item.original) return applyJournalEntry(sim, item.original);
  sim.replayNow = item.at;
  if (item.arrival && !sim.players.has(item.arrival.id)) {
    const visitor = structuredClone(item.arrival.initial);
    visitor.id = item.arrival.id; visitor.lastSeen = item.at; visitor.temporalAbsent = false;
    sim.players.set(visitor.id, visitor);
  } else if (item.suspend) {
    const visitor = sim.players.get(item.suspend);
    if (visitor) { visitor.temporalAbsent = true; visitor.dir = 0; visitor.moving = false; visitor.cartHeld = false; }
  } else if (item.consume) {
    // A timepiece used inside the past: the held piece is spent at this moment.
    const tp = sim.timepieces.find((t2) => t2.holder === item.consume!.id && !t2.consumed);
    if (tp) { tp.consumed = true; tp.holder = null; }
    sim.replayNow = item.at;
    return { ok: true };
  } else if (item.action) {
    sim.activeSeed = item.action.entry.seed; sim.activeEventId = `visit:${item.action.id}:${item.action.entry.order}`;
    return handleInput(sim, { ...item.action.entry.body, playerId: item.action.id });
  }
  return undefined;
}

/** Replay real commands and every earlier visit in chronological order. */
export function simulatePast(room: Room, visit: TimeVisit, until: number, resultOrder?: number): { room: Room; result?: { ok: boolean; error?: string } } {
  // Nested time travel: using a timepiece inside the past re-bases the whole
  // visit at that earlier recorded moment, and every recorded action (including
  // the earlier ones) replays forward from there. The visit itself — the causal
  // anchor — is never removed.
  let base = visit.base, originAt = visit.originAt;
  for (const a of visit.actions) {
    if (a.at > until) break;
    if (a.body.action === "time_travel" && typeof a.body.targetAt === "number" && Number.isFinite(a.body.targetAt)) {
      const frame = room.revisions.length ? room.history[0] : frameAt(room, a.body.targetAt);
      if (frame) { base = structuredClone(frame); originAt = a.body.targetAt; }
    }
  }
  const eff: TimeVisit = { ...visit, base, originAt };
  const sim = restoreFrame(room, base);
  sim.replayVisitorId = visit.visitorId;
  let result: { ok: boolean; error?: string } | undefined;
  for (const item of timelineItems(room, eff, until)) {
    const applied = applyTimelineItem(sim, item);
    if (item.action?.id === visit.visitorId && item.action.entry.order === resultOrder) result = applied;
  }
  sim.replayNow = until;
  return { room: sim, result };
}

export function replayFuture(room: Room, visit: TimeVisit, past: Room, cursor: number, now: number): Room {
  const future = structuredClone(past);
  const visitor = future.players.get(visit.visitorId);
  if (visitor) { visitor.temporalAbsent = true; visitor.dir = 0; visitor.moving = false; visitor.cartHeld = false; }
  for (const item of timelineItems(room, visit, now)) if (item.at > cursor) applyTimelineItem(future, item);
  future.replayNow = now;
  return future;
}

export function copyActor(target: P, source: P) {
  const lastSeen = target.lastSeen, joinedAt = target.joinedAt, parked = target.parked, id = target.id;
  Object.assign(target, structuredClone(source), { id, lastSeen, joinedAt, parked, temporalAbsent: false, temporalVisitor: false });
}

export function mergeMatch(original: MatchStats, visit: MatchStats): MatchStats {
  const result = { ...original };
  for (const key of Object.keys(result) as (keyof MatchStats)[]) result[key] += visit[key];
  return result;
}

export function reconcileFuture(room: Room, visit: TimeVisit, now: number, past?: Room) {
  if (visit.reconciling) return;
  visit.reconciling = true;
  try {
    const cursor = visitCursor(visit, now);
    const branch = past ?? simulatePast(room, visit, cursor).room;
    const visitor = branch.players.get(visit.visitorId);
    if (!visitor) return;
    const future = replayFuture(room, visit, branch, cursor, now);
    const originalSelf = future.players.get(visit.playerId), futureVisitor = future.players.get(visit.visitorId);
    // An altered history can kill or cage either incarnation. The present
    // traveler must inherit that outcome rather than being immune to the replay.
    if (originalSelf && !visitor.alive && originalSelf.alive) {
      originalSelf.x = visitor.x; originalSelf.inside = visitor.inside;
      dropBuildingKeys(future.doors, originalSelf.id, originalSelf.x, originalSelf.inside); dropKey(future, originalSelf); dropSupply(future, originalSelf);
      originalSelf.alive = false; originalSelf.caged = false; originalSelf.cageIndex = -1; originalSelf.dir = 0; originalSelf.inside = null;
      const temporalBody = future.bodies.find((body) => body.id === visit.visitorId);
      if (temporalBody) temporalBody.id = originalSelf.id;
      else if (!future.bodies.some((body) => body.id === originalSelf.id)) future.bodies.push({ x: visitor.x, color: visitor.color, name: visitor.name, id: originalSelf.id, at: now, inside: visitor.inside });
      checkWin(future);
    }
    if (originalSelf && futureVisitor && (!originalSelf.alive || originalSelf.caged)) {
      // Belongings carried by the visiting incarnation must not remain reserved
      // by an absent synthetic player after the paradox forces them back.
      dropBuildingKeys(future.doors, futureVisitor.id, futureVisitor.x, futureVisitor.inside);
      dropKey(future, futureVisitor); dropSupply(future, futureVisitor);
    }
    const priorPhase = room.phase;
    const priorFingerprint = JSON.stringify([room.pool.map((task) => [task.done, task.delivered, task.sabotaged]), room.keyX, room.doors.map((door) => [door.locked, door.open, door.holder, door.keyX]), [...room.players.values()].map((player) => [player.id, player.alive, player.caged, player.hasKey, player.supplyId])]);
    const statKeys: [keyof MatchStats, "kills" | "deaths" | "tasksDone" | "cagings" | "unlocks" | "reports" | "blackouts" | "bells"][] = [
      ["kills", "kills"], ["deaths", "deaths"], ["repairs", "tasksDone"], ["timesCaged", "cagings"], ["cagesOpened", "unlocks"], ["reports", "reports"], ["blackouts", "blackouts"], ["bells", "bells"],
    ];
    for (const live of room.players.values()) {
      const simulated = future.players.get(live.id);
      if (!simulated) continue;
      const nextMatch = live.id === visit.playerId ? mergeMatch(simulated.match, visitor.match) : simulated.match;
      const deltas: Record<string, number> = {};
      for (const [field, stat] of statKeys) { const delta = nextMatch[field] - live.match[field]; if (delta) deltas[stat] = delta; }
      if (Object.keys(deltas).length) bumpStats(live.id, live.name, deltas);
      if (live.id === visit.playerId) {
        const observed = structuredClone(!simulated.alive || simulated.caged ? simulated : visitor);
        observed.match = nextMatch; observed.id = live.id; observed.isHost = simulated.isHost;
        // Cooldowns and visible notices are measured on the historical clock while visiting.
        observed.killAt = now + Math.max(0, visitor.killAt - cursor);
        observed.sabotageAt = now + Math.max(0, visitor.sabotageAt - cursor);
        observed.bubbleUntil = visitor.bubbleUntil ? now + Math.max(0, visitor.bubbleUntil - cursor) : 0;
        observed.actionUntil = visitor.actionUntil ? now + Math.max(0, visitor.actionUntil - cursor) : 0;
        copyActor(live, observed);
      } else copyActor(live, simulated);
    }
    room.pool = structuredClone(future.pool);
    room.doors = structuredClone(future.doors).map((door) => ({ ...door, holder: door.holder === visit.visitorId ? visit.playerId : door.holder }));
    room.keyX = future.keyX; room.supplyDrops = structuredClone(future.supplyDrops); room.cartX = future.cartX; room.cartPushers = future.cartPushers;
    room.notes = structuredClone(future.notes).map((note) => note.authorId === visit.visitorId && room.players.get(visit.playerId)
      ? { ...note, authorId: visit.playerId, authorName: room.players.get(visit.playerId)!.name } : note);
    room.cages = structuredClone(future.cages); room.bodies = structuredClone(future.bodies).map((body) => ({ ...body, id: body.id === visit.visitorId ? visit.playerId : body.id }));
    room.feed = structuredClone(future.feed);
    room.blackoutUntil = future.blackoutUntil; room.blackoutReadyAt = future.blackoutReadyAt; room.bellAt = future.bellAt; room.flickerAt = future.flickerAt; room.nextFlicker = future.nextFlicker;
    room.phase = future.phase; room.meeting = structuredClone(future.meeting); room.winner = future.winner; room.winReason = future.winReason; room.endedAt = future.endedAt;
    room.timepieces = structuredClone(future.timepieces);
    // The piece spent at departure predates the visit's base frame, so force it.
    const spent = room.timepieces.find((tp) => tp.id === visit.pieceId);
    if (spent && !spent.consumed) { spent.consumed = true; spent.holder = null; }
    const changed = JSON.stringify([room.pool.map((task) => [task.done, task.delivered, task.sabotaged]), room.keyX, room.doors.map((door) => [door.locked, door.open, door.holder, door.keyX]), [...room.players.values()].map((player) => [player.id, player.alive, player.caged, player.hasKey, player.supplyId])]);
    if (changed !== priorFingerprint) { feed(room, "The past changes; the night reshapes around it."); record(room, room.players.get(visit.playerId) ?? null, "time_replay", { pastAt: cursor }); }
    if (priorPhase !== "ended" && room.phase === "ended" && room.winner) {
      for (const player of room.players.values()) bumpStats(player.id, player.name, { games: 1, wins: player.role === room.winner ? 1 : 0, losses: player.role === room.winner ? 0 : 1, playtimeSec: Math.max(0, Math.round((room.endedAt - room.startedAt) / 1000)) });
      markDirty(room);
    }
    visit.lastReconcileAt = now;
  } finally { visit.reconciling = false; }
}

export function spawnNextTimepiece(room: Room, now: number) {
  if (room.replaying || usedPieces(room) >= 2 || room.phase !== "playing") return;
  if (loosePieces(room).length) { room.timepiecePending = false; return; } // pieces already on the road
  room.timepieces.push({ id: `tp${room.timepieces.length}`, x: TIMEPIECE_X, holder: null, consumed: false });
  room.timepiecePending = false;
  journal(room, "respawn", now);
  feed(room, "Another timepiece settles onto the road.");
}

export function endTimeVisit(room: Room, p: P, reason: string) {
  const visit = room.timeVisit;
  if (!visit || visit.playerId !== p.id) return;
  const now = roomNow(room), cursor = visitCursor(visit, now);
  reconcileFuture(room, visit, now);
  room.timeVisit = null;
  room.revisions.push({ playerId: visit.playerId, visitorId: visit.visitorId, originAt: visit.originAt, startedAt: visit.startedAt, endedAt: now, endCursor: cursor, initial: structuredClone(visit.initial), actions: structuredClone(visit.actions) });
  const entry = journal(room, "return", now, p.id); entry.visitorId = visit.visitorId; entry.cursor = cursor; entry.lastSeen = p.lastSeen;
  p.dir = 0; p.cartHeld = false; p.interactHeld = false; p.activeWard = null;
  feed(room, `${p.name} returns as the timepiece falls silent.`);
  record(room, p, "time_return", { reason, pastAt: cursor });
  if (usedPieces(room) < 2) {
    if (room.phase === "playing") spawnNextTimepiece(room, now);
    else if (room.phase === "meeting") room.timepiecePending = true;
  }
}

export function startTimeVisit(room: Room, p: P, target: unknown): { ok: boolean; error?: string } {
  if (room.phase !== "playing" || !p.alive || p.caged || room.timeVisit || !heldPiece(room, p.id))
    return { ok: false, error: "You need an unused timepiece and a free living soul." };
  const first = room.history[0], last = room.history.at(-1);
  if (!first || !last || typeof target !== "number" || !Number.isFinite(target) || target < first.at || target > last.at)
    return { ok: false, error: "Choose a recorded moment from this night." };
  const frame = room.revisions.length ? room.history[0] : frameAt(room, target);
  if (!frame) return { ok: false, error: "That moment is not recorded." };
  const now = roomNow(room), killCooldown = Math.max(0, p.killAt - now), sabotageCooldown = Math.max(0, p.sabotageAt - now);
  const piece = heldPiece(room, p.id)!;
  const depart = journal(room, "depart", now, p.id); depart.pieceId = piece.id;
  dropKey(room, p); dropSupply(room, p); dropBuildingKeys(room.doors, p.id, p.x, p.inside);
  piece.consumed = true; piece.holder = null;
  const visitorId = `visit:${p.id}:${usedPieces(room)}:${now}`;
  const initial = structuredClone(p);
  initial.id = visitorId; initial.temporalVisitor = true; initial.match = newMatchStats(); initial.dir = 0; initial.cartHeld = false; initial.interactHeld = false; initial.activeWard = null;
  initial.killAt = target + killCooldown; initial.sabotageAt = target + sabotageCooldown; initial.bubbleUntil = 0; initial.actionUntil = 0; initial.isHost = false;
  room.timeVisit = { playerId: p.id, visitorId, pieceId: piece.id, originAt: target, startedAt: now, endsAt: now + TIME_VISIT_MS,
    base: structuredClone(frame), initial, actions: [], lastReconcileAt: now, reconciling: false };
  p.dir = 0; p.cartHeld = false; p.interactHeld = false; p.activeWard = null;
  feed(room, "The timepiece breaks. A soul slips out of the present.");
  record(room, p, "time_depart", { pastAt: target });
  return { ok: true };
}

export function pastRoom(room: Room, visit: TimeVisit, now: number): Room | null {
  return simulatePast(room, visit, visitCursor(visit, now)).room;
}

export function handlePastInput(room: Room, p: P, body: InputBody): { ok: boolean; error?: string } {
  const visit = room.timeVisit;
  if (!visit || visit.playerId !== p.id) return { ok: false, error: "The past has closed." };
  const now = roomNow(room);
  if (now >= visit.endsAt || body.action === "time_return") { endTimeVisit(room, p, now >= visit.endsAt ? "time expired" : "returned early"); return { ok: true }; }
  if (body.action === "start" || body.action === "restart") return { ok: false, error: "That action is unavailable while traveling." };
  const cursor = visitCursor(visit, now), order = visit.actions.length + 1;
  if (body.action === "time_travel") {
    // Time travel in time travel: allowed only with an unused timepiece that
    // exists in the past (picked up there), targeting an earlier recorded moment.
    const target = body.targetAt;
    const first = room.history[0], last = room.history.at(-1);
    if (!first || !last || typeof target !== "number" || !Number.isFinite(target) || target < first.at || target > Math.min(cursor, last.at))
      return { ok: false, error: "Choose an earlier recorded moment from this night." };
    const sim = simulatePast(room, visit, cursor).room;
    if (!heldPiece(sim, visit.visitorId)) return { ok: false, error: "You need an unused timepiece in this moment." };
  }
  const normalized = { ...canonicalInput(body), playerId: visit.visitorId };
  if (typeof normalized.vote === "string") normalized.vote = normalized.vote.replace(/^echo:/, "").replace(/^free:echo:/, "free:");
  visit.actions.push({ at: cursor, order, seed: randomInt(1, 0x7fffffff), body: normalized });
  const simulated = simulatePast(room, visit, cursor, order);
  reconcileFuture(room, visit, now, simulated.room);
  if (room.timeVisit === visit && (!p.alive || p.caged || room.phase !== "playing")) endTimeVisit(room, p, "timeline changed");
  return simulated.result ?? { ok: true };
}

export function pastSnapshot(room: Room, p: P, visit: TimeVisit, now: number): Snapshot | null {
  const cursor = visitCursor(visit, now), shadow = simulatePast(room, visit, cursor).room;
  const view = snapshot(shadow, visit.visitorId);
  if (!view) return null;
  const shift = now - cursor;
  view.players = view.players.map((player) => ({ ...player,
    id: player.id === visit.visitorId ? p.id : `echo:${player.id}`,
    echo: player.id !== visit.visitorId,
    bubble: player.bubble ? { ...player.bubble, until: player.bubble.until + shift } : null,
    action: player.action ? { ...player.action, until: player.action.until + shift } : null,
  }));
  view.cages = view.cages.map((cage) => ({ ...cage, occupant: cage.occupant ? (cage.occupant === visit.visitorId ? p.id : `echo:${cage.occupant}`) : null }));
  view.doors = view.doors?.map((door) => ({ ...door, holder: door.holder ? (door.holder === visit.visitorId ? p.id : `echo:${door.holder}`) : null }));
  view.bodies = view.bodies.map((body) => ({ ...body, at: body.at ? body.at + shift : 0 }));
  view.feed = view.feed.map((item) => ({ ...item, at: item.at + shift }));
  const labels: Record<string, string> = { pickup_key: "picked up the iron key", supply_taken: "took a repair kit", supply_recovered: "recovered a repair kit", supply_delivered: "delivered a kit", task_complete: "completed a ward", ward_ruined: "ruined a ward", kill: "struck someone", unlock_cage: "opened a cage", timepiece_taken: "took the timepiece", pin_note: "pinned a page" };
  const label = (event: HistoryEvent) => event.type === "door_action" && typeof event.data.message === "string" && event.data.message.includes("found")
    ? event.data.message.replace(/^You found /, "took ").replace(/\.$/, "") : labels[event.type];
  const witnessed = shadow.historyEvents.filter((event) => event.at <= cursor && event.at >= cursor - 8000 && event.actorId !== visit.visitorId && event.inside === p.inside && dist(event.x, p.x) <= view.visionRadius && label(event)).slice(-4)
    .map((event) => ({ text: `Past echo: ${event.name} ${label(event)}.`, at: now - (cursor - event.at) }));
  view.feed = [...view.feed, ...witnessed].slice(-8);
  view.self.id = p.id; view.self.hasTimepiece = !!heldPiece(shadow, visit.visitorId);
  view.self.teammates = view.self.teammates.map((id) => id === visit.visitorId ? p.id : `echo:${id}`);
  view.now = now;
  view.bellAt = view.bellAt ? view.bellAt + shift : 0; view.flickerAt = view.flickerAt ? view.flickerAt + shift : 0; view.blackoutUntil = view.blackoutUntil ? view.blackoutUntil + shift : 0;
  if (view.meeting) view.meeting.endsAt += shift;
  view.time = { mode: "past", earliest: room.history[0]?.at ?? visit.originAt, latest: room.history.at(-1)?.at ?? visit.originAt, cursor, endsAt: visit.endsAt };
  view.hostId = [...room.players.values()].find((item) => item.isHost)?.id ?? ""; view.playerCount = room.players.size;
  return view;
}

