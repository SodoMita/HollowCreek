import { randomUUID } from "crypto";
import {
  BASE_SPEED,
  CAGES,
  CAGE_RANGE,
  COLORS,
  DISCUSS_MS,
  FLARE_COOLDOWN,
  FLARE_DURATION,
  FLARE_RADIUS,
  HEDGE_COOLDOWN,
  HEDGES,
  KILL_COOLDOWN,
  KILL_RANGE,
  MEETING_SPEED,
  MEETING_SPOTS,
  REVEAL_MS,
  REPORT_RANGE,
  SNUFF_COOLDOWN,
  SNUFF_DURATION,
  TASKS,
  TASKS_BY_ID,
  TASKS_PER_CREW,
  TASK_RANGE,
  TRAVEL_MS,
  VISION_CREW,
  VISION_DARK,
  VISION_IMPOSTOR,
  VISION_IMPOSTOR_DARK,
  VOTE_MS,
  WORLD_WIDTH,
  BUBBLE_MS,
  landmarkAt,
} from "@/lib/world";
import type {
  Bubble,
  ChatLine,
  EngineEvent,
  EventPayload,
  InputAction,
  LogLine,
  MeetingStage,
  Phase,
  PublicBody,
  PublicPlayer,
  Role,
  Snapshot,
  TaskState,
} from "@/lib/game-types";
import { recorder } from "./recorder";

type Player = {
  id: string;
  token: string;
  name: string;
  colorIdx: number;
  role: Role | null;
  alive: boolean;
  caged: boolean;
  cageIndex: number | null;
  cagedAt: number;
  x: number;
  desired: -1 | 0 | 1;
  facing: 1 | -1;
  tasks: { id: string; done: boolean }[];
  activeTaskId: string | null;
  activeTaskEnds: number;
  activeTaskStart: number;
  killAt: number;
  snuffAt: number;
  hedgeAt: number;
  flareAt: number;
  hasKey: boolean;
  kills: number;
  vote: string | null;
  lastSeen: number;
  lastMoveTick: number;
  lastMoveInputAt: number;
  lastRecordedDir: -1 | 0 | 1;
  spotX: number | null;
  isHost: boolean;
  joinedAt: number;
  /** 0 while a live SSE connection exists, otherwise the disconnect time */
  disconnectedAt: number;
};

type Body = {
  id: string;
  playerId: string;
  name: string;
  colorIdx: number;
  x: number;
  found: boolean;
};

type Subscriber = {
  playerId: string;
  write: (chunk: string) => void;
  lastEventId: number;
  close: () => void;
};

const now = () => Date.now();

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** How long a silent host keeps the role before the town hands it on. */
const HOST_GRACE_MS = 8_000;

export class Room {
  code: string;
  phase: Phase = "lobby";
  round = 0;
  phaseUntil: number | null = null;
  players = new Map<string, Player>();
  bodies: Body[] = [];
  cageOccupants: (string | null)[] = [null, null, null];
  keyX: number | null = null;
  keyRespawnAt = 0;
  darkUntil = 0;
  flare: { x: number; until: number; by: string } | null = null;
  meeting: {
    stage: MeetingStage;
    endsAt: number;
    calledBy: string | null;
    reason: string;
    outcome: string | null;
  } | null = null;
  bubbles: Bubble[] = [];
  chat: ChatLine[] = [];
  log: LogLine[] = [];
  events: EngineEvent[] = [];
  eventSeq = 0;
  seq = 0;
  subscribers = new Set<Subscriber>();
  subscriberCounts = new Map<string, number>();
  createdAt = now();
  lastActivity = now();
  lastTick = now();
  winner: Role | null = null;
  endText: string | null = null;

  constructor(code: string) {
    this.code = code;
  }

  get livingPlayers() {
    return [...this.players.values()].filter((p) => p.alive);
  }

  record(
    p: Player | null,
    type: string,
    opts: { x?: number | null; secret?: boolean; payload?: Record<string, unknown> } = {},
  ) {
    recorder.action({
      code: this.code,
      playerId: p?.id ?? "system",
      playerName: p?.name ?? "the town",
      type,
      x: opts.x ?? (p ? Math.round(p.x) : null),
      round: this.round,
      secret: opts.secret ?? false,
      payload: opts.payload ?? null,
    });
  }

  say(player: Player, text: string) {
    const clean = text.replace(/\s+/g, " ").slice(0, 120).trim();
    if (!clean) return;
    const ghost = !player.alive;
    const b: Bubble = {
      id: ++this.seq,
      playerId: player.id,
      name: player.name,
      color: COLORS[player.colorIdx].hex,
      text: clean,
      ghost,
      at: now(),
    };
    this.bubbles.push(b);
    if (this.bubbles.length > 60) this.bubbles.shift();
    this.chat.push({ id: b.id, name: b.name, color: b.color, text: clean, ghost, at: b.at });
    if (this.chat.length > 120) this.chat.shift();
    recorder.chat({
      code: this.code,
      playerId: player.id,
      name: player.name,
      text: clean,
      ghost,
    });
    this.record(player, "say", { payload: { text: clean, ghost } });
  }

  addLog(text: string, kind: LogLine["kind"] = "info") {
    this.log.push({ id: ++this.seq, at: now(), text, kind });
    if (this.log.length > 80) this.log.shift();
  }

  pushEvent(e: EventPayload) {
    const ev = { ...e, id: ++this.eventSeq } as EngineEvent;
    this.events.push(ev);
    if (this.events.length > 30) this.events.shift();
    return ev;
  }

  // ---------------------------------------------------------------- lifecycle

  addPlayer(name: string): { id: string; token: string } {
    const used = new Set([...this.players.values()].map((p) => p.colorIdx));
    let colorIdx = COLORS.findIndex((_, i) => !used.has(i));
    if (colorIdx < 0) colorIdx = Math.floor(Math.random() * COLORS.length);
    const id = randomUUID();
    const token = randomUUID();
    const started = this.phase !== "lobby";
    const p: Player = {
      id,
      token,
      name: name.slice(0, 14) || "Stranger",
      colorIdx,
      role: null,
      alive: !started,
      caged: false,
      cageIndex: null,
      cagedAt: 0,
      x: started ? MEETING_SPOTS[0] : 200 + Math.random() * 500,
      desired: 0,
      facing: 1,
      tasks: [],
      activeTaskId: null,
      activeTaskEnds: 0,
      activeTaskStart: 0,
      killAt: 0,
      snuffAt: 0,
      hedgeAt: 0,
      flareAt: 0,
      hasKey: false,
      kills: 0,
      vote: null,
      lastSeen: now(),
      lastMoveTick: now(),
      lastMoveInputAt: 0,
      lastRecordedDir: 0,
      spotX: null,
      isHost: this.players.size === 0,
      joinedAt: now(),
      disconnectedAt: 0,
    };
    this.players.set(id, p);
    this.lastActivity = now();
    this.addLog(`${p.name} arrived in Hollow Creek${started ? " (too late — only as a ghost)" : ""}`);
    this.record(p, "join");
    recorder.player({
      code: this.code,
      playerId: p.id,
      name: p.name,
      colorName: COLORS[p.colorIdx].name,
      role: p.role,
      alive: p.alive,
      caged: p.caged,
      tasksDone: 0,
      kills: 0,
    });
    this.pushPlayer(p);
    return { id, token };
  }

  /** Called by the SSE route when a client attaches. */
  onSubscribe(playerId: string) {
    const n = (this.subscriberCounts.get(playerId) ?? 0) + 1;
    this.subscriberCounts.set(playerId, n);
    const p = this.players.get(playerId);
    if (p) {
      if (p.disconnectedAt) {
        this.addLog(`${p.name} found their way back through the fog.`);
      }
      p.disconnectedAt = 0;
      p.lastSeen = now();
    }
    this.lastActivity = now();
  }

  /** Called by the SSE route when a client detaches (tab closed, network drop). */
  onUnsubscribe(playerId: string) {
    const n = (this.subscriberCounts.get(playerId) ?? 1) - 1;
    if (n > 0) {
      this.subscriberCounts.set(playerId, n);
      return;
    }
    this.subscriberCounts.delete(playerId);
    const p = this.players.get(playerId);
    if (p && p.disconnectedAt === 0) p.disconnectedAt = now();
  }

  isConnected(id: string) {
    return this.subscriberCounts.has(id);
  }

  /** A player is only really gone once their connection has been dead a while. */
  private reapDisconnected(t: number) {
    for (const p of [...this.players.values()]) {
      if (!p.disconnectedAt) continue;
      if (t - p.disconnectedAt > 75_000) {
        this.removePlayer(p.id);
      }
    }
    // host handoff: never leave the town without a live host
    const host = [...this.players.values()].find((p) => p.isHost);
    if (host && host.disconnectedAt && t - host.disconnectedAt > HOST_GRACE_MS) {
      const next = [...this.players.values()]
        .filter((p) => !p.disconnectedAt && p.id !== host.id)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        host.isHost = false;
        next.isHost = true;
        this.addLog(`${host.name} vanished — ${next.name} takes the lantern.`, "meeting");
        this.record(next, "host_promoted", { payload: { from: host.name } });
      }
    }
  }

  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.subscriberCounts.delete(id);
    if (p.cageIndex !== null) this.cageOccupants[p.cageIndex] = null;
    this.addLog(`${p.name} slipped away into the fog`);
    this.record(p, "leave");
    if (p.isHost) {
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        next.isHost = true;
        this.addLog(`${next.name} now holds the lantern`);
      }
    }
  }

  private pushPlayer(p: Player) {
    recorder.player({
      code: this.code,
      playerId: p.id,
      name: p.name,
      colorName: COLORS[p.colorIdx].name,
      role: p.role,
      alive: p.alive,
      caged: p.caged,
      tasksDone: p.tasks.filter((t) => t.done).length,
      kills: p.kills,
    });
  }

  start(playerId: string): string | null {
    const host = [...this.players.values()].find((p) => p.isHost);
    if (!host || host.id !== playerId) return "Only the host can ring the game in.";
    const total = this.players.size;
    if (total < 2) return "You need at least 2 souls for the ritual.";
    this.round += 1;
    const impostorCount = Math.max(1, Math.floor(total / 4));
    const order = shuffled([...this.players.values()]);
    const chosen = new Set(order.slice(0, impostorCount).map((p) => p.id));
    this.bodies = [];
    this.cageOccupants = [null, null, null];
    this.bubbles = [];
    this.chat = [];
    this.darkUntil = 0;
    this.flare = null;
    this.winner = null;
    this.endText = null;
    const spots = shuffled(MEETING_SPOTS);
    let i = 0;
    for (const p of this.players.values()) {
      p.role = chosen.has(p.id) ? "impostor" : "crew";
      p.alive = true;
      p.caged = false;
      p.cageIndex = null;
      p.kills = 0;
      p.vote = null;
      p.hasKey = false;
      p.desired = 0;
      p.facing = 1;
      p.killAt = now() + 8000;
      p.snuffAt = 0;
      p.hedgeAt = 0;
      p.flareAt = 0;
      p.activeTaskId = null;
      p.spotX = null;
      p.x = spots[i++ % spots.length] + (Math.random() * 40 - 20);
      const pool =
        p.role === "impostor"
          ? shuffled(TASKS).slice(0, TASKS_PER_CREW)
          : shuffled(TASKS).slice(0, TASKS_PER_CREW);
      p.tasks = pool.map((t) => ({ id: t.id, done: false }));
      this.pushPlayer(p);
    }
    this.keyX = pick(TASKS).x;
    this.keyRespawnAt = 0;
    this.phase = "playing";
    this.phaseUntil = null;
    this.addLog(`Night ${this.round} falls. ${impostorCount} of them walk among us.`, "meeting");
    this.pushEvent({ type: "start" });
    this.record(null, "game_start", { payload: { impostorCount, round: this.round } });
    recorder.game({
      code: this.code,
      hostName: host.name,
      phase: "playing",
      round: this.round,
      winner: null,
      endText: null,
    });
    for (const p of this.players.values()) {
      this.record(p, "role_assign", {
        secret: true,
        payload: { role: p.role },
      });
    }
    return null;
  }

  // ------------------------------------------------------------------ meeting

  startMeeting(caller: Player | null, reason: string) {
    this.phase = "meeting";
    this.meeting = {
      stage: "travel",
      endsAt: now() + TRAVEL_MS,
      calledBy: caller?.id ?? null,
      reason,
      outcome: null,
    };
    this.phaseUntil = this.meeting.endsAt;
    const living = this.livingPlayers;
    let i = 0;
    for (const p of this.players.values()) {
      p.vote = null;
      p.desired = 0;
      p.activeTaskId = null;
      if (!p.alive) {
        p.spotX = MEETING_SPOTS[(i++ + 3) % MEETING_SPOTS.length];
      } else if (p.caged && p.cageIndex !== null) {
        p.spotX = CAGES[p.cageIndex].x;
      } else {
        p.spotX = MEETING_SPOTS[i++ % MEETING_SPOTS.length];
      }
    }
    this.darkUntil = 0;
    this.pushEvent({ type: "bell" });
    this.addLog(`The bell tolls. ${reason}`, "meeting");
    this.record(caller, "meeting_called", { payload: { reason } });
    recorder.game({
      code: this.code,
      hostName: [...this.players.values()].find((p) => p.isHost)?.name ?? "?",
      phase: "meeting",
      round: this.round,
      winner: null,
      endText: null,
    });
  }

  private tally() {
    const m = this.meeting;
    if (!m) return;
    const votes = new Map<string, number>();
    let skip = 0;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (!p.vote) continue;
      if (p.vote === "skip") skip++;
      else votes.set(p.vote, (votes.get(p.vote) ?? 0) + 1);
    }
    let bestId: string | null = null;
    let bestN = 0;
    let tie = false;
    for (const [id, n] of votes) {
      if (n > bestN) {
        bestN = n;
        bestId = id;
        tie = false;
      } else if (n === bestN) {
        tie = true;
      }
    }
    const voters = [...this.players.values()].filter((p) => p.alive).length;
    if (!bestId || tie || bestN <= skip) {
      m.outcome = "The town could not agree. The bell falls silent.";
      this.addLog("The vote scattered like leaves. Nobody was caged.", "meeting");
      this.record(null, "vote_result", { payload: { result: "no-consensus", skip, bestN } });
      return;
    }
    const target = this.players.get(bestId);
    if (!target) return;
    if (target.caged) {
      // A majority voted for someone already behind bars -> they walk free.
      if (target.cageIndex !== null) this.cageOccupants[target.cageIndex] = null;
      target.caged = false;
      target.cageIndex = null;
      this.pushEvent({ type: "free", x: target.x });
      m.outcome = `${target.name} was voted out of the cage and set free.`;
      this.addLog(`The town voted to free ${target.name} from the cage.`, "cage");
      this.record(target, "freed_by_vote", { payload: { votes: bestN, of: voters } });
      this.pushPlayer(target);
      return;
    }
    let cageIdx = this.cageOccupants.findIndex((c) => c === null);
    if (cageIdx < 0) {
      // No free cell: the longest-held prisoner is turned out to make room.
      const held = this.livingPlayers
        .filter((p) => p.caged)
        .sort((a, b) => a.cagedAt - b.cagedAt)[0];
      if (held) {
        if (held.cageIndex !== null) this.cageOccupants[held.cageIndex] = null;
        held.caged = false;
        held.cageIndex = null;
        this.addLog(`The cages were full — ${held.name} was turned out into the square.`, "cage");
        this.pushEvent({ type: "free", x: held.x });
        this.record(held, "freed_overflow", { payload: {} });
        this.pushPlayer(held);
      }
      cageIdx = this.cageOccupants.findIndex((c) => c === null);
    }
    if (cageIdx < 0) {
      m.outcome = "Every cage is full. The town seethes.";
      return;
    }
    target.caged = true;
    target.cageIndex = cageIdx;
    target.cagedAt = now();
    target.x = CAGES[cageIdx].x;
    target.hasKey = false;
    this.cageOccupants[cageIdx] = target.id;
    this.pushEvent({ type: "cage", x: target.x });
    const wasImpostor = target.role === "impostor";
    m.outcome = `${target.name} was dragged to the cage — and ${wasImpostor ? "they WERE one of them." : "they were innocent."}`;
    this.addLog(
      `${target.name} was caged. ${wasImpostor ? "Something inside them was not human." : "Their weeping echoed off the square."}`,
      "cage",
    );
    this.record(target, "caged_by_vote", {
      payload: { votes: bestN, of: voters, wasImpostor },
    });
    this.pushPlayer(target);
  }

  private endMeeting() {
    this.meeting = null;
    this.phase = "playing";
    this.phaseUntil = null;
    for (const p of this.players.values()) {
      p.vote = null;
      p.spotX = null;
      p.hasKey = p.hasKey && p.alive && !p.caged;
      if (p.caged && p.cageIndex !== null) p.x = CAGES[p.cageIndex].x;
    }
    for (const p of this.players.values()) {
      if (p.role === "impostor" && p.alive && !p.caged) p.killAt = now() + 12000;
    }
    this.addLog("The town disperses back into the dark.", "meeting");
  }

  // --------------------------------------------------------------------- tick

  tick() {
    const t = now();
    this.reapDisconnected(t);
    const dt = Math.min(0.25, Math.max(0, (t - this.lastTick) / 1000));
    this.lastTick = t;

    for (const p of this.players.values()) {
      if (t - p.lastSeen > 60_000 && this.phase !== "ended") {
        p.desired = 0;
        p.activeTaskId = null;
      }
    }

    if (this.phase === "playing") {
      // watchdog: a client that stops sending input must not keep sliding
      for (const p of this.players.values()) {
        if (p.desired !== 0 && t - p.lastMoveInputAt > 1600) {
          p.desired = 0;
          this.record(p, "stop");
          p.lastRecordedDir = 0;
        }
      }
      this.tickPlaying(t, dt);
    }
    else if (this.phase === "meeting") this.tickMeeting(t, dt);

    // prune stale bubbles
    if (this.bubbles.length) this.bubbles = this.bubbles.filter((b) => t - b.at < BUBBLE_MS + 400);
  }

  private speedOf(p: Player) {
    if (!p.alive) return BASE_SPEED * 1.3;
    return BASE_SPEED;
  }

  private tickPlaying(t: number, dt: number) {
    for (const p of this.players.values()) {
      if (p.caged) {
        if (p.cageIndex !== null) p.x = CAGES[p.cageIndex].x;
        p.desired = 0;
        p.activeTaskId = null;
        continue;
      }
      if (p.desired !== 0) {
        p.facing = p.desired > 0 ? 1 : -1;
        p.activeTaskId = null;
      }
      p.lastMoveTick = t;
      p.x = Math.max(60, Math.min(WORLD_WIDTH - 60, p.x + p.desired * this.speedOf(p) * dt));
      if (p.activeTaskId) {
        const def = TASKS_BY_ID[p.activeTaskId];
        const stillInRange = def && Math.abs(def.x - p.x) <= TASK_RANGE + 40;
        if (!stillInRange || p.desired !== 0) p.activeTaskId = null;
        else if (t >= p.activeTaskEnds) {
          const task = p.tasks.find((x) => x.id === p.activeTaskId);
          if (task && !task.done) {
            task.done = true;
            this.addLog(`${p.name} ${def.name.toLowerCase()} at ${def.where}.`, "task");
            this.pushEvent({ type: "task", x: p.x });
            this.record(p, "task_complete", { payload: { task: def.id } });
            this.pushPlayer(p);
            this.checkTasksDone();
          }
          p.activeTaskId = null;
        }
      }
    }
    if (this.keyX === null && this.keyRespawnAt && t > this.keyRespawnAt) {
      this.keyX = pick(TASKS).x;
      this.keyRespawnAt = 0;
    }
    this.checkWin(t);
  }

  private checkTasksDone() {
    const crew = [...this.players.values()].filter((p) => p.role === "crew");
    if (!crew.length) return;
    const allDone = crew.every((p) => !p.alive || p.tasks.every((t) => t.done));
    if (allDone) this.finish("crew", "The last chore was finished. Dawn broke over Hollow Creek.");
  }

  private checkWin(t: number) {
    if (this.phase === "ended") return;
    const players = [...this.players.values()];
    const activeCrew = players.filter((p) => p.alive && !p.caged && p.role === "crew").length;
    const activeImp = players.filter((p) => p.alive && !p.caged && p.role === "impostor").length;
    const neutralImp = players.filter((p) => p.alive && p.caged && p.role === "impostor").length;
    const crewAlive = players.filter((p) => p.alive && p.role === "crew").length;
    if (activeImp === 0) {
      this.finish(
        "crew",
        neutralImp > 0
          ? "The last of them is behind bars. The town breathes again."
          : "Every one of them is dead. The town breathes again.",
      );
      return;
    }
    if (crewAlive === 0) {
      this.finish("impostor", "Nobody is left standing.");
      return;
    }
    if (activeCrew === 0 && crewAlive === 0) {
      this.finish("impostor", "The town belongs to them now.");
      return;
    }
    if (activeImp >= activeCrew && activeCrew > 0) {
      this.finish("impostor", "Too few were left to fight back.");
    }
    void t;
  }

  finish(winner: Role, text: string) {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.winner = winner;
    this.endText = text;
    this.meeting = null;
    this.phaseUntil = null;
    this.addLog(text, "end");
    this.pushEvent({ type: "end", winner });
    this.record(null, "game_end", { payload: { winner, text } });
    recorder.game({
      code: this.code,
      hostName: [...this.players.values()].find((p) => p.isHost)?.name ?? "?",
      phase: "ended",
      round: this.round,
      winner,
      endText: text,
    });
    for (const p of this.players.values()) this.pushPlayer(p);
  }

  private tickMeeting(t: number, dt: number) {
    const m = this.meeting;
    if (!m) {
      this.phase = "playing";
      return;
    }
    if (m.stage === "travel") {
      let settled = true;
      for (const p of this.players.values()) {
        const target = p.spotX;
        if (target == null) continue;
        const dx = target - p.x;
        if (Math.abs(dx) > 14) {
          settled = false;
          const step = Math.sign(dx) * MEETING_SPEED * dt;
          p.x = Math.abs(step) > Math.abs(dx) ? target : p.x + step;
          p.facing = dx > 0 ? 1 : -1;
        } else {
          p.x = target;
        }
      }
      if (settled || t >= m.endsAt) {
        m.stage = "discuss";
        m.endsAt = t + DISCUSS_MS;
        this.phaseUntil = m.endsAt;
        this.addLog("The town gathers at the cages. Accusations begin.", "meeting");
      }
      return;
    }
    if (m.stage === "discuss") {
      if (t >= m.endsAt) {
        m.stage = "vote";
        m.endsAt = t + VOTE_MS;
        this.phaseUntil = m.endsAt;
      }
      return;
    }
    if (m.stage === "vote") {
      const voters = this.livingPlayers;
      const done = voters.every((p) => p.vote !== null);
      if (done || t >= m.endsAt) {
        this.tally();
        m.stage = "reveal";
        m.endsAt = t + REVEAL_MS;
        this.phaseUntil = m.endsAt;
      }
      return;
    }
    if (m.stage === "reveal") {
      if (t >= m.endsAt) {
        this.checkWin(t);
        if (this.phase !== "ended") this.endMeeting();
      }
    }
  }

  // -------------------------------------------------------------------- input

  handle(playerId: string, token: string, action: InputAction): string | null {
    const p = this.players.get(playerId);
    if (!p || p.token !== token) return "Unknown soul.";
    p.lastSeen = now();
    if (p.disconnectedAt) p.disconnectedAt = 0;
    this.lastActivity = now();
    const t = now();
    const inMeeting = this.phase === "meeting";

    switch (action.type) {
      case "move": {
        if (inMeeting && p.alive) return null;
        const dir = action.dir === 0 ? 0 : action.dir > 0 ? 1 : -1;
        p.desired = dir;
        p.lastMoveInputAt = t;
        if (dir !== p.lastRecordedDir) {
          this.record(p, dir === 0 ? "stop" : dir > 0 ? "walk_right" : "walk_left");
          p.lastRecordedDir = dir;
        }
        return null;
      }
      case "face": {
        p.facing = action.dir > 0 ? 1 : -1;
        return null;
      }
      case "interactStart": {
        if (!p.alive || inMeeting) return null;
        if (p.caged) return null;
        // 1. cage key use
        if (p.hasKey) {
          const cage = CAGES.find((c) => {
            const occ = this.cageOccupants[c.id];
            return occ && Math.abs(c.x - p.x) <= CAGE_RANGE;
          });
          if (cage) {
            const occId = this.cageOccupants[cage.id];
            const occ = occId ? this.players.get(occId) : null;
            if (occ) {
              this.cageOccupants[cage.id] = null;
              occ.caged = false;
              occ.cageIndex = null;
              p.hasKey = false;
              this.keyX = cage.x;
              this.keyRespawnAt = 0;
              this.pushEvent({ type: "free", x: cage.x });
              this.addLog(`${p.name} turned the key and freed ${occ.name}.`, "cage");
              this.record(p, "key_used", { payload: { freed: occ.name }, x: cage.x });
              this.record(occ, "freed_by_key", { x: cage.x });
              this.pushPlayer(occ);
              return null;
            }
          }
        }
        // 2. pick up key
        if (this.keyX !== null && !p.hasKey && Math.abs(this.keyX - p.x) <= TASK_RANGE) {
          p.hasKey = true;
          this.keyX = null;
          this.addLog(`${p.name} picked up the cage key.`, "info");
          this.record(p, "key_pickup");
          return null;
        }
        // 3. start a task
        const task = TASKS.find(
 (td) => Math.abs(td.x - p.x) <= TASK_RANGE && p.tasks.some((x) => x.id === td.id && !x.done),
        );
        if (task) {
          p.activeTaskId = task.id;
          p.activeTaskStart = t;
          p.activeTaskEnds = t + task.dur * 1000;
          this.record(p, "task_start", { payload: { task: task.id } });
        }
        return null;
      }
      case "interactStop": {
        if (p.activeTaskId) {
          this.record(p, "task_abort", { payload: { task: p.activeTaskId } });
          p.activeTaskId = null;
        }
        return null;
      }
      case "report": {
        if (!p.alive || inMeeting) return "Nothing to report.";
        const body = this.bodies.find(
          (b) => !b.found && Math.abs(b.x - p.x) <= REPORT_RANGE,
        );
        if (!body) return "No body within reach.";
        body.found = true;
        this.pushEvent({ type: "report", x: body.x });
        this.record(p, "report_body", { payload: { victim: body.name }, x: body.x });
        this.startMeeting(p, `${p.name} found ${body.name}'s body in the ${landmarkName(body.x)}.`);
        return null;
      }
      case "kill": {
        if (!p.alive || inMeeting) return "Not now.";
        if (p.role !== "impostor") return "Your hands are only human.";
        if (p.caged) return "The bars hold you.";
        if (t < p.killAt) return "Not yet.";
        let target: Player | null = null;
        let best = Infinity;
        for (const o of this.players.values()) {
          if (o.id === p.id || !o.alive) continue;
          if (o.role === "impostor") continue;
          const d = Math.abs(o.x - p.x);
          if (d <= KILL_RANGE && d < best) {
            best = d;
            target = o;
          }
        }
        if (!target) return "Nobody close enough.";
        target.alive = false;
        target.activeTaskId = null;
        target.hasKey = false;
        p.kills += 1;
        p.killAt = t + KILL_COOLDOWN;
        if (target.caged) {
          if (target.cageIndex !== null) this.cageOccupants[target.cageIndex] = null;
          target.caged = false;
          target.cageIndex = null;
          this.addLog(`${target.name} was found dead in their cage.`, "kill");
        } else {
          this.bodies.push({
            id: randomUUID(),
            playerId: target.id,
            name: target.name,
            colorIdx: target.colorIdx,
            x: target.x,
            found: false,
          });
        }
        this.pushEvent({ type: "kill", x: target.x });
        this.record(p, "kill", { secret: true, payload: { victim: target.name }, x: target.x });
        this.record(target, "killed", { secret: true, x: target.x });
        this.pushPlayer(p);
        this.pushPlayer(target);
        this.checkWin(t);
        return null;
      }
      case "snuff": {
        if (!p.alive || p.role !== "impostor" || inMeeting) return "Not now.";
        if (t < p.snuffAt) return "Not yet.";
        p.snuffAt = t + SNUFF_COOLDOWN;
        this.darkUntil = t + SNUFF_DURATION;
        this.pushEvent({ type: "snuff" });
        this.addLog("Every lantern in town went out at once.", "info");
        this.record(p, "lights_snuffed", { secret: true });
        return null;
      }
      case "hedge": {
        if (!p.alive || p.role !== "impostor" || inMeeting) return "Not now.";
        if (t < p.hedgeAt) return "Not yet.";
        const nearest = HEDGES.find((h) => Math.abs(h - p.x) <= TASK_RANGE);
        if (nearest === undefined) return "No hedge here.";
        const idx = HEDGES.indexOf(nearest);
        const nextIdx = (idx + (action.dir > 0 ? 1 : HEDGES.length - 1)) % HEDGES.length;
        p.x = HEDGES[nextIdx];
        p.hedgeAt = t + HEDGE_COOLDOWN;
        this.record(p, "hedge_travel", { secret: true, payload: { from: nearest, to: HEDGES[nextIdx] } });
        return null;
      }
      case "flare": {
        if (!p.alive || inMeeting || p.caged) return "Not now.";
        if (t < p.flareAt) return "Not yet.";
        p.flareAt = t + FLARE_COOLDOWN;
        this.flare = { x: p.x, until: t + FLARE_DURATION, by: p.id };
        this.pushEvent({ type: "flare", x: p.x });
        this.addLog(`${p.name} lit a flare. The dark pulled back for a moment.`, "info");
        this.record(p, "flare");
        return null;
      }
      case "say": {
        this.say(p, action.text);
        return null;
      }
      case "vote": {
        if (!inMeeting || !this.meeting) return "There is no vote.";
        if (this.meeting.stage !== "vote" && this.meeting.stage !== "discuss") return "Too late.";
        if (!p.alive) return "The dead do not vote.";
        if (action.type !== "vote") return null;
        const target = action.target;
        if (target !== "skip" && !this.players.has(target)) return "Invalid vote.";
        p.vote = target;
        this.record(p, "vote", { payload: { target: target === "skip" ? "skip" : this.players.get(target)?.name ?? target } });
        const voters = this.livingPlayers;
        if (voters.every((v) => v.vote !== null) && this.meeting.stage === "vote") {
          this.meeting.endsAt = t;
        }
        return null;
      }
      case "start": {
        if (this.phase === "ended") {
          this.phase = "lobby";
          this.winner = null;
          this.endText = null;
          this.addLog("The survivors gather again.", "info");
          return null;
        }
        return this.start(p.id);
      }
      case "leave": {
        this.removePlayer(p.id);
        return null;
      }
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------- snapshot

  visionOf(viewer: Player, t: number) {
    if (!viewer.alive) return 1e9;
    if (viewer.caged) return VISION_CREW;
    let v = viewer.role === "impostor" ? VISION_IMPOSTOR : VISION_CREW;
    if (this.darkUntil > t) v = viewer.role === "impostor" ? VISION_IMPOSTOR_DARK : VISION_DARK;
    if (this.flare && this.flare.until > t && Math.abs(this.flare.x - viewer.x) < FLARE_RADIUS) {
      v = Math.max(v, FLARE_RADIUS);
    }
    return v;
  }

  private taskStates(p: Player): TaskState[] {
    return p.tasks.map((t) => {
      const def = TASKS_BY_ID[t.id];
      const active = p.activeTaskId === t.id;
      const dur = def ? def.dur * 1000 : 1000;
      return {
        id: t.id,
        name: def?.name ?? t.id,
        icon: def?.icon ?? "•",
        where: def?.where ?? "",
        x: def?.x ?? 0,
        done: t.done,
        active,
        progress: active
          ? Math.max(0, Math.min(1, (now() - p.activeTaskStart) / dur))
          : t.done
            ? 1
            : 0,
      };
    });
  }

  private promptFor(p: Player, t: number) {
    if (!p.alive || p.caged) return null;
    if (p.hasKey) {
      const cage = CAGES.find((c) => {
        const occ = this.cageOccupants[c.id];
        return occ && Math.abs(c.x - p.x) <= CAGE_RANGE;
      });
      if (cage) {
        const occId = this.cageOccupants[cage.id];
        const occ = occId ? this.players.get(occId) : null;
        if (occ) {
          return {
            kind: "cage" as const,
            label: `Unlock the cage — ${occ.name}`,
            sub: "uses the iron key",
            progress: 0,
          };
        }
      }
    }
    if (this.keyX !== null && !p.hasKey && Math.abs(this.keyX - p.x) <= TASK_RANGE) {
      return {
        kind: "task" as const,
        label: "Take the iron key",
        sub: "opens one cage",
        progress: 0,
      };
    }
    const task = TASKS.find(
      (td) => Math.abs(td.x - p.x) <= TASK_RANGE && p.tasks.some((x) => x.id === td.id && !x.done),
    );
    if (task) {
      const active = p.activeTaskId === task.id;
      const progress = active
        ? Math.max(0, Math.min(1, (t - p.activeTaskStart) / (task.dur * 1000)))
        : 0;
      return {
        kind: "task" as const,
        label: task.name,
        sub: task.where,
        progress,
      };
    }
    return null;
  }

  snapshot(playerId: string): Snapshot | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    const t = now();
    const vision = this.visionOf(p, t);
    const revealRoles = this.phase === "ended" || !p.alive;

    const players: PublicPlayer[] = [];
    for (const o of this.players.values()) {
      if (o.id !== p.id) {
        if (!o.alive && p.alive) continue;
        if (Math.abs(o.x - p.x) > vision) continue;
      }
      players.push({
        id: o.id,
        name: o.name,
        color: COLORS[o.colorIdx].hex,
        colorName: COLORS[o.colorIdx].name,
        x: o.x,
        facing: o.facing,
        moving: o.desired !== 0 || (this.meeting?.stage === "travel" && o.alive),
        alive: o.alive,
        caged: o.caged,
        ghost: !o.alive,
        isYou: o.id === p.id,
        isHost: o.isHost,
        connected: !o.disconnectedAt,
        role: o.id === p.id || revealRoles ? (o.role ?? undefined) : undefined,
        busy: o.id === p.id ? 0 : o.activeTaskId ? 1 : 0,
        hasKey: o.hasKey,
        lantern: o.alive,
      });
    }

    const bodies: PublicBody[] = this.bodies
      .filter((b) => Math.abs(b.x - p.x) <= vision)
      .map((b) => ({
        id: b.id,
        name: b.name,
        color: COLORS[b.colorIdx].hex,
        x: b.x,
        found: b.found,
      }));

    // server-computed dread: quantised so it reads as a feeling, not a radar
    let danger = 0;
    if (p.alive && p.role === "crew") {
      const dist = [...this.players.values()]
        .filter((o) => o.alive && !o.caged && o.role === "impostor")
        .reduce((m, o) => Math.min(m, Math.abs(o.x - p.x)), Infinity);
      if (Number.isFinite(dist) && dist < 780) danger = 1 - dist / 780;
      if (this.darkUntil > t) danger = Math.max(danger, 0.55);
      danger = Math.round(danger * 5) / 5;
    }

    const crew = [...this.players.values()].filter((x) => x.role === "crew");
    const totalTasks = crew.length * TASKS_PER_CREW;
    const doneTasks = crew.reduce(
      (n, x) => n + x.tasks.filter((tt) => tt.done).length,
      0,
    );
    const alivePlayers = [...this.players.values()].filter((x) => x.alive);
    const aliveCrew = alivePlayers.filter((x) => x.role === "crew").length;
    const aliveImp = alivePlayers.filter((x) => x.role === "impostor").length;
    const totalImp = [...this.players.values()].filter((x) => x.role === "impostor").length;

    const canSeeBubble = (b: Bubble) => {
      if (b.playerId === p.id) return true;
      if (b.ghost) return !p.alive;
      const sender = this.players.get(b.playerId);
      if (!sender) return false;
      return Math.abs(sender.x - p.x) <= vision;
    };

    const myMeeting = this.meeting
      ? {
          stage: this.meeting.stage,
          endsAt: this.meeting.endsAt,
          calledBy: this.meeting.calledBy,
          calledByName: this.meeting.calledBy
            ? (this.players.get(this.meeting.calledBy)?.name ?? null)
            : null,
          reason: this.meeting.reason,
          options: [...this.players.values()]
            .filter((o) => o.alive)
            .map((o) => ({
              id: o.id,
              name: o.name,
              color: COLORS[o.colorIdx].hex,
              caged: o.caged,
              dead: !o.alive,
            })),
          votes: Object.fromEntries(
            [...this.players.values()]
              .filter((o) => o.alive && o.vote)
              .map((o) => [o.id, o.vote as string]),
          ),
          myVote: p.vote,
          outcome: this.meeting.outcome,
        }
      : null;

    const visibleEvents = this.events.filter((e) => {
      if (e.id <= 0) return false;
      if (e.type === "bell" || e.type === "start" || e.type === "end" || e.type === "snuff") {
        return true;
      }
      const ex = "x" in e ? (e as { x?: number }).x : undefined;
      if (ex === undefined || !p.alive) return true;
      return Math.abs(ex - p.x) <= Math.max(vision * 1.5, 500);
    });

    return {
      t,
      now: t,
      code: this.code,
      phase: this.phase,
      round: this.round,
      phaseEndsAt: this.phaseUntil,
      you: {
        id: p.id,
        name: p.name,
        color: COLORS[p.colorIdx].hex,
        colorName: COLORS[p.colorIdx].name,
        role: p.role,
        alive: p.alive,
        caged: p.caged,
        ghost: !p.alive,
        isHost: p.isHost,
        x: p.x,
        facing: p.facing,
        vision,
        tasks: this.taskStates(p),
        tasksDone: p.tasks.filter((x) => x.done).length,
        tasksTotal: p.tasks.length,
        hasKey: p.hasKey,
        connected: !p.disconnectedAt,
        blackoutCooldownMs: Math.max(0, p.snuffAt - t),
        prompt: this.promptFor(p, t),
        cooldowns: {
          kill: Math.max(0, p.killAt - t),
          snuff: Math.max(0, p.snuffAt - t),
          hedge: Math.max(0, p.hedgeAt - t),
          flare: Math.max(0, p.flareAt - t),
        },
        dark: this.darkUntil > t,
      },
      players,
      bodies,
      cages: CAGES.map((c) => ({ x: c.x, occupant: this.cageOccupants[c.id] })),
      keyX: this.keyX,
      keyTakenUntil: this.keyRespawnAt || null,
      danger,
      blackoutUntil: this.darkUntil,
      taskProgress: totalTasks ? doneTasks / totalTasks : 0,
      aliveCrew,
      aliveImpostors: aliveImp,
      totalImpostors: totalImp,
      meeting: myMeeting,
      bubbles: this.bubbles.filter((b) => t - b.at < BUBBLE_MS && canSeeBubble(b)),
      chat: this.chat.filter((c) => t - c.at < 90_000).slice(-40),
      log: this.log.slice(-14),
      events: visibleEvents,
      winner: this.winner,
      endText: this.endText,
    };
  }
}

function landmarkName(x: number) {
  return landmarkAt(x).name;
}

export class Engine {
  rooms = new Map<string, Room>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickAll(), 50);
  }

  tickAll() {
    const t = now();
    for (const room of this.rooms.values()) {
      room.tick();
      if (room.subscribers.size > 0) this.broadcast(room);
      const idle = t - room.lastActivity;
      const empty = room.players.size === 0 && room.subscribers.size === 0;
      if (idle > (empty ? 5 : 20) * 60_000) {
        void recorder.flush();
        this.rooms.delete(room.code);
      }
    }
  }

  broadcast(room: Room) {
    for (const sub of room.subscribers) {
      const snap = room.snapshot(sub.playerId);
      if (!snap) {
        sub.close();
        room.subscribers.delete(sub);
        continue;
      }
      const events = snap.events.filter((e) => e.id > sub.lastEventId);
      sub.lastEventId = Math.max(
        sub.lastEventId,
        ...snap.events.map((e) => e.id),
        0,
      );
      try {
        sub.write(`data: ${JSON.stringify({ ...snap, events })}\n\n`);
      } catch {
        sub.close();
        room.subscribers.delete(sub);
      }
    }
  }

  createRoom(): Room {
    let code = "";
    do {
      code = Array.from({ length: 4 }, () => pick(CODE_CHARS.split(""))).join("");
    } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    recorder.game({
      code,
      hostName: "?",
      phase: "lobby",
      round: 0,
      winner: null,
      endText: null,
    });
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  ensure(code: string): Room {
    const c = code.toUpperCase();
    let r = this.rooms.get(c);
    if (!r) {
      r = new Room(c);
      this.rooms.set(c, r);
    }
    return r;
  }

  list() {
    return [...this.rooms.values()]
      .filter((r) => r.players.size > 0 || Date.now() - r.createdAt < 10 * 60_000)
      .map((r) => ({
        code: r.code,
        players: [...r.players.values()].filter((p) => !p.disconnectedAt).length,
        phase: r.phase,
        round: r.round,
        names: [...r.players.values()].map((p) => p.name),
      }))
      .sort((a, b) => b.players - a.players)
      .slice(0, 12);
  }
}

const globalForEngine = globalThis as typeof globalThis & { __hollowEngine?: Engine };

export const engine: Engine =
  globalForEngine.__hollowEngine ?? (globalForEngine.__hollowEngine = new Engine());

engine.start();
