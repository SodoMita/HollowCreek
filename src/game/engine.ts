import { db } from "@/db";
import { gameEvents, roomRows, roomPlayers } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import {
  BELL, BLACKOUT_CD_MS, BLACKOUT_MS, BUBBLE_MS, CAGES, CELL_HALF, CREATURES,
  WEATHER_EVERY_MS, WEATHER_MS,
  DEFAULT_CREATURE, GHOST_SPEED, INTERACT_RANGE, KILL_COOLDOWN_MS, KILL_RANGE,
  MEETING_MS, NIGHT_MS, OBSTACLES, PLAYER_COLORS, REVIVE_MS, SPEED, SQUARE,
  STALKER_RANGE, STALKER_REST_MS, STALKER_SPEED, STALKER_WAKE_MS,
  STAMINA_BELL_COST, STAMINA_BLACKOUT_COST, STAMINA_IDLE_REGEN,
  STAMINA_KILL_COST, STAMINA_SLOW_THRESHOLD, STAMINA_UNLOCK_COST,
  STAMINA_WORK_DRAIN, STATIONS, TASK_HOLD_MS, TASKS_PER_CREW, TICK_MS,
  VISION_BLACKOUT, VISION_CREW, VISION_HOLLOW, VISION_MEETING, WORLD_H, WORLD_W,
} from "./types";
import type {
  FeedItem, GameMode, InputBody, Phase, Role, RoomListing, Snapshot, Vec, WeatherKind,
} from "./types";
import { bumpStats } from "./stats";
import { shuffle } from "./rng";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TaskState { id: string; done: boolean; progress: number }

interface P {
  id: string;
  name: string;
  color: string;
  creature: string;
  x: number;
  y: number;
  dirX: number; // last INPUT direction (-1 | 0 | 1). Clients never send positions.
  dirY: number;
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
  bubbleText: string;
  bubbleUntil: number;
  interactHeld: boolean;
  lastSeen: number;
  joinedAt: number;
  vote: string | null;
  isHost: boolean;
  /** nightwatch: knocked down by the thing in the fog, waiting for a friend */
  downed: boolean;
  downedAt: number;
  revive: number;
  /** true for a seat restored from the database that nobody has claimed yet */
  parked: boolean;
}

interface Room {
  code: string;
  phase: Phase;
  players: Map<string, P>;
  bodies: { x: number; y: number; color: string; name: string; id: string }[];
  keyPos: Vec | null;
  cages: { x: number; y: number; occupant: string | null }[];
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
  /** "nightwatch" has no hidden roles — every soul is a townsfolk */
  mode: GameMode;
  /** timestamp of dawn (nightwatch only) */
  dawnAt: number;
  /** the thing in the fog (nightwatch only) */
  stalker: { x: number; y: number; restingUntil: number } | null;
  /** the valley's current mood */
  weather: { kind: WeatherKind; until: number } | null;
  nextWeather: number;
}

const WEATHER_LINES: Record<WeatherKind, string> = {
  fog: "The fog comes down thick. No one can see as far as the next wall.",
  cold: "A hard frost crawls out of the creek. Working takes more out of you tonight.",
  gutter: "Every lantern in the valley gutters at once, and something in the dark notices.",
  crows: "Crows settle on every roof and refuse to move. They are watching the lanes.",
};

const g = globalThis as typeof globalThis & {
  __hollowRooms?: Map<string, Room>;
  __hollowRoomLoads?: Map<string, Promise<Room | undefined>>;
  __hollowLoop?: ReturnType<typeof setInterval>;
};
const rooms: Map<string, Room> = g.__hollowRooms ?? new Map();
g.__hollowRooms = rooms;
// Concurrent join/state requests after a restart must share one hydration.
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
      data: { phase: room.phase, x: p ? Math.round(p.x) : undefined, y: p ? Math.round(p.y) : undefined, ...data },
    })
    .catch((e) => console.error("chronicle write failed", e));
}

// ---------------------------------------------------------------------------
// Persistence — writes are queued and flushed on an interval so the tick loop
// never waits on the database.
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
            creature: p.creature,
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
  let roster: { id: string; name: string; color: string; creature: string | null; joinedAt: Date }[] = [];
  try {
    const rows = await db.select().from(roomRows).where(eq(roomRows.code, key)).limit(1);
    if (!rows.length) return undefined;
    round = rows[0].round ?? 0;
    roster = await db.select().from(roomPlayers).where(eq(roomPlayers.code, key));
  } catch (e) {
    console.error("room load failed", key, e);
    return undefined;
  }
  const room = makeRoom(key, round);
  const seated = roster.slice().sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  seated.forEach((pr, i) => {
    room.players.set(pr.id, {
      id: pr.id,
      name: pr.name,
      color: pr.color,
      creature: pr.creature ?? DEFAULT_CREATURE,
      x: BELL.x + Math.cos((i / Math.max(1, seated.length)) * Math.PI * 2) * 260,
      y: BELL.y + Math.sin((i / Math.max(1, seated.length)) * Math.PI * 2) * 220,
      dirX: 0,
      dirY: 0,
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
      bubbleText: "",
      bubbleUntil: 0,
      interactHeld: false,
      lastSeen: 0,
      joinedAt: pr.joinedAt.getTime(),
      vote: null,
      isHost: false,
      downed: false,
      downedAt: 0,
      revive: 0,
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
  feed(room, "The town remembers everyone who has walked this valley.");
  record(room, null, "room_restored", { seats: seated.length, round });
  dirtyRooms.add(key);
  return room;
}

function makeRoom(code: string, round = 0, mode: GameMode = "nightwatch"): Room {
  return {
    code,
    mode,
    dawnAt: 0,
    stalker: null,
    weather: null,
    nextWeather: Date.now() + 60_000,
    phase: "lobby",
    players: new Map(),
    bodies: [],
    keyPos: null,
    cages: CAGES.map((c) => ({ x: c.x, y: c.y, occupant: null })),
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
    round,
  };
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

export function createRoom(playerId: string, name: string, creature?: string, mode: GameMode = "nightwatch") {
  const room = makeRoom(makeCode(), 0, mode);
  rooms.set(room.code, room);
  markDirty(room);
  record(room, null, "room_created", { mode });
  joinRoom(room.code, playerId, name, creature);
  feed(room, "The town of Hollow Creek waits under a bruised October sky…");
  return room.code;
}

export function joinRoom(
  code: string,
  playerId: string,
  rawName: string,
  creature?: string
): { ok: boolean; error?: string; playerId?: string } {
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
  const name = (rawName || "Stranger").trim().slice(0, 18) || "Stranger";

  // A stale seat with the same name is re-adopted instead of duplicated.
  const stale = [...room.players.values()].find(
    (q) => q.name.toLowerCase() === name.toLowerCase() && (q.parked || now - q.lastSeen > 20000)
  );
  if (stale) {
    room.players.delete(stale.id);
    stale.id = playerId;
    stale.parked = false;
    stale.lastSeen = now;
    room.players.set(playerId, stale);
    feed(room, `${name} has returned to the valley.`);
    record(room, stale, "seat_adopted", {});
    markDirty(room);
    return { ok: true, playerId };
  }

  const used = new Set([...room.players.values()].map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
  const idx = room.players.size;
  const p: P = {
    id: playerId,
    name,
    color,
    creature: validCreature(creature),
    x: BELL.x + Math.cos((idx / 6) * Math.PI * 2) * 240,
    y: BELL.y + Math.sin((idx / 6) * Math.PI * 2) * 200,
    dirX: 0,
    dirY: 0,
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
    bubbleText: "",
    bubbleUntil: 0,
    interactHeld: false,
    lastSeen: now,
    joinedAt: now,
    vote: null,
    isHost: false,
    downed: false,
    downedAt: 0,
    revive: 0,
    parked: false,
  };
  room.players.set(playerId, p);
  // HUMAN RULE: the last player to join holds the lantern.
  for (const q of room.players.values()) q.isHost = false;
  p.isHost = true;
  feed(room, `${name} walks into Hollow Creek.`);
  record(room, p, "join", { creature: p.creature });
  markDirty(room);
  return { ok: true, playerId };
}

function validCreature(id?: string): string {
  const c = CREATURES.find((k) => k.id === id && !k.claimedBy);
  return c ? c.id : DEFAULT_CREATURE;
}

export function leaveRoom(code: string, playerId: string): { ok: boolean } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { ok: false };
  const p = room.players.get(playerId);
  if (!p) return { ok: false };
  dropKey(room, p);
  freePlayer(room, p);
  room.players.delete(playerId);
  feed(room, `${p.name} leaves the valley.`);
  record(room, p, "leave", {});
  if (p.isHost && room.players.size) {
    const next = [...room.players.values()].sort((a, b) => b.joinedAt - a.joinedAt)[0];
    next.isHost = true;
    feed(room, `${next.name} now holds the town lantern (host).`);
    record(room, next, "host_handoff", {});
  }
  markDirty(room);
  return { ok: true };
}

export function startGame(room: Room, playerId: string): { ok: boolean; error?: string } {
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  if (!p.isHost) return { ok: false, error: "Only the lantern-holder may start the night." };
  const ps = [...room.players.values()];
  // A lone soul may walk the valley in nightwatch (it is how you learn the lanes);
  // a Hollow night needs at least three, or it ends before it begins.
  if (ps.length < (room.mode === "nightwatch" ? 1 : 3)) {
    return { ok: false, error: "The valley needs at least three souls — two would tear each other apart." };
  }

  // Crypto-backed Fisher-Yates: who is Hollow must be genuinely random.
  // nightwatch has no hidden roles at all — the night itself is the enemy
  const nightwatch = room.mode === "nightwatch";
  const ids = shuffle(ps.map((q) => q.id));
  const hollowCount = nightwatch ? 0 : ps.length >= 9 ? 3 : ps.length >= 5 ? 2 : 1;
  const hollows = new Set(ids.slice(0, hollowCount));

  const crewCount = Math.max(1, ps.length - hollowCount);
  const wardCount = nightwatch
    ? STATIONS.length
    : Math.max(4, Math.min(STATIONS.length, TASKS_PER_CREW * crewCount));
  room.pool = shuffle(STATIONS.map((s) => s.id)).slice(0, wardCount).map((id) => ({ id, done: false, progress: 0 }));

  ps.forEach((q, i) => {
    const a = (i / ps.length) * Math.PI * 2;
    q.x = BELL.x + Math.cos(a) * 330;
    q.y = BELL.y + Math.sin(a) * 300;
    q.dirX = 0;
    q.dirY = 0;
    q.alive = true;
    q.caged = false;
    q.cageIndex = -1;
    q.role = hollows.has(q.id) ? "hollow" : "crew";
    q.stamina = 1;
    q.exhausted = false;
    q.killAt = Date.now() + (nightwatch ? 0 : 12000);
    q.downed = false;
    q.downedAt = 0;
    q.revive = 0;
    q.bellUsed = false;
    q.hasKey = false;
    q.bubbleText = "";
    q.bubbleUntil = 0;
    q.interactHeld = false;
    q.vote = null;
  });
  for (const c of room.cages) c.occupant = null;
  room.bodies = [];
  room.keyPos = null;
  room.phase = "playing";
  room.startedAt = Date.now();
  room.winner = null;
  room.winReason = null;
  room.blackoutUntil = 0;
  room.blackoutReadyAt = 0;
  room.round += 1;
  room.nextFlicker = Date.now() + 15000;
  if (nightwatch) {
    room.dawnAt = Date.now() + NIGHT_MS;
    room.stalker = {
      x: clampX(BELL.x + (Math.random() - 0.5) * 2400),
      y: clampY(BELL.y + (Math.random() > 0.5 ? 1 : -1) * (900 + Math.random() * 900)),
      restingUntil: Date.now() + STALKER_WAKE_MS,
    };
    feed(room, `Darkness falls. ${ps.length} souls, ${wardCount} wards, and dawn in six minutes.`);
  } else {
    room.dawnAt = 0;
    room.stalker = null;
    feed(room, `Darkness falls on Hollow Creek. ${hollowCount} Hollow walk among ${ps.length} souls.`);
  }
  record(room, p, "game_start", { players: ps.length, hollows: hollowCount, wards: wardCount, round: room.round, mode: room.mode });
  markDirty(room);
  checkWin(room);
  return { ok: true };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

function listing(room: Room): RoomListing {
  const ps = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  return {
    code: room.code,
    phase: room.phase,
    playerCount: ps.length,
    hostName: ps.find((p) => p.isHost)?.name ?? "—",
    names: ps.map((p) => p.name),
    createdAt: room.createdAt,
    round: room.round,
  };
}

export async function listRooms(): Promise<RoomListing[]> {
  const out: RoomListing[] = [];
  try {
    const rows = await db.select().from(roomRows).orderBy(desc(roomRows.updatedAt)).limit(60);
    for (const r of rows) {
      const live = rooms.get(r.code);
      if (live) {
        out.push(listing(live));
        continue;
      }
      const roster = await db.select().from(roomPlayers).where(eq(roomPlayers.code, r.code));
      out.push({
        code: r.code,
        phase: (r.phase as Phase) ?? "lobby",
        playerCount: roster.length,
        hostName: roster[roster.length - 1]?.name ?? "—",
        names: roster.map((p) => p.name),
        createdAt: r.createdAt.getTime(),
        round: r.round,
      });
    }
  } catch (e) {
    console.error("room list failed", e);
  }
  return out;
}

export function listRoomsSync(): RoomListing[] {
  return [...rooms.values()].map(listing);
}

export function restartGame(room: Room, playerId: string): { ok: boolean; error?: string } {
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  if (!p.isHost) return { ok: false, error: "Only the lantern-holder may call another night." };
  for (const q of room.players.values()) {
    q.alive = true;
    q.caged = false;
    q.cageIndex = -1;
    q.role = "crew";
    q.stamina = 1;
    q.exhausted = false;
    q.killAt = 0;
    q.bellUsed = false;
    q.hasKey = false;
    q.x = BELL.x + Math.cos(q.joinedAt % 6.28) * 300;
    q.y = BELL.y + Math.sin(q.joinedAt % 6.28) * 260;
    q.dirX = 0;
    q.dirY = 0;
    q.bubbleText = "";
    q.bubbleUntil = 0;
    q.interactHeld = false;
    q.vote = null;
    q.downed = false;
    q.downedAt = 0;
    q.revive = 0;
  }
  room.bodies = [];
  room.keyPos = null;
  room.dawnAt = 0;
  room.stalker = null;
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
  markDirty(room);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const d2 = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const inMeetingArea = (p: P) =>
  p.caged || (p.x >= SQUARE.x && p.x <= SQUARE.x + SQUARE.w && p.y >= SQUARE.y && p.y <= SQUARE.y + SQUARE.h);

function nearestBody(room: Room, p: P) {
  let best: Room["bodies"][number] | null = null;
  for (const b of room.bodies) {
    const d = d2(b.x, b.y, p.x, p.y);
    if (d < INTERACT_RANGE + 30 && (!best || d < d2(best.x, best.y, p.x, p.y))) best = b;
  }
  return best;
}

function killTarget(room: Room, p: P): P | null {
  let best: P | null = null;
  for (const t of room.players.values()) {
    if (t.id === p.id || !t.alive || t.role === "hollow") continue;
    const d = d2(t.x, t.y, p.x, p.y);
    if (d <= KILL_RANGE && (!best || d < d2(best.x, best.y, p.x, p.y))) best = t;
  }
  return best;
}

function dropKey(room: Room, p: P) {
  if (p.hasKey) {
    p.hasKey = false;
    room.keyPos = { x: clampX(p.x), y: clampY(p.y) };
  }
}

const clampX = (x: number) => Math.max(60, Math.min(WORLD_W - 60, x));
const clampY = (y: number) => Math.max(60, Math.min(WORLD_H - 60, y));

function cagePlayer(room: Room, p: P): boolean {
  const idx = room.cages.findIndex((c) => c.occupant === null);
  if (idx === -1) return false;
  room.cages[idx].occupant = p.id;
  p.caged = true;
  p.cageIndex = idx;
  p.x = room.cages[idx].x;
  p.y = room.cages[idx].y;
  p.dirX = 0;
  p.dirY = 0;
  dropKey(room, p);
  return true;
}

function freePlayer(room: Room, p: P) {
  if (!p.caged) return;
  if (room.cages[p.cageIndex]) room.cages[p.cageIndex].occupant = null;
  p.caged = false;
  p.cageIndex = -1;
}

/** Nightwatch has no meetings — the bell rallies the town and drives the fog back. */
function rally(room: Room, p: P): { ok: boolean } {
  for (const q of room.players.values()) {
    q.stamina = Math.min(1, q.stamina + 0.4);
    if (q.downed && q.revive > 0.3) { q.downed = false; q.revive = 0; }
  }
  const s = room.stalker;
  if (s) {
    const a = Math.atan2(s.y - p.y, s.x - p.x);
    s.x = clampX(s.x + Math.cos(a) * 1500);
    s.y = clampY(s.y + Math.sin(a) * 1500);
    s.restingUntil = Date.now() + 32000;
  }
  feed(room, `🔔 ${p.name} rings the bell. The valley straightens its back.`);
  record(room, p, "rally", {});
  return { ok: true };
}

function beginMeeting(room: Room, reason: string, caller: P | null) {
  room.phase = "meeting";
  room.blackoutUntil = 0; // the gathering rekindles the lanterns
  room.meeting = { endsAt: Date.now() + MEETING_MS, reason };
  room.bellAt = Date.now();
  for (const p of room.players.values()) { p.vote = null; p.interactHeld = false; }
  feed(room, "🔔 The bell tolls. All souls must walk to the square.");
  record(room, caller, "meeting_start", { reason });
}

function doKill(room: Room, killer: P, victim: P) {
  victim.alive = false;
  victim.dirX = 0;
  victim.dirY = 0;
  dropKey(room, victim);
  freePlayer(room, victim); // a killed prisoner dies inside the cell; body remains there
  room.bodies.push({ x: victim.x, y: victim.y, color: victim.color, name: victim.name, id: victim.id });
  killer.killAt = Date.now() + KILL_COOLDOWN_MS;
  killer.stamina = Math.max(0, killer.stamina - STAMINA_KILL_COST);
  killer.x = victim.x; // lunge
  killer.y = victim.y;
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
  if (room.mode === "nightwatch") {
    const standing = ps.filter((p) => !p.downed).length;
    if (tasksDone) { winner = "crew"; reason = "Every ward holds. Dawn finds the valley still standing."; }
    else if (standing === 0) { winner = "hollow"; reason = "The fog took the whole town before the wards were finished."; }
    else if (Date.now() >= room.dawnAt) { winner = "hollow"; reason = "Dawn came, and the wards were not finished."; }
  } else if (tasksDone && crewAll.length > 0) { winner = "crew"; reason = "Every ward is restored. The Hollow starves and retreats."; }
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
    markDirty(room);
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

/** Simple rectangle push-out so the valley's buildings are real mass. */
function resolveSolids(p: P) {
  const r = 30;
  for (const o of OBSTACLES) {
    const nx = Math.max(o.x, Math.min(o.x + o.w, p.x));
    const ny = Math.max(o.y, Math.min(o.y + o.h, p.y));
    const dx = p.x - nx;
    const dy = p.y - ny;
    const dd = Math.hypot(dx, dy);
    if (dd >= r) continue;
    if (dd > 0.001) {
      p.x = nx + (dx / dd) * r;
      p.y = ny + (dy / dd) * r;
    } else {
      p.y = o.y - r;
    }
  }
}

// ---------------------------------------------------------------------------
// Input — clients send ONLY intent, never positions
// ---------------------------------------------------------------------------

export function handleInput(room: Room, body: InputBody): { ok: boolean; error?: string } {
  const p = room.players.get(body.playerId);
  if (!p) return { ok: false, error: "Unknown soul." };
  p.lastSeen = Date.now();

  // legacy 1D input (`dir`) moves on x only and always stops the y axis
  const legacy = typeof body.dirX !== "number" && typeof body.dirY !== "number" && typeof body.dir === "number";
  const dx = typeof body.dirX === "number" ? body.dirX : typeof body.dir === "number" ? body.dir : undefined;
  const dy = legacy ? 0 : typeof body.dirY === "number" ? body.dirY : undefined;
  if (dx !== undefined || dy !== undefined) {
    const nx = Math.max(-1, Math.min(1, Math.round(dx ?? p.dirX)));
    const ny = Math.max(-1, Math.min(1, Math.round(dy ?? p.dirY)));
    if (nx !== p.dirX || ny !== p.dirY) record(room, p, "move_input", { dirX: nx, dirY: ny });
    p.dirX = nx;
    p.dirY = ny;
  }
  if (typeof body.interactHeld === "boolean") p.interactHeld = body.interactHeld;

  if (typeof body.creature === "string") {
    const c = validCreature(body.creature);
    if (c !== p.creature && (room.phase === "lobby" || room.phase === "ended")) {
      p.creature = c;
      const spec = CREATURES.find((k) => k.id === c);
      feed(room, `${p.name} takes the face of the ${spec?.name ?? "Stranger"}.`);
      record(room, p, "creature_chosen", { creature: c });
      markDirty(room);
    }
  }

  if (typeof body.chat === "string" && body.chat.trim()) {
    const text = body.chat.trim().slice(0, 120);
    p.bubbleText = text;
    p.bubbleUntil = Date.now() + BUBBLE_MS;
    record(room, p, "chat", { text, ghost: !p.alive, caged: p.caged });
    bumpStats(p.id, p.name, { chatChars: text.length });
  }

  if (body.action === "start") return startGame(room, p.id);
  if (body.action === "restart") return restartGame(room, p.id);

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
      const ci = room.cages.findIndex((c) => c.occupant && d2(c.x, c.y, p.x, p.y) < INTERACT_RANGE);
      if (ci >= 0) {
        const occ = room.players.get(room.cages[ci].occupant!)!;
        freePlayer(room, occ);
        p.hasKey = false;
        p.stamina = Math.max(0, p.stamina - STAMINA_UNLOCK_COST);
        room.keyPos = { x: room.cages[ci].x + 60, y: room.cages[ci].y }; // the key falls beside the opened cage
        feed(room, `${p.name} unlocks the cage. ${occ.name} steps free. The key clatters to the ground.`);
        record(room, p, "unlock_cage", { freed: occ.name });
        bumpStats(p.id, p.name, { unlocks: 1 });
        return { ok: true };
      }
    }
    // pick up the cage key
    if (room.keyPos && !p.caged && d2(room.keyPos.x, room.keyPos.y, p.x, p.y) < INTERACT_RANGE) {
      p.hasKey = true;
      room.keyPos = null;
      feed(room, `${p.name} found an old iron key.`);
      record(room, p, "pickup_key", {});
      return { ok: true };
    }
    // ring the bell
    if (room.phase === "playing" && !p.caged && !p.bellUsed && d2(p.x, p.y, BELL.x, BELL.y) < INTERACT_RANGE) {
      p.bellUsed = true;
      p.stamina = Math.max(0, p.stamina - STAMINA_BELL_COST);
      record(room, p, "ring_bell", {});
      bumpStats(p.id, p.name, { bells: 1 });
      beginMeeting(room, `${p.name} rang the bell`, p);
      return { ok: true };
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
    if (p.role === "crew" && room.phase === "playing" && !p.caged && !p.bellUsed && d2(p.x, p.y, BELL.x, BELL.y) < INTERACT_RANGE + 20) {
      p.bellUsed = true;
      p.stamina = Math.max(0, p.stamina - STAMINA_BELL_COST);
      record(room, p, "ring_bell", { mode: room.mode });
      bumpStats(p.id, p.name, { bells: 1 });
      if (room.mode === "nightwatch") return rally(room, p);
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
    if (room.phase === "lobby" || room.phase === "ended") {
      for (const p of [...room.players.values()]) {
        if (p.parked) continue; // a restored seat waits for its player
        if (now - p.lastSeen > 75000) leaveRoom(room.code, p.id);
      }
      // invariant: while anyone is gathered, SOMEONE holds the lantern
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

    for (const p of room.players.values()) {
      if (now - p.lastSeen > 15000) { p.dirX = 0; p.dirY = 0; } // stale connection stops walking
      if (p.downed) { p.dirX = 0; p.dirY = 0; } // the fallen cannot walk
      const speed = p.alive ? SPEED : GHOST_SPEED;
      const len = Math.hypot(p.dirX, p.dirY);
      p.moving = len > 0;
      if (p.dirX !== 0) p.facing = p.dirX;
      if (len > 0) {
        p.x += (p.dirX / len) * speed * dt;
        p.y += (p.dirY / len) * speed * dt;
      }
      if (p.caged && p.cageIndex >= 0) {
        const c = room.cages[p.cageIndex];
        p.x = Math.max(c.x - CELL_HALF + 8, Math.min(c.x + CELL_HALF - 8, p.x));
        p.y = Math.max(c.y - CELL_HALF + 8, Math.min(c.y + CELL_HALF - 8, p.y));
      } else {
        p.x = clampX(p.x);
        p.y = clampY(p.y);
        resolveSolids(p);
      }
      // shared ward work (hold E) — vigor drains, low vigor slows, zero halts
      let working = false;
      if (room.phase === "playing" && p.alive && !p.caged && p.role === "crew" && p.interactHeld && !p.moving) {
        const t = room.pool.find((t) => {
          if (t.done) return false;
          const st = STATIONS.find((s) => s.id === t.id)!;
          return d2(st.x, st.y, p.x, p.y) < INTERACT_RANGE;
        });
        if (t && p.stamina > 0 && !p.exhausted) {
          working = true;
          const factor = Math.min(1, p.stamina / STAMINA_SLOW_THRESHOLD);
          t.progress += (TICK_MS / TASK_HOLD_MS) * factor;
          const cold = room.weather?.kind === "cold" && now < room.weather.until ? 1.35 : 1;
          p.stamina = Math.max(0, p.stamina - STAMINA_WORK_DRAIN * dt * cold);
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
      if (!working && !p.moving) {
        const chill = room.weather?.kind === "cold" && now < room.weather.until ? 0.55 : 1;
        p.stamina = Math.min(1, p.stamina + STAMINA_IDLE_REGEN * dt * chill);
        if (p.exhausted && p.stamina >= 0.2) p.exhausted = false;
      }
    }

    // ---------------- the valley's moods ----------------
    if (room.phase === "playing" && now >= room.nextWeather) {
      const kinds: WeatherKind[] = ["fog", "cold", "gutter", "crows"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      room.weather = { kind, until: now + WEATHER_MS };
      room.nextWeather = now + WEATHER_EVERY_MS + Math.random() * 40000;
      feed(room, WEATHER_LINES[kind]);
      record(room, null, "weather", { kind });
      if (kind === "gutter" && room.stalker) room.stalker.restingUntil = Math.min(room.stalker.restingUntil, now) ;
    }
    if (room.weather && now >= room.weather.until) room.weather = null;

    // ---------------- nightwatch: the thing in the fog, and the fallen -------------
    if (room.phase === "playing" && room.mode === "nightwatch") {
      const living = [...room.players.values()];
      for (const q of living) {
        if (!q.downed) continue;
        const helper = living.some(
          (h) => !h.downed && h.interactHeld && !h.moving && d2(h.x, h.y, q.x, q.y) < INTERACT_RANGE
        );
        if (helper) q.revive = Math.min(1, q.revive + dt / (REVIVE_MS / 1000));
        else q.revive = Math.max(0, q.revive - dt * 0.5);
        // nobody coming? they drag themselves up eventually — the night may never
        // soft-lock a lone soul, but a friend is always faster and costs nothing.
        if (!helper && now - q.downedAt > 15000) {
          q.downed = false;
          q.revive = 0;
          q.stamina = Math.min(q.stamina, 0.35);
          feed(room, `${q.name} drags themselves back up. Bruised, and slower for it.`);
          record(room, q, "self_revive", {});
          continue;
        }
        if (q.revive >= 1) {
          q.downed = false;
          q.revive = 0;
          q.stamina = Math.max(q.stamina, 0.55);
          feed(room, `${q.name} is back on their feet.`);
          record(room, q, "revived", {});
        }
      }
      const s = room.stalker;
      if (s && now >= s.restingUntil) {
        let best: P | null = null;
        let bd = Infinity;
        for (const h of living) {
          if (h.downed) continue;
          const d = d2(h.x, h.y, s.x, s.y);
          if (d < bd) { bd = d; best = h; }
        }
        if (best) {
          const ang = Math.atan2(best.y - s.y, best.x - s.x);
          s.x += Math.cos(ang) * STALKER_SPEED * dt;
          s.y += Math.sin(ang) * STALKER_SPEED * dt;
          s.x = clampX(s.x);
          s.y = clampY(s.y);
          if (bd < STALKER_RANGE) {
            best.downed = true;
            best.downedAt = now;
            best.revive = 0;
            best.stamina = Math.max(0, best.stamina - 0.25);
            feed(room, `The fog takes ${best.name}. They are down — stand over them and hold.`);
            record(room, best, "downed", { x: Math.round(best.x), y: Math.round(best.y) });
            const a = Math.random() * Math.PI * 2;
            s.x = clampX(s.x + Math.cos(a) * 1100);
            s.y = clampY(s.y + Math.sin(a) * 1100);
            s.restingUntil = now + STALKER_REST_MS;
          }
        }
      }
      if (now >= room.dawnAt) checkWin(room);
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
        "The creek runs black for a moment, then clears.",
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
  const near = (x: number, y: number, range = INTERACT_RANGE) => d2(x, y, me.x, me.y) < range;

  let hint: string | null = null;
  const downedFriend = [...room.players.values()].find((q) => q.id !== me.id && q.downed && near(q.x, q.y));
  if (me.alive && room.phase !== "lobby") {
    const b = room.phase === "playing" && !me.caged ? nearestBody(room, me) : null;
    const cageIdx = me.hasKey ? room.cages.findIndex((c) => c.occupant && near(c.x, c.y)) : -1;
    const nearTask = room.pool.find((t) => !t.done && (() => {
      const st = STATIONS.find((s) => s.id === t.id)!;
      return near(st.x, st.y);
    })());
    if (b) hint = `Report ${b.name}'s body`;
    else if (cageIdx >= 0) hint = `Unlock ${room.players.get(room.cages[cageIdx].occupant!)?.name}'s cage`;
    else if (room.keyPos && !me.caged && near(room.keyPos.x, room.keyPos.y)) hint = "Take the iron key";
    else if (room.phase === "playing" && !me.caged && !me.bellUsed && near(BELL.x, BELL.y)) hint = "Ring the bell";
    else if (room.phase === "playing" && me.alive && !me.caged && nearTask) {
      const st = STATIONS.find((s) => s.id === nearTask.id)!;
      hint = me.role === "hollow"
        ? `Hold E — ${st.name} (pretend)`
        : me.exhausted
          ? "Spent — stand still and catch your breath"
          : `Hold E — ${st.name}${me.stamina < STAMINA_SLOW_THRESHOLD ? " (weary, slow)" : ""}`;
    } else if (room.phase === "playing" && !me.caged) {
      hint =
        room.mode === "nightwatch"
          ? `Dawn in ${Math.max(0, Math.round((room.dawnAt - now) / 1000))}s — ${room.pool.filter((t) => !t.done).length} wards left`
          : "Wards are marked on your map — the valley is wide tonight";
    }
    if (me.downed) hint = "You are down. Hold still — a friend must stand over you.";
    else if (downedFriend && room.phase === "playing") hint = `Hold E — raise ${downedFriend.name}`;
  }

  const abilityLabel = me.role === "hollow" ? "Kill" : "Ring Bell";
  const abilityReady = me.alive && room.phase === "playing" && (
    me.role === "hollow"
      ? killCd <= 0 && !!target
      : !me.caged && !me.bellUsed && d2(me.x, me.y, BELL.x, BELL.y) < INTERACT_RANGE + 20
  );

  const doneTasks = room.pool.filter((t) => t.done).length;

  // ---- server-side vision: a hacked client cannot wallhack ----
  const blackout = now < room.blackoutUntil;
  const ghostView = !me.alive;
  const foggy = room.weather?.kind === "fog" && now < (room.weather?.until ?? 0);
  const vision = (ghostView || room.phase === "lobby" || room.phase === "ended"
    ? 99999
    : room.phase === "meeting"
      ? VISION_MEETING
      : me.role === "hollow"
        ? VISION_HOLLOW
        : blackout ? VISION_BLACKOUT : VISION_CREW) * (foggy ? 0.78 : 1);
  const canSee = (x: number, y: number) => ghostView || d2(x, y, me.x, me.y) <= vision;

  // proximity dread for the living crew — drives heartbeat / tension audio
  let danger = 0;
  if (me.alive && room.phase === "playing" && room.mode === "nightwatch") {
    const s = room.stalker;
    if (s && now >= s.restingUntil) danger = Math.max(0, Math.min(1, 1 - d2(s.x, s.y, me.x, me.y) / 620));
    if (me.downed) danger = Math.max(danger, 0.55);
  } else if (me.alive && me.role === "crew" && room.phase === "playing") {
    let nearest = Infinity;
    for (const p of ps) if (p.role === "hollow" && p.alive && !p.caged) nearest = Math.min(nearest, d2(p.x, p.y, me.x, me.y));
    danger = Math.max(0, Math.min(1, 1 - nearest / 420));
    if (blackout) danger = Math.max(danger, 0.35);
  }

  return {
    code: room.code,
    mode: room.mode,
    dawnAt: room.dawnAt,
    stalker:
      room.stalker && now >= room.stalker.restingUntil && d2(room.stalker.x, room.stalker.y, me.x, me.y) < Math.max(vision, 950)
        ? { x: room.stalker.x, y: room.stalker.y }
        : null,
    weather: room.weather && now < room.weather.until ? room.weather : null,
    phase: room.phase,
    round: room.round,
    now,
    self: {
      id: me.id,
      role: me.role,
      alive: me.alive,
      caged: me.caged,
      hasKey: me.hasKey,
      bellUsed: me.bellUsed,
      killCooldownMs: killCd,
      canKill: !!target && killCd <= 0,
      stamina: Math.round(me.stamina * 100) / 100,
      exhausted: me.exhausted,
      blackoutCooldownMs: Math.max(0, room.blackoutReadyAt - now),
      canBlackout: me.role === "hollow" && me.alive && room.phase === "playing" && now >= room.blackoutReadyAt,
      teammates: me.role === "hollow" ? ps.filter((p) => p.role === "hollow" && p.id !== me.id).map((p) => p.id) : [],
      myVote: me.vote,
      creature: me.creature,
      downed: me.downed,
      revive: Math.round(me.revive * 100) / 100,
    },
    players: ps
      .filter((p) => p.id === me.id || canSee(p.x, p.y) || room.phase === "meeting" || room.phase === "lobby" || room.phase === "ended")
      .map((p) => {
        const seen = p.id === me.id || canSee(p.x, p.y);
        return {
          id: p.id,
          name: p.name,
          color: p.color,
          creature: p.creature,
          x: seen ? Math.round(p.x * 10) / 10 : -9999, // meeting roster: names known, positions hidden
          y: seen ? Math.round(p.y * 10) / 10 : -9999,
          facing: p.facing,
          moving: seen && p.moving,
          alive: p.alive,
          caged: p.caged,
          hasKey: seen && p.hasKey,
          voted: p.vote !== null,
          downed: p.downed,
          isHost: p.isHost,
          bubble:
            seen && p.bubbleUntil > now && (me.alive ? p.alive : true)
              ? { text: p.bubbleText, until: p.bubbleUntil }
              : null,
        };
      }),
    bodies: room.bodies.filter((b) => canSee(b.x, b.y)).map((b) => ({ x: b.x, y: b.y, color: b.color, name: b.name })),
    keyPos: room.keyPos && canSee(room.keyPos.x, room.keyPos.y) ? room.keyPos : null,
    cages: room.cages.map((c) => ({ x: c.x, y: c.y, occupant: c.occupant })),
    tasks: room.pool.map((t) => {
      const st = STATIONS.find((s) => s.id === t.id)!;
      return { id: t.id, name: st.name, x: st.x, y: st.y, kind: st.kind, done: t.done, progress: t.progress };
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
