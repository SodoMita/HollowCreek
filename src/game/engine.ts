import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import {
  BELL_X, BLACKOUT_CD_MS, BLACKOUT_MS, BUBBLE_MS, CAGE_XS, CELL_HALF, GHOST_SPEED,
  INTERACT_RANGE, KILL_COOLDOWN_MS, KILL_RANGE, MEETING_FROM, MEETING_MS, MEETING_TO,
  PLAYER_COLORS, SPEED, STATIONS, TASKS_PER_CREW, TASK_HOLD_MS, TICK_MS,
  VISION_BLACKOUT, VISION_CREW, VISION_HOLLOW, WORLD_W,
} from "./types";
import type { FeedItem, InputBody, Phase, Role, Snapshot } from "./types";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface TaskState { id: string; done: boolean; progress: number }

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
  tasks: TaskState[];
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
}

interface Room {
  code: string;
  phase: Phase;
  players: Map<string, P>;
  bodies: { x: number; color: string; name: string; id: string }[];
  keyX: number | null;
  cages: { x: number; occupant: string | null }[];
  feed: FeedItem[];
  meeting: { endsAt: number; reason: string } | null;
  winner: Role | null;
  winReason: string | null;
  bellAt: number;
  flickerAt: number;
  nextFlicker: number;
  createdAt: number;
  totalTasks: number;
  blackoutUntil: number;
  blackoutReadyAt: number;
}

const g = globalThis as typeof globalThis & {
  __hollowRooms?: Map<string, Room>;
  __hollowLoop?: ReturnType<typeof setInterval>;
};
const rooms: Map<string, Room> = g.__hollowRooms ?? new Map();
g.__hollowRooms = rooms;

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
    cages: CAGE_XS.map((x) => ({ x, occupant: null })),
    feed: [],
    meeting: null,
    winner: null,
    winReason: null,
    bellAt: 0,
    flickerAt: 0,
    nextFlicker: Date.now() + 20000,
    createdAt: Date.now(),
    totalTasks: 0,
    blackoutUntil: 0,
    blackoutReadyAt: 0,
  };
  rooms.set(room.code, room);
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
    return { ok: true, playerId };
  }
  if (room.phase !== "lobby") return { ok: false, error: "This tale has already begun." };
  const name = (rawName || "Stranger").trim().slice(0, 14) || "Stranger";
  // Re-adoption: someone returning under the same name takes over their old
  // (stale) seat instead of spawning a duplicate "name-2" stranger.
  const staleSeat = [...room.players.values()].find(
    (q) => q.name.toLowerCase() === name.toLowerCase() && now - q.lastSeen > 8000
  );
  if (staleSeat) {
    room.players.delete(staleSeat.id);
    const oldId = staleSeat.id;
    staleSeat.id = playerId;
    staleSeat.lastSeen = now;
    staleSeat.joinedAt = now;
    room.players.set(playerId, staleSeat);
    record(room, staleSeat, "rejoin", { oldId });
    feed(room, `${staleSeat.name} returned to town.`);
    return { ok: true, playerId };
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
    tasks: [],
    killAt: 0,
    bellUsed: false,
    hasKey: false,
    bubbleText: "",
    bubbleUntil: 0,
    interactHeld: false,
    lastSeen: Date.now(),
    joinedAt: Date.now(),
    vote: null,
    isHost: true, // the lantern always passes to the LAST joiner
  };
  const previousHost = [...room.players.values()].find((q) => q.isHost);
  if (previousHost) {
    previousHost.isHost = false;
    feed(room, `${name} takes the town lantern (host).`);
  }
  room.players.set(playerId, p);
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
  const p = room.players.get(playerId);
  if (!p) return { ok: false };
  record(room, p, "leave", { lobby: room.phase === "lobby" });
  if (room.phase === "lobby") {
    room.players.delete(playerId);
    feed(room, `${p.name} turned back down the old road.`);
  } else {
    p.dir = 0;
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
  const host = room.players.get(playerId);
  if (!host?.isHost) return { ok: false, error: "Only the host may begin." };
  if (room.phase !== "lobby") return { ok: false, error: "Already begun." };
  if (room.players.size < 4) return { ok: false, error: "At least 4 souls are needed." };

  const ps = [...room.players.values()];
  const shuffled = [...ps].sort(() => Math.random() - 0.5);
  const hollowCount = ps.length >= 6 ? 2 : 1;
  shuffled.forEach((p, i) => {
    p.role = i < hollowCount ? "hollow" : "crew";
    p.x = 300 + Math.random() * (WORLD_W - 600);
    p.killAt = Date.now() + 10000;
  });
  const stationIds = STATIONS.map((s) => s.id);
  let total = 0;
  for (const p of ps) {
    if (p.role === "crew") {
      const picks = [...stationIds].sort(() => Math.random() - 0.5).slice(0, TASKS_PER_CREW);
      p.tasks = picks.map((id) => ({ id, done: false, progress: 0 }));
      total += picks.length;
    } else {
      p.tasks = [...stationIds].sort(() => Math.random() - 0.5)
        .slice(0, TASKS_PER_CREW)
        .map((id) => ({ id, done: false, progress: 0 }));
    }
  }
  room.totalTasks = total;
  // The cage key hides somewhere on the outskirts.
  room.keyX = Math.random() < 0.5 ? 150 + Math.random() * 1400 : 2700 + Math.random() * 1350;
  room.phase = "playing";
  room.nextFlicker = Date.now() + 15000 + Math.random() * 15000;
  feed(room, "Night falls. Something wearing a human shape walks among you.");
  record(room, null, "game_start", { players: ps.map((p) => ({ id: p.id, name: p.name, role: p.role })) });
  checkWin(room);
  return { ok: true };
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
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

function cagePlayer(room: Room, p: P): boolean {
  const idx = room.cages.findIndex((c) => c.occupant === null);
  if (idx === -1) return false;
  room.cages[idx].occupant = p.id;
  p.caged = true;
  p.cageIndex = idx;
  p.x = room.cages[idx].x;
  p.dir = 0;
  dropKey(room, p);
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
  room.blackoutUntil = 0; // the gathering rekindles the lanterns
  room.meeting = { endsAt: Date.now() + MEETING_MS, reason };
  room.bellAt = Date.now();
  for (const p of room.players.values()) { p.vote = null; p.interactHeld = false; }
  feed(room, "🔔 The bell tolls. All souls must walk to the square.");
  record(room, caller, "meeting_start", { reason });
}

function doKill(room: Room, killer: P, victim: P) {
  victim.alive = false;
  victim.dir = 0;
  dropKey(room, victim);
  freePlayer(room, victim); // a killed prisoner dies inside the cell; body remains there
  room.bodies.push({ x: victim.x, color: victim.color, name: victim.name, id: victim.id });
  killer.killAt = Date.now() + KILL_COOLDOWN_MS;
  killer.x = victim.x; // lunge
  feed(room, "A scream cuts through the fog, then silence.");
  record(room, killer, "kill", { victim: victim.name, victimId: victim.id, victimCaged: victim.caged });
  checkWin(room);
}

function checkWin(room: Room) {
  if (room.phase === "lobby" || room.phase === "ended") return;
  const ps = [...room.players.values()];
  const hollowFree = ps.filter((p) => p.role === "hollow" && p.alive && !p.caged).length;
  const crewFree = ps.filter((p) => p.role === "crew" && p.alive && !p.caged).length;
  const crewAll = ps.filter((p) => p.role === "crew");
  const tasksDone = crewAll.every((p) => p.tasks.every((t) => t.done));
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
      if (cagePlayer(room, p)) feed(room, `The town drags ${p.name} into a cage. They can still speak…`);
      else feed(room, "Every cage is already full. The verdict is void.");
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

  if (typeof body.chat === "string" && body.chat.trim()) {
    const text = body.chat.trim().slice(0, 120);
    p.bubbleText = text;
    p.bubbleUntil = Date.now() + BUBBLE_MS;
    record(room, p, "chat", { text, ghost: !p.alive, caged: p.caged });
  }

  if (body.action === "start") return startGame(room, p.id);

  if (body.action === "interact" && p.alive) {
    // report a body
    if (room.phase === "playing" && !p.caged) {
      const b = nearestBody(room, p);
      if (b) {
        record(room, p, "report", { body: b.name });
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
        room.keyX = room.cages[ci].x + 40; // the key falls by the open cage — the town learns where it lies
        feed(room, `${p.name} unlocks the cage. ${occ.name} steps free. The key clatters to the ground.`);
        record(room, p, "unlock_cage", { freed: occ.name });
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
      record(room, p, "ring_bell", {});
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
    if (p.role === "crew" && room.phase === "playing" && !p.caged && !p.bellUsed && dist(p.x, BELL_X) < INTERACT_RANGE + 20) {
      p.bellUsed = true;
      record(room, p, "ring_bell", {});
      beginMeeting(room, `${p.name} rang the bell`, p);
      return { ok: true };
    }
  }

  if (body.action === "blackout" && p.alive && p.role === "hollow" && room.phase === "playing") {
    const now = Date.now();
    if (now < room.blackoutReadyAt) return { ok: false, error: "The dark is not yet hungry again." };
    room.blackoutUntil = now + BLACKOUT_MS;
    room.blackoutReadyAt = now + BLACKOUT_CD_MS;
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

    for (const p of room.players.values()) {
      if (now - p.lastSeen > 15000) p.dir = 0; // stale connection stops walking
      const speed = p.alive ? SPEED : GHOST_SPEED;
      p.moving = p.dir !== 0;
      if (p.dir !== 0) p.facing = p.dir;
      p.x += p.dir * speed * dt;
      if (p.caged && p.cageIndex >= 0) {
        const cx = room.cages[p.cageIndex].x;
        p.x = Math.max(cx - CELL_HALF + 8, Math.min(cx + CELL_HALF - 8, p.x));
      } else {
        p.x = Math.max(30, Math.min(WORLD_W - 30, p.x));
      }
      // task progress (hold-to-work)
      if (room.phase === "playing" && p.alive && !p.caged && p.role === "crew" && p.interactHeld && p.dir === 0) {
        for (const t of p.tasks) {
          if (t.done) continue;
          const st = STATIONS.find((s) => s.id === t.id)!;
          if (dist(st.x, p.x) < INTERACT_RANGE) {
            t.progress += (TICK_MS / TASK_HOLD_MS);
            if (t.progress >= 1) {
              t.progress = 1;
              t.done = true;
              record(room, p, "task_complete", { task: t.id });
              checkWin(room);
            }
          }
        }
      }
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
  const now = Date.now();
  me.lastSeen = now; // the 100ms state poll IS the presence heartbeat
  const ps = [...room.players.values()];
  const killCd = Math.max(0, me.killAt - now);
  const target = me.role === "hollow" ? killTarget(room, me) : null;

  let hint: string | null = null;
  if (me.alive && room.phase !== "lobby") {
    const b = room.phase === "playing" && !me.caged ? nearestBody(room, me) : null;
    const cageIdx = me.hasKey ? room.cages.findIndex((c) => c.occupant && dist(c.x, me.x) < INTERACT_RANGE) : -1;
    if (b) hint = `Report ${b.name}'s body`;
    else if (cageIdx >= 0) hint = `Unlock ${room.players.get(room.cages[cageIdx].occupant!)?.name}'s cage`;
    else if (room.keyX !== null && !me.caged && dist(room.keyX, me.x) < INTERACT_RANGE) hint = "Take the iron key";
    else if (room.phase === "playing" && !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE) hint = "Ring the bell";
    else if (room.phase === "playing" && me.alive && !me.caged) {
      const t = me.tasks.find((t) => !t.done && dist(STATIONS.find((s) => s.id === t.id)!.x, me.x) < INTERACT_RANGE);
      if (t) hint = `Hold E — ${STATIONS.find((s) => s.id === t.id)!.name}${me.role === "hollow" ? " (pretend)" : ""}`;
    }
  }

  const abilityLabel = me.role === "hollow" ? "Kill" : "Ring Bell";
  const abilityReady = me.alive && room.phase === "playing" && (
    me.role === "hollow" ? killCd <= 0 && !!target : !me.caged && !me.bellUsed && dist(me.x, BELL_X) < INTERACT_RANGE + 20
  );

  const crewAll = ps.filter((p) => p.role === "crew");
  const doneTasks = crewAll.reduce((n, p) => n + p.tasks.filter((t) => t.done).length, 0);

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
      blackoutCooldownMs: Math.max(0, room.blackoutReadyAt - now),
      canBlackout: me.role === "hollow" && me.alive && room.phase === "playing" && now >= room.blackoutReadyAt,
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
    cages: room.cages.map((c) => ({ x: c.x, occupant: c.occupant })),
    tasks: me.tasks.map((t) => {
      const st = STATIONS.find((s) => s.id === t.id)!;
      return { id: t.id, name: st.name, x: st.x, done: t.done, progress: t.progress };
    }),
    taskBar: { done: doneTasks, total: room.totalTasks },
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