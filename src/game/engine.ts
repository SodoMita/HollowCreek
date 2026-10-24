import { db } from "@/db";
import { gameEvents, roomRows, roomPlayers } from "@/db/schema";
import { desc, eq, lt } from "drizzle-orm";
import {
  BELL_X, BLACKOUT_CD_MS, BLACKOUT_MS, BUBBLE_MS, CAGE_XS, CELL_HALF,
  CART_HELPER_BONUS, CART_MAX_SPEED, CART_PUSH_RANGE, CART_SOLO_SPEED,
  CARRY_SPEED, CARRY_VIGOR_DRAIN, GHOST_SPEED, INTERACT_RANGE, KILL_COOLDOWN_MS,
  KILL_RANGE, MEETING_FROM, MEETING_MS, MEETING_TO, PLAYER_COLORS,
  SABOTAGE_COOLDOWN_MS, SABOTAGE_VIGOR_COST, SPEED, STAMINA_BELL_COST,
  STAMINA_BLACKOUT_COST, STAMINA_IDLE_REGEN, STAMINA_KILL_COST,
  STAMINA_SLOW_THRESHOLD, STAMINA_UNLOCK_COST, STAMINA_WORK_DRAIN,
  STATIONS, SUPPLY_CART_START, TASK_HOLD_MS, TICK_MS,
  VISION_BLACKOUT, VISION_CREW, VISION_HOLLOW, WORLD_W,
} from "./types";
import { bumpStats } from "./stats";
import { shuffle } from "./rng";
import type { FeedItem, InputBody, Phase, Role, RoomListing, Snapshot } from "./types";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TaskState { id: string; done: boolean; delivered: boolean; sabotaged: boolean; progress: number }

interface P {
  id: string;
  name: string;
  color: string;
  x: number;
  dir: number; // last INPUT direction (-1 | 0 | 1). Clients never send positions.
  facing: number;
  moving: boolean;
  alive: boolean;
  caged: boolean;
  cageIndex: number;
  role: Role;
  stamina: number;
  exhausted: boolean;
  killAt: number;
  bellUsed: boolean;
  hasKey: boolean;
  hasSupply: boolean;
  cartHeld: boolean;
  sabotageAt: number;
  bubbleText: string;
  bubbleUntil: number;
  interactHeld: boolean;
  lastSeen: number;
  joinedAt: number;
  vote: string | null;
  isHost: boolean;
  /** true for a seat restored from the database that nobody has claimed yet */
  parked: boolean;
}

interface Room {
  code: string;
  phase: Phase;
  players: Map<string, P>;
  bodies: { x: number; color: string; name: string; id: string }[];
  keyX: number | null;
  supplyDrops: number[];
  cartX: number;
  cartPushers: number;
  cages: { x: number; occupant: string | null }[];
  feed: FeedItem[];
  meeting: { endsAt: number; reason: string } | null;
  winner: Role | null;
  winReason: string | null;
  bellAt: number;
  flickerAt: number;
  nextFlicker: number;
  createdAt: number;
  startedAt: number;
  /** Shared town wards — any living townfolk may work any of them. */
  pool: TaskState[];
  blackoutUntil: number;
  blackoutReadyAt: number;
  round: number;
}

const g = globalThis as typeof globalThis & {
  __hollowRooms?: Map<string, Room>;
  __hollowRoomLoads?: Map<string, Promise<Room | undefined>>;
  __hollowLoop?: ReturnType<typeof setInterval>;
};
const rooms: Map<string, Room> = g.__hollowRooms ?? new Map();
g.__hollowRooms = rooms;
// Concurrent join/state requests after a restart must share one hydration.
// Otherwise each request can build a room and overwrite the previous one,
// leaving a player whose join already succeeded as "Unknown soul".
const roomLoads: Map<string, Promise<Room | undefined>> = g.__hollowRoomLoads ?? new Map();
g.__hollowRoomLoads = roomLoads;

// ---------------------------------------------------------------------------
// Chronicle — every player action is persisted
// ---------------------------------------------------------------------------

function record(room: Room, p: P | null, type: string, data: Record<string, unknown> = {}) {
  db.insert(gameEvents)
    .values({
      roomCode: room.code,
      playerId: p?.id ?? null,
      playerName: p?.name ?? null,
      type,
      data: { phase: room.phase, x: p ? Math.round(p.x) : undefined, ...data },
    })
    .catch((e) => console.error("chronicle write failed", e));
}

// ---------------------------------------------------------------------------
// Persistence — the same players repeat in the same room even across a server
// restart. Writes are queued and flushed on an interval so the tick loop never
// waits on the database.
// ---------------------------------------------------------------------------

const gPersist = globalThis as typeof globalThis & {
  __hollowDirtyRooms?: Set<string>;
  __hollowPersistTimer?: ReturnType<typeof setInterval>;
};
const dirtyRooms: Set<string> = gPersist.__hollowDirtyRooms ?? new Set();
gPersist.__hollowDirtyRooms = dirtyRooms;

function markDirty(room: Room) {
  dirtyRooms.add(room.code);
}

async function flushRooms() {
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
      await db.delete(roomPlayers).where(eq(roomPlayers.code, code));
      if (roster.length) {
        await db.insert(roomPlayers).values(
          roster.map((p) => ({
            id: p.id,
            code,
            name: p.name,
            color: p.color,
            joinedAt: new Date(p.joinedAt),
          }))
        );
      }
    } catch (e) {
      console.error("room persist failed", code, e);
    }
  }
}

if (!gPersist.__hollowPersistTimer) {
  gPersist.__hollowPersistTimer = setInterval(() => void flushRooms(), 900);
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
    players: new Map(),
    bodies: [],
    keyX: null,
    supplyDrops: [],
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
      role: "crew",
      stamina: 1,
      exhausted: false,
      killAt: 0,
      bellUsed: false,
      hasKey: false,
      hasSupply: false,
      cartHeld: false,
      sabotageAt: 0,
      bubbleText: "",
      bubbleUntil: 0,
      interactHeld: false,
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

function feed(room: Room, text: string) {
  room.feed.push({ text, at: Date.now() });
  if (room.feed.length > 24) room.feed.shift();
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

function makeCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(playerId: string, name: string) {
  const room: Room = {
    code: makeCode(),
    phase: "lobby",
    players: new Map(),
    bodies: [],
    keyX: null,
    supplyDrops: [],
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
    pool: [],
    blackoutUntil: 0,
    blackoutReadyAt: 0,
    round: 0,
  };
  rooms.set(room.code, room);
  markDirty(room);
  record(room, null, "room_created", {});
  joinRoom(room.code, playerId, name);
  feed(room, "The town of Hollow Creek waits under a bruised October sky…");
  return room.code;
}

export function joinRoom(code: string, playerId: string, rawName: string): { ok: boolean; error?: string; playerId?: string } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false, error: "No such town. Check the code." };
  const now = Date.now();
  const existing = room.players.get(playerId);
  if (existing) {
    existing.lastSeen = now;
    if (existing.parked) {
      existing.parked = false;
      feed(room, `${existing.name} is back on the street.`);
      record(room, existing, "seat_claimed", {});
      markDirty(room);
    }
    return { ok: true, playerId };
  }
  if (room.phase !== "lobby" && room.phase !== "ended") {
    return { ok: false, error: "This tale has already begun." };
  }
  const name = (rawName || "Stranger").trim().slice(0, 14) || "Stranger";
  // Re-adoption: someone returning under the same name takes over their old
  // (stale) seat instead of spawning a duplicate "name-2" stranger.
  // Allowed in lobby AND after the tale ended, so the same souls can regather.
  const staleSeat = [...room.players.values()].find(
    (q) => q.name.toLowerCase() === name.toLowerCase() && now - q.lastSeen > 8000
  );
  if (staleSeat) {
    room.players.delete(staleSeat.id);
    const oldId = staleSeat.id;
    staleSeat.id = playerId;
    staleSeat.lastSeen = now;
    staleSeat.joinedAt = now;
    staleSeat.parked = false;
    room.players.set(playerId, staleSeat);
    record(room, staleSeat, "rejoin", { oldId });
    feed(room, `${staleSeat.name} returned to town.`);
    return { ok: true, playerId };
  }
  if (room.phase === "ended") {
    return { ok: false, error: "This town's night is over — only its own souls may return." };
  }
  if (room.players.size >= 10) return { ok: false, error: "The town is full (10 souls)." };
  const used = new Set([...room.players.values()].map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  const p: P = {
    id: playerId,
    name,
    color,
    x: BELL_X + (room.players.size - 2) * 60,
    dir: 0,
    facing: 1,
    moving: false,
    alive: true,
    caged: false,
    cageIndex: -1,
    role: "crew",
    stamina: 1,
    exhausted: false,
    killAt: 0,
    bellUsed: false,
    hasKey: false,
    hasSupply: false,
    cartHeld: false,
    sabotageAt: 0,
    bubbleText: "",
    bubbleUntil: 0,
    interactHeld: false,
    lastSeen: Date.now(),
    joinedAt: Date.now(),
    vote: null,
    isHost: true,
    parked: false, // the lantern always passes to the LAST joiner
  };
  const previousHost = [...room.players.values()].find((q) => q.isHost);
  if (previousHost) {
    previousHost.isHost = false;
    feed(room, `${name} takes the town lantern (host).`);
  }
  room.players.set(playerId, p);
  markDirty(room);
  feed(room, `${name} arrived in Hollow Creek.`);
  record(room, p, "join", {});
  return { ok: true, playerId };
}

/** Explicit leave (button or sendBeacon on tab close). Lobby: removed + host
 *  promoted to the NEWEST remaining joiner (most likely to be present).
 *  In-game: seat is kept (roles must persist), but the lantern passes on. */
export function leaveRoom(code: string, playerId: string): { ok: boolean } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false };
  markDirty(room);
  const p = room.players.get(playerId);
  if (!p) return { ok: false };
  record(room, p, "leave", { lobby: room.phase === "lobby" });
  if (room.phase !== "lobby") dropSupply(room, p);
  if (room.phase === "lobby") {
    room.players.delete(playerId);
    feed(room, `${p.name} turned back down the old road.`);
  } else {
    p.dir = 0;
    p.cartHeld = false;
    p.lastSeen = 0;
  }
  if (p.isHost) {
    p.isHost = false;
    const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
    if (next) {
      next.isHost = true;
      feed(room, `${next.name} now holds the town lantern (host).`);
    }
  }
  return { ok: true };
}

export function startGame(room: Room, playerId: string): { ok: boolean; error?: string } {
  markDirty(room);
  const host = room.players.get(playerId);
  if (!host?.isHost) return { ok: false, error: "Only the host may begin." };
  if (room.phase !== "lobby") return { ok: false, error: "Already begun." };
  if (room.players.size < 4) return { ok: false, error: "At least 4 souls are needed." };

  const ps = [...room.players.values()];
  const shuffled = shuffle(ps); // uniform Fisher–Yates — every seat equally likely
  const hollowCount = ps.length >= 6 ? 2 : 1;
  shuffled.forEach((p, i) => {
    p.role = i < hollowCount ? "hollow" : "crew";
    p.x = 300 + Math.random() * (WORLD_W - 600);
    p.killAt = Date.now() + 10000;
  });
  // Shared pool: the town's wards belong to everyone. A death never orphans
  // a chore, and nothing is redistributed — anyone living can work anything.
  // Every ward is visibly broken at dusk. The shared pool has a task for every
  // structure, so nothing magically repairs itself when the night begins.
  room.pool = STATIONS.map(({ id }) => ({ id, done: false, delivered: false, sabotaged: false, progress: 0 }));
  room.supplyDrops = [];
  room.cartX = SUPPLY_CART_START;
  room.cartPushers = 0;
  for (const p of ps) { p.stamina = 1; p.exhausted = false; p.hasSupply = false; p.cartHeld = false; p.sabotageAt = 0; }
  room.startedAt = Date.now();
  room.round += 1;
  // The cage key hides somewhere on the outskirts.
  room.keyX = Math.random() < 0.5 ? 150 + Math.random() * 1400 : 2700 + Math.random() * 1350;
  room.phase = "playing";
  room.nextFlicker = Date.now() + 15000 + Math.random() * 15000;
  feed(room, "Night falls. The wards are broken: take kits from the one cart, deliver them, then hold E to repair. Push together to move the cart faster.");
  feed(room, "Something wearing a human shape walks among you.");
  record(room, null, "game_start", { players: ps.map((p) => ({ id: p.id, name: p.name, role: p.role })) });
  checkWin(room);
  return { ok: true };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

/**
 * Room browser, backed by Postgres: towns survive a restart, so the menu can
 * offer a town that is not currently in memory.
 */
export async function listRooms(): Promise<RoomListing[]> {
  // let go of towns nobody has touched for a week
  try {
    await db.delete(roomRows).where(lt(roomRows.updatedAt, new Date(Date.now() - 7 * 24 * 3600_000)));
  } catch {
    /* non-fatal */
  }
  const out = new Map<string, RoomListing>();
  try {
    const rows = await db
      .select({
        code: roomRows.code,
        round: roomRows.round,
        updatedAt: roomRows.updatedAt,
        name: roomPlayers.name,
      })
      .from(roomRows)
      .leftJoin(roomPlayers, eq(roomPlayers.code, roomRows.code))
      .orderBy(desc(roomRows.updatedAt))
      .limit(24);
    for (const r of rows) {
      const cur = out.get(r.code) ?? {
        code: r.code,
        phase: "lobby" as Phase,
        playerCount: 0,
        hostName: "—",
        names: [],
        createdAt: r.updatedAt.getTime(),
        round: r.round,
      };
      if (r.name) cur.names.push(r.name);
      cur.playerCount = cur.names.length;
      out.set(r.code, cur);
    }
  } catch (e) {
    console.error("room list failed", e);
  }
  // live rooms win: their phase and roster are current
  for (const r of rooms.values()) {
    if (r.players.size === 0) continue;
    const ps = [...r.players.values()];
    out.set(r.code, {
      code: r.code,
      phase: r.phase,
      playerCount: ps.length,
      hostName: ps.find((p) => p.isHost)?.name ?? "—",
      names: ps.map((p) => p.name),
      createdAt: r.createdAt,
      round: r.round,
    });
  }
  return [...out.values()]
    .filter((r) => r.playerCount > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24);
}

/** Live room browser — open towns on the map. */
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

/** The same souls gather in the same town for another night. */
export function restartGame(room: Room, playerId: string): { ok: boolean; error?: string } {
  markDirty(room);
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  if (!p.isHost) {
    // if the lantern-bearer never came back, a present soul may claim it
    const host = [...room.players.values()].find((q) => q.isHost);
    if (host && Date.now() - host.lastSeen > 12000) {
      host.isHost = false;
      p.isHost = true;
      feed(room, `${p.name} picked up the fallen lantern (host).`);
    } else {
      return { ok: false, error: "Only the lantern-bearer may gather the town." };
    }
  }
  if (room.phase !== "ended") return { ok: false, error: "The night is not over yet." };
  let i = 0;
  for (const q of room.players.values()) {
    q.x = BELL_X + (i++ - 2) * 60;
    q.dir = 0;
    q.facing = 1;
    q.moving = false;
    q.alive = true;
    q.caged = false;
    q.cageIndex = -1;
    q.role = "crew";
    q.stamina = 1;
    q.exhausted = false;
    q.killAt = 0;
    q.bellUsed = false;
    q.hasKey = false;
    q.hasSupply = false;
    q.cartHeld = false;
    q.sabotageAt = 0;
    q.bubbleText = "";
    q.bubbleUntil = 0;
    q.interactHeld = false;
    q.vote = null;
  }
  room.bodies = [];
  room.keyX = null;
  room.supplyDrops = [];
  room.cartX = SUPPLY_CART_START;
  room.cartPushers = 0;
  for (const c of room.cages) c.occupant = null;
  room.meeting = null;
  room.winner = null;
  room.winReason = null;
  room.blackoutUntil = 0;
  room.blackoutReadyAt = 0;
  room.pool = [];
  room.phase = "lobby";
  feed(room, "The town gathers again. The same faces… but who will wear them tonight?");
  record(room, p, "restart", { round: room.round + 1 });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dist = (a: number, b: number) => Math.abs(a - b);
const inMeetingArea = (p: P) => p.caged || (p.x >= MEETING_FROM && p.x <= MEETING_TO);

function nearestBody(room: Room, p: P) {
  let best: Room["bodies"][number] | null = null;
  for (const b of room.bodies) if (dist(b.x, p.x) < INTERACT_RANGE + 20 && (!best || dist(b.x, p.x) < dist(best.x, p.x))) best = b;
  return best;
}

function killTarget(room: Room, p: P): P | null {
  let best: P | null = null;
  for (const t of room.players.values()) {
    if (t.id === p.id || !t.alive || t.role === "hollow") continue;
    if (dist(t.x, p.x) <= KILL_RANGE && (!best || dist(t.x, p.x) < dist(best.x, p.x))) best = t;
  }
  return best;
}

function dropKey(room: Room, p: P) {
  if (p.hasKey) {
    p.hasKey = false;
    room.keyX = Math.max(60, Math.min(WORLD_W - 60, p.x));
  }
}

function dropSupply(room: Room, p: P) {
  if (!p.hasSupply) return;
  p.hasSupply = false;
  room.supplyDrops.push(Math.max(30, Math.min(WORLD_W - 30, p.x)));
  // Carts can always provide more; don't retain unbounded abandoned kits.
  if (room.supplyDrops.length > 24) room.supplyDrops.shift();
}

function cagePlayer(room: Room, p: P): boolean {
  const idx = room.cages.findIndex((c) => c.occupant === null);
  if (idx === -1) return false;
  room.cages[idx].occupant = p.id;
  p.caged = true;
  p.cageIndex = idx;
  p.x = room.cages[idx].x;
  p.dir = 0;
  dropKey(room, p);
  dropSupply(room, p);
  return true;
}

function freePlayer(room: Room, p: P) {
  if (!p.caged) return;
  room.cages[p.cageIndex].occupant = null;
  p.caged = false;
  p.cageIndex = -1;
}

function beginMeeting(room: Room, reason: string, caller: P | null) {
  room.phase = "meeting";
  room.cartPushers = 0;
  room.blackoutUntil = 0; // the gathering rekindles the lanterns
  room.meeting = { endsAt: Date.now() + MEETING_MS, reason };
  room.bellAt = Date.now();
  for (const p of room.players.values()) { p.vote = null; p.interactHeld = false; p.cartHeld = false; }
  feed(room, "🔔 The bell tolls. All souls must walk to the square.");
  record(room, caller, "meeting_start", { reason });
}

function doKill(room: Room, killer: P, victim: P) {
  victim.alive = false;
  victim.dir = 0;
  dropKey(room, victim);
  dropSupply(room, victim);
  freePlayer(room, victim); // a killed prisoner dies inside the cell; body remains there
  room.bodies.push({ x: victim.x, color: victim.color, name: victim.name, id: victim.id });
  killer.killAt = Date.now() + KILL_COOLDOWN_MS;
  killer.stamina = Math.max(0, killer.stamina - STAMINA_KILL_COST);
  killer.x = victim.x; // lunge
  feed(room, "A scream cuts through the fog, then silence.");
  record(room, killer, "kill", { victim: victim.name, victimId: victim.id, victimCaged: victim.caged });
  bumpStats(killer.id, killer.name, { kills: 1 });
  bumpStats(victim.id, victim.name, { deaths: 1 });
  checkWin(room);
}

function checkWin(room: Room) {
  if (room.phase === "lobby" || room.phase === "ended") return;
  const ps = [...room.players.values()];
  const hollowFree = ps.filter((p) => p.role === "hollow" && p.alive && !p.caged).length;
  const crewFree = ps.filter((p) => p.role === "crew" && p.alive && !p.caged).length;
  const crewAll = ps.filter((p) => p.role === "crew");
  const tasksDone = room.pool.length > 0 && room.pool.every((t) => t.done);
  let winner: Role | null = null;
  let reason = "";
  if (tasksDone && crewAll.length > 0) { winner = "crew"; reason = "Every ward is restored. The Hollow starves and retreats."; }
  else if (hollowFree === 0) { winner = "crew"; reason = "The Hollow Ones are dead or bound in iron. The town breathes again."; }
  else if (hollowFree >= crewFree) { winner = "hollow"; reason = "The Hollow outnumber the living. Hollow Creek belongs to them now."; }
  if (winner) {
    room.phase = "ended";
    room.winner = winner;
    room.winReason = reason;
    room.meeting = null;
    feed(room, winner === "crew" ? "Dawn breaks over Hollow Creek." : "The last lantern goes out.");
    record(room, null, "game_end", { winner, reason });
    const playtimeSec = Math.max(0, Math.round((Date.now() - room.startedAt) / 1000));
    for (const p of room.players.values()) {
      bumpStats(p.id, p.name, {
        games: 1,
        wins: p.role === winner ? 1 : 0,
        losses: p.role === winner ? 0 : 1,
        playtimeSec,
      });
    }
  }
}

function resolveMeeting(room: Room) {
  const votes = new Map<string, number>();
  for (const p of room.players.values()) if (p.vote) votes.set(p.vote, (votes.get(p.vote) ?? 0) + 1);
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
        bumpStats(p.id, p.name, { cagings: 1 });
      } else feed(room, "Every cage is already full. The verdict is void.");
    }
  }
  room.bodies = [];
  room.meeting = null;
  room.phase = "playing";
  for (const p of room.players.values()) { p.vote = null; if (p.role === "hollow") p.killAt = Date.now() + 10000; }
  checkWin(room);
}

// ---------------------------------------------------------------------------
// Input — clients send ONLY intent, never positions
// ---------------------------------------------------------------------------

export function handleInput(room: Room, body: InputBody): { ok: boolean; error?: string } {
  const p = room.players.get(body.playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  p.lastSeen = Date.now();

  if (typeof body.dir === "number") {
    const d = Math.max(-1, Math.min(1, Math.round(body.dir)));
    if (d !== p.dir) record(room, p, "move_input", { dir: d });
    p.dir = d;
  }
  if (typeof body.interactHeld === "boolean") p.interactHeld = body.interactHeld;
  if (typeof body.cartHeld === "boolean") p.cartHeld = body.cartHeld;

  if (typeof body.chat === "string" && body.chat.trim()) {
    const text = body.chat.trim().slice(0, 120);
    p.bubbleText = text;
    p.bubbleUntil = Date.now() + BUBBLE_MS;
    record(room, p, "chat", { text, ghost: !p.alive, caged: p.caged });
    bumpStats(p.id, p.name, { chatChars: text.length });
  }

  if (body.action === "start") return startGame(room, p.id);
  if (body.action === "restart") return restartGame(room, p.id);

  if (body.action === "drop_supply" && p.alive && room.phase === "playing" && p.hasSupply) {
    dropSupply(room, p);
    record(room, p, "supply_drop", {});
    feed(room, `${p.name} puts down a repair kit.`);
    return { ok: true };
  }

  if (body.action === "sabotage") {
    if (room.phase !== "playing" || p.role !== "hollow" || !p.alive || p.caged) {
      return { ok: false, error: "Only a free Hollow can ruin a ward." };
    }
    const now = Date.now();
    if (now < p.sabotageAt) return { ok: false, error: "The ruin is not ready yet." };
    const ward = room.pool.find((t) => !t.sabotaged && (t.done || t.delivered) &&
      dist(STATIONS.find((st) => st.id === t.id)!.x, p.x) < INTERACT_RANGE);
    if (!ward) return { ok: false, error: "Find a supplied or repaired ward to ruin." };
    // One ruin per ward each night keeps the repair victory reachable.
    ward.sabotaged = true;
    ward.done = false;
    ward.delivered = false;
    ward.progress = 0;
    p.sabotageAt = now + SABOTAGE_COOLDOWN_MS;
    p.stamina = Math.max(0, p.stamina - SABOTAGE_VIGOR_COST);
    const station = STATIONS.find((st) => st.id === ward.id)!;
    feed(room, `A crash comes from ${station.name.toLowerCase()}. That ward needs supplies again.`);
    record(room, p, "ward_ruined", { ward: ward.id });
    return { ok: true };
  }

  if (body.action === "interact" && p.alive) {
    // report a body
    if (room.phase === "playing" && !p.caged) {
      const b = nearestBody(room, p);
      if (b) {
        record(room, p, "report", { body: b.name });
        bumpStats(p.id, p.name, { reports: 1 });
        feed(room, `${p.name} found ${b.name}'s body.`);
        beginMeeting(room, `${p.name} found the body of ${b.name}`, p);
        return { ok: true };
      }
    }
    // free a prisoner with the cage key
    if (p.hasKey) {
      const ci = room.cages.findIndex((c) => c.occupant && dist(c.x, p.x) < INTERACT_RANGE);
      if (ci >= 0) {
        const occ = room.players.get(room.cages[ci].occupant!)!;
        freePlayer(room, occ);
        p.hasKey = false;
        p.stamina = Math.max(0, p.stamina - STAMINA_UNLOCK_COST);
        room.keyX = room.cages[ci].x + 40; // the key falls by the open cage — the town learns where it lies
        feed(room, `${p.name} unlocks the cage. ${occ.name} steps free. The key clatters to the ground.`);
        record(room, p, "unlock_cage", { freed: occ.name });
        bumpStats(p.id, p.name, { unlocks: 1 });
        return { ok: true };
      }
    }
    // pick up the cage key
    if (room.keyX !== null && !p.caged && dist(room.keyX, p.x) < INTERACT_RANGE) {
      p.hasKey = true;
      room.keyX = null;
      feed(room, `${p.name} found an old iron key.`);
      record(room, p, "pickup_key", {});
      return { ok: true };
    }
    // ring the bell
    if (room.phase === "playing" && !p.caged && !p.bellUsed && dist(p.x, BELL_X) < INTERACT_RANGE) {
      p.bellUsed = true;
      p.stamina = Math.max(0, p.stamina - STAMINA_BELL_COST);
      record(room, p, "ring_bell", {});
      bumpStats(p.id, p.name, { bells: 1 });
      beginMeeting(room, `${p.name} rang the bell`, p);
      return { ok: true };
    }

    if (room.phase === "playing" && !p.caged) {
      // The server owns both ends of the journey: a kit must be picked up at a
      // cart (or from the ground) and physically carried to an unfinished ward.
      if (p.hasSupply) {
        const ward = room.pool.find((t) => !t.done && !t.delivered &&
          dist(STATIONS.find((st) => st.id === t.id)!.x, p.x) < INTERACT_RANGE);
        if (ward) {
          ward.delivered = true;
          p.hasSupply = false;
          feed(room, `${p.name} delivers a repair kit to ${STATIONS.find((st) => st.id === ward.id)!.name.toLowerCase()}.`);
          record(room, p, "supply_delivered", { ward: ward.id });
          return { ok: true };
        }
      } else {
        const dropped = room.supplyDrops.findIndex((x) => dist(x, p.x) < INTERACT_RANGE);
        if (dropped !== -1) {
          room.supplyDrops.splice(dropped, 1);
          p.hasSupply = true;
          feed(room, `${p.name} recovers a fallen repair kit.`);
          record(room, p, "supply_recovered", {});
          return { ok: true };
        }
        if (dist(room.cartX, p.x) < INTERACT_RANGE) {
          p.hasSupply = true;
          feed(room, `${p.name} takes a repair kit from the supply cart.`);
          record(room, p, "supply_taken", {});
          return { ok: true };
        }
      }
      const broken = room.pool.find((t) => !t.done && !t.delivered &&
        dist(STATIONS.find((st) => st.id === t.id)!.x, p.x) < INTERACT_RANGE);
      if (broken) return { ok: false, error: "Bring a repair kit from a supply cart first." };
    }
  }

  if (body.action === "ability" && p.alive) {
    if (p.role === "hollow" && room.phase === "playing") {
      if (Date.now() < p.killAt) return { ok: false, error: "The hunger has not returned." };
      const victim = killTarget(room, p);
      if (!victim) return { ok: false, error: "No one close enough." };
      doKill(room, p, victim);
      return { ok: true };
    }
    if (p.role === "crew" && room.phase === "playing" && !p.caged && !p.bellUsed && dist(p.x, BELL_X) < INTERACT_RANGE + 20) {
      p.bellUsed = true;
      p.stamina = Math.max(0, p.stamina - STAMINA_BELL_COST);
      record(room, p, "ring_bell", {});
      bumpStats(p.id, p.name, { bells: 1 });
      beginMeeting(room, `${p.name} rang the bell`, p);
      return { ok: true };
    }
  }

  if (body.action === "blackout" && p.alive && p.role === "hollow" && room.phase === "playing") {
    const now = Date.now();
    if (now < room.blackoutReadyAt) return { ok: false, error: "The dark is not yet hungry again." };
    room.blackoutUntil = now + BLACKOUT_MS;
    room.blackoutReadyAt = now + BLACKOUT_CD_MS;
    p.stamina = Math.max(0, p.stamina - STAMINA_BLACKOUT_COST);
    bumpStats(p.id, p.name, { blackouts: 1 });
    feed(room, "Every lantern in town is snuffed at once. The dark rushes in.");
    record(room, p, "blackout", { caged: p.caged });
    return { ok: true };
  }

  if (body.action === "vote" && room.phase === "meeting" && p.alive && body.vote) {
    if (!inMeetingArea(p)) return { ok: false, error: "Walk to the square to vote." };
    const v = body.vote;
    let valid = v === "skip";
    if (!valid && v.startsWith("free:")) {
      const t = room.players.get(v.slice(5));
      valid = !!t && t.caged;
    }
    if (!valid) {
      const t = room.players.get(v);
      valid = !!t && t.alive && !t.caged && t.id !== p.id;
    }
    if (!valid) return { ok: false, error: "Invalid vote." };
    p.vote = v;
    record(room, p, "vote", { target: v });
    const alivePs = [...room.players.values()].filter((q) => q.alive);
    if (alivePs.every((q) => q.vote)) resolveMeeting(room);
    return { ok: true };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Authoritative tick loop
// ---------------------------------------------------------------------------

function tick() {
  const now = Date.now();
  const dt = TICK_MS / 1000;
  for (const room of rooms.values()) {
    if (now - room.createdAt > 6 * 3600_000 && room.players.size === 0) { rooms.delete(room.code); continue; }
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
      continue;
    }
    if (room.phase === "ended") continue;

    // The cart follows the majority direction among nearby players actively
    // holding Push + a direction. Ties stop it; hands full of kits cannot push.
    const pushers = room.phase === "playing"
      ? [...room.players.values()].filter((p) => p.alive && !p.caged && !p.hasSupply &&
          p.cartHeld && p.dir !== 0 && now - p.lastSeen < 15000 && dist(p.x, room.cartX) <= CART_PUSH_RANGE)
      : [];
    const right = pushers.filter((p) => p.dir > 0);
    const left = pushers.filter((p) => p.dir < 0);
    const team = right.length > left.length ? right : left.length > right.length ? left : [];
    const pushingIds = new Set(team.map((p) => p.id));
    const cartSpeed = Math.min(CART_MAX_SPEED, CART_SOLO_SPEED + Math.max(0, team.length - 1) * CART_HELPER_BONUS);
    room.cartPushers = team.length;

    for (const p of room.players.values()) {
      if (now - p.lastSeen > 15000) { p.dir = 0; p.cartHeld = false; } // stale connection stops walking/pushing
      const speed = !p.alive ? GHOST_SPEED : p.hasSupply ? CARRY_SPEED : pushingIds.has(p.id) ? cartSpeed : SPEED;
      p.moving = p.dir !== 0;
      if (p.dir !== 0) p.facing = p.dir;
      p.x += p.dir * speed * dt;
      if (p.caged && p.cageIndex >= 0) {
        const cx = room.cages[p.cageIndex].x;
        p.x = Math.max(cx - CELL_HALF + 8, Math.min(cx + CELL_HALF - 8, p.x));
      } else {
        p.x = Math.max(30, Math.min(WORLD_W - 30, p.x));
      }
      if (p.alive && !p.caged && p.dir !== 0 && (p.hasSupply || pushingIds.has(p.id))) {
        p.stamina = Math.max(0, p.stamina - CARRY_VIGOR_DRAIN * dt * (pushingIds.has(p.id) ? 1.2 : 1));
        if (p.stamina <= 0) p.exhausted = true;
      }
      // Shared ward repair: crews can work only after someone has carried a kit
      // here. Input is still just intent; the server checks position and state.
      let working = false;
      if (room.phase === "playing" && p.alive && !p.caged && p.role === "crew" && p.interactHeld && p.dir === 0) {
        const t = room.pool.find((t) => {
          if (t.done || !t.delivered) return false;
          const st = STATIONS.find((s) => s.id === t.id)!;
          return dist(st.x, p.x) < INTERACT_RANGE;
        });
        if (t && p.stamina > 0 && !p.exhausted) {
          working = true;
          const factor = Math.min(1, p.stamina / STAMINA_SLOW_THRESHOLD);
          t.progress += (TICK_MS / TASK_HOLD_MS) * factor;
          p.stamina = Math.max(0, p.stamina - STAMINA_WORK_DRAIN * dt);
          if (p.stamina <= 0) p.exhausted = true; // must truly rest before working again
          if (t.progress >= 1) {
            t.progress = 1;
            t.done = true;
            record(room, p, "task_complete", { task: t.id });
            bumpStats(p.id, p.name, { tasksDone: 1 });
            checkWin(room);
          }
        }
      }
      // vigor returns only while truly idle
      if (!working && p.dir === 0) {
        p.stamina = Math.min(1, p.stamina + STAMINA_IDLE_REGEN * dt);
        if (p.exhausted && p.stamina >= 0.2) p.exhausted = false;
      }
    }

    if (team.length) {
      room.cartX = Math.max(90, Math.min(WORLD_W - 90,
        room.cartX + team[0].dir * cartSpeed * dt));
    }

    if (room.phase === "meeting" && room.meeting && now >= room.meeting.endsAt) resolveMeeting(room);

    if (room.phase === "playing" && now >= room.nextFlicker) {
      room.flickerAt = now;
      room.nextFlicker = now + 20000 + Math.random() * 25000;
      const lines = [
        "The lanterns flicker. Something passed between them.",
        "Crows lift from the church roof all at once.",
        "A cold wind carries a whisper no one spoke.",
        "Every window in town goes dark for a heartbeat.",
      ];
      feed(room, lines[Math.floor(Math.random() * lines.length)]);
    }
  }
}

if (!g.__hollowLoop) {
  g.__hollowLoop = setInterval(tick, TICK_MS);
}

// ---------------------------------------------------------------------------
// Snapshot (per-viewer, roles hidden)
// ---------------------------------------------------------------------------

export function snapshot(room: Room, playerId: string): Snapshot | null {
  const me = room.players.get(playerId);
  if (!me) return null;
  if (me.parked) {
    me.parked = false; // its player just asked for a snapshot
    markDirty(room);
  }
  const now = Date.now();
  me.lastSeen = now; // the 100ms state poll IS the presence heartbeat
  const ps = [...room.players.values()];
  const killCd = Math.max(0, me.killAt - now);
  const target = me.role === "hollow" ? killTarget(room, me) : null;
  const ruinTarget = room.pool.find((t) => !t.sabotaged && (t.done || t.delivered) &&
    dist(STATIONS.find((st) => st.id === t.id)!.x, me.x) < INTERACT_RANGE);
  const canSabotage = me.role === "hollow" && me.alive && !me.caged &&
    room.phase === "playing" && now >= me.sabotageAt && !!ruinTarget;

  let hint: string | null = null;
  if (me.alive && room.phase !== "lobby") {
    const b = room.phase === "playing" && !me.caged ? nearestBody(room, me) : null;
    const cageIdx = me.hasKey ? room.cages.findIndex((c) => c.occupant && dist(c.x, me.x) < INTERACT_RANGE) : -1;
    const ward = room.pool.find((t) => !t.done && dist(STATIONS.find((s) => s.id === t.id)!.x, me.x) < INTERACT_RANGE);
    const dropped = room.supplyDrops.some((x) => dist(x, me.x) < INTERACT_RANGE);
    const atCart = dist(room.cartX, me.x) < INTERACT_RANGE;
    const nearCart = dist(room.cartX, me.x) <= CART_PUSH_RANGE;
    if (b) hint = `Report ${b.name}'s body`;
    else if (cageIdx >= 0) hint = `Unlock ${room.players.get(room.cages[cageIdx].occupant!)?.name}'s cage`;
    else if (room.keyX !== null && !me.caged && dist(room.keyX, me.x) < INTERACT_RANGE) hint = "Take the iron key";
    else if (room.phase === "playing" && !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE) hint = "Ring the bell";
    else if (room.phase === "playing" && !me.caged) {
      if (canSabotage) hint = "R — ruin this ward";
      else if (ward && !ward.delivered && me.hasSupply) hint = "E — deliver kit to this ward";
      else if (!me.hasSupply && dropped) hint = "E — recover fallen repair kit";
      else if (!me.hasSupply && atCart) hint = "E — take kit · hold Shift + A/D to push";
      else if (ward && !ward.delivered) hint = "Needs kit — find a supply cart";
      else if (ward && ward.delivered) {
        hint = me.role === "hollow" ? "Hold E — pretend to repair" : me.exhausted
          ? "Spent — stand still and catch your breath" : "Hold E — repair this ward";
      } else if (me.hasSupply && nearCart) hint = "Hands full — G to drop kit, then push";
      else if (me.hasSupply) hint = "Hauling kit (slower) — G to drop";
      else if (nearCart) hint = "Hold Shift + A/D to push the cart";
      else if (room.pool.some((t) => !t.done && !t.delivered)) {
        hint = `Supply cart ${room.cartX < me.x ? "←" : "→"} ${Math.round(dist(room.cartX, me.x))} steps`;
      }
    }
  }

  const abilityLabel = me.role === "hollow" ? "Kill" : "Ring Bell";
  const abilityReady = me.alive && room.phase === "playing" && (
    me.role === "hollow" ? killCd <= 0 && !!target : !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE + 20
  );

  const doneTasks = room.pool.filter((t) => t.done).length;

  // ---- server-side vision: a hacked client cannot wallhack ----
  const blackout = now < room.blackoutUntil;
  const ghostView = !me.alive;
  let vision = ghostView ? 99999
    : room.phase === "meeting" ? 900
    : me.role === "hollow" ? VISION_HOLLOW
    : blackout ? VISION_BLACKOUT
    : VISION_CREW;
  if (room.phase === "lobby" || room.phase === "ended") vision = 99999;
  const canSee = (x: number) => ghostView || dist(x, me.x) <= vision;

  // proximity dread for the living crew — drives heartbeat / tension audio
  let danger = 0;
  if (me.alive && me.role === "crew" && room.phase === "playing") {
    let nearest = Infinity;
    for (const p of ps) if (p.role === "hollow" && p.alive && !p.caged) nearest = Math.min(nearest, dist(p.x, me.x));
    danger = Math.max(0, Math.min(1, 1 - nearest / 340));
    if (blackout) danger = Math.max(danger, 0.35);
  }

  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    now,
    self: {
      id: me.id,
      role: me.role,
      alive: me.alive,
      caged: me.caged,
      hasKey: me.hasKey,
      hasSupply: me.hasSupply,
      bellUsed: me.bellUsed,
      killCooldownMs: killCd,
      canKill: !!target && killCd <= 0,
      stamina: Math.round(me.stamina * 100) / 100,
      exhausted: me.exhausted,
      blackoutCooldownMs: Math.max(0, room.blackoutReadyAt - now),
      canBlackout: me.role === "hollow" && me.alive && room.phase === "playing" && now >= room.blackoutReadyAt,
      sabotageCooldownMs: Math.max(0, me.sabotageAt - now),
      canSabotage,
      teammates: me.role === "hollow" ? ps.filter((p) => p.role === "hollow" && p.id !== me.id).map((p) => p.id) : [],
      myVote: me.vote,
    },
    players: ps
      .filter((p) => p.id === me.id || canSee(p.x) || room.phase === "meeting" || room.phase === "lobby" || room.phase === "ended")
      .map((p) => {
        const seen = p.id === me.id || canSee(p.x);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          x: seen ? Math.round(p.x * 10) / 10 : -9999, // meeting roster: names known, positions hidden
          facing: p.facing,
          moving: seen && p.moving && p.dir !== 0,
          alive: p.alive,
          caged: p.caged,
          hasKey: seen && p.hasKey,
          hasSupply: seen && p.hasSupply,
          voted: p.vote !== null,
          isHost: p.isHost,
          bubble:
            seen && p.bubbleUntil > now && (me.alive ? p.alive : true)
              ? { text: p.bubbleText, until: p.bubbleUntil }
              : null,
        };
      }),
    bodies: room.bodies.filter((b) => canSee(b.x)).map((b) => ({ x: b.x, color: b.color, name: b.name })),
    keyX: room.keyX !== null && canSee(room.keyX) ? room.keyX : null,
    supplyDrops: room.supplyDrops.filter(canSee),
    cartX: Math.round(room.cartX * 10) / 10,
    cartPushers: room.cartPushers,
    cages: room.cages.map((c) => ({ x: c.x, occupant: c.occupant })),
    tasks: room.pool.map((t) => {
      const st = STATIONS.find((s) => s.id === t.id)!;
      return { id: t.id, name: st.name, x: st.x, done: t.done, delivered: t.delivered, sabotaged: t.sabotaged, progress: t.progress };
    }),
    taskBar: { done: doneTasks, total: room.pool.length },
    meeting: room.meeting
      ? { endsAt: room.meeting.endsAt, reason: room.meeting.reason, inArea: inMeetingArea(me) }
      : null,
    feed: room.feed.slice(-8),
    winner: room.winner,
    winReason: room.winReason,
    bellAt: room.bellAt,
    flickerAt: room.flickerAt,
    blackoutUntil: room.blackoutUntil,
    danger: Math.round(danger * 100) / 100,
    visionRadius: Math.min(vision, 9999),
    hint,
    abilityLabel,
    abilityReady,
    hostId: ps.find((p) => p.isHost)?.id ?? "",
    playerCount: ps.length,
  };
}