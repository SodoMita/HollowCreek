// Persistence — the same players repeat in the same room even across a server
// restart. Writes are queued and flushed on an interval so the tick loop never
// waits on the database. Also owns the chronicle retention prune.
import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { gameEvents, roomPlayers, roomRows } from "@/db/schema";
import { dirtyRooms, feed, gPersist, record } from "./chronicle";
import { newMatchStats } from "./stats";
import { roomLoads, rooms } from "./registry";
import { newDoors } from "./buildings";
import { BELL_X, CAGE_XS, SUPPLY_CART_START } from "./types";
import type { Room } from "./engine";

// ---------------------------------------------------------------------------



export async function flushRooms() {
  const codes = [...dirtyRooms];
  dirtyRooms.clear();
  for (const code of codes) {
    const room = rooms.get(code);
    if (!room) continue;
    try {
      await db
        .insert(roomRows)
        .values({ code: room.code, phase: room.phase, round: room.round, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: roomRows.code,
          set: { phase: room.phase, round: room.round, updatedAt: new Date() },
        });
      const roster = [...room.players.values()];
      if (roster.length) {
        await db
          .insert(roomPlayers)
          .values(roster.map((p) => ({ id: p.id, code, name: p.name, color: p.color, joinedAt: new Date(p.joinedAt) })))
          .onConflictDoUpdate({
            target: roomPlayers.id,
            set: { name: sql`excluded.name`, color: sql`excluded.color`, joinedAt: sql`excluded.joined_at` },
          });
        await db
          .delete(roomPlayers)
          .where(and(eq(roomPlayers.code, code), notInArray(roomPlayers.id, roster.map((p) => p.id))));
      } else {
        await db.delete(roomPlayers).where(eq(roomPlayers.code, code));
      }
    } catch (e) {
      console.error("room persist failed", code, e);
    }
  }
}

// Chronicle rows older than 30 days are pruned once an hour — the table grows
// with every observed action otherwise.
let lastChroniclePrune = 0;
export async function pruneChronicle() {
  const now = Date.now();
  if (now - lastChroniclePrune < 3_600_000) return;
  lastChroniclePrune = now;
  try {
    await db.delete(gameEvents).where(lt(gameEvents.createdAt, new Date(now - 30 * 86_400_000)));
  } catch (e) {
    console.error("chronicle prune failed", e);
  }
}

if (!gPersist.__hollowPersistTimer) {
  gPersist.__hollowPersistTimer = setInterval(() => { void flushRooms(); void pruneChronicle(); }, 900);
}

/** Bring a town back from Postgres: same code, same seats, same names. */
export async function loadRoom(code: string): Promise<Room | undefined> {
  const key = code.toUpperCase();
  const existing = rooms.get(key);
  if (existing) return existing;
  const pending = roomLoads.get(key);
  if (pending) return pending;
  const loading = hydrateRoom(key);
  roomLoads.set(key, loading);
  try {
    return await loading;
  } finally {
    if (roomLoads.get(key) === loading) roomLoads.delete(key);
  }
}

async function hydrateRoom(code: string): Promise<Room | undefined> {
  const key = code.toUpperCase();
  const existing = rooms.get(key);
  if (existing) return existing;
  let round = 0;
  let roster: { id: string; name: string; color: string; joinedAt: Date }[] = [];
  try {
    const rows = await db.select().from(roomRows).where(eq(roomRows.code, key)).limit(1);
    if (!rows.length) return undefined;
    round = rows[0].round ?? 0;
    roster = await db.select().from(roomPlayers).where(eq(roomPlayers.code, key));
  } catch (e) {
    console.error("room load failed", key, e);
    return undefined;
  }
  const room: Room = {
    code: key,
    // a night interrupted by a restart is over; the same people simply gather again
    phase: "lobby",
    round,
    timepieces: [], timepiecePending: false, revisions: [],
    history: [], historyEvents: [], journal: [], journalSeq: 0, activeSeed: 1, activeEventId: "", lastHistoryAt: 0, timeVisit: null, rev: 0, etags: new Map(),
    players: new Map(),
    bodies: [],
    doors: newDoors(),
    keyX: null,
    supplyDrops: [],
    notes: [],
    cartX: SUPPLY_CART_START,
    cartPushers: 0,
    cages: CAGE_XS.map((x) => ({ x, occupant: null })),
    feed: [],
    meeting: null,
    winner: null,
    winReason: null,
    bellAt: 0,
    flickerAt: 0,
    nextFlicker: Date.now() + 20000,
    createdAt: Date.now(),
    startedAt: 0,
    endedAt: 0,
    pool: [],
    blackoutUntil: 0,
    blackoutReadyAt: 0,
  };
  const seated = roster.slice().sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  seated.forEach((pr, i) => {
    room.players.set(pr.id, {
      id: pr.id,
      name: pr.name,
      color: pr.color,
      x: BELL_X + (i - 1) * 60,
      dir: 0,
      facing: 1,
      moving: false,
      alive: true,
      caged: false,
      cageIndex: -1,
      inside: null,
      role: "crew",
      stamina: 1,
      exhausted: false,
      killAt: 0,
      bellUsed: false,
      hasKey: false,
      hasSupply: false,
      supplyId: null,
      cartHeld: false,
      sabotageAt: 0,
      match: newMatchStats(),
      bubbleText: "",
      bubbleUntil: 0,
      actionText: "", actionUntil: 0,
      interactHeld: false,
      activeWard: null,
      lastSeen: 0,
      joinedAt: pr.joinedAt.getTime(),
      vote: null,
      isHost: false,
      parked: true,
    });
  });
  // the newest returning player holds the lantern
  const newest = seated[seated.length - 1];
  if (newest) {
    const p = room.players.get(newest.id);
    if (p) p.isHost = true;
  }
  rooms.set(key, room);
  feed(room, "The town remembers everyone who has walked this street.");
  record(room, null, "room_restored", { seats: seated.length, round });
  dirtyRooms.add(key);
  return room;
}


