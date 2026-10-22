import { db } from "@/db";
import { actionLog, chatLog, gamePlayers, games } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

type ActionRow = {
  code: string;
  playerId: string;
  playerName: string;
  type: string;
  x?: number | null;
  round?: number;
  secret?: boolean;
  payload?: Record<string, unknown> | null;
};

type ChatRow = {
  code: string;
  playerId: string;
  name: string;
  text: string;
  ghost: boolean;
};

type PlayerRow = {
  code: string;
  playerId: string;
  name: string;
  colorName: string;
  role: string | null;
  alive: boolean;
  caged: boolean;
  tasksDone: number;
  kills: number;
};

type GameRow = {
  code: string;
  hostName: string;
  phase: string;
  round: number;
  winner: string | null;
  endText: string | null;
};

/**
 * Write-behind queue. The authoritative simulation never awaits the database -
 * rows are batched and flushed on an interval so a slow disk can never stall
 * the 20Hz game loop.
 */
class Recorder {
  private actions: ActionRow[] = [];
  private chats: ChatRow[] = [];
  private players = new Map<string, PlayerRow>();
  private games = new Map<string, GameRow>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), 700);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      // keep node free to exit
    }
  }

  action(row: ActionRow) {
    this.actions.push(row);
    if (this.actions.length > 800) this.actions.splice(0, this.actions.length - 800);
  }

  chat(row: ChatRow) {
    this.chats.push(row);
  }

  player(row: PlayerRow) {
    this.players.set(`${row.code}:${row.playerId}`, row);
  }

  game(row: GameRow) {
    this.games.set(row.code, row);
  }

  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    const actions = this.actions;
    const chats = this.chats;
    const players = [...this.players.values()];
    const gameRows = [...this.games.values()];
    this.actions = [];
    this.chats = [];
    this.players.clear();
    this.games.clear();
    try {
      const mapAction = (a: ActionRow) => ({
        code: a.code,
        playerId: a.playerId,
        playerName: a.playerName,
        type: a.type,
        x: a.x == null ? null : Math.round(Number.isFinite(a.x) ? (a.x as number) : 0),
        round: Math.round(a.round ?? 0),
        secret: a.secret ?? false,
        payload: a.payload ?? null,
      });
      if (actions.length) {
        const rows = actions.map(mapAction);
        try {
          await db.insert(actionLog).values(rows);
        } catch {
          // never lose the whole batch over one bad row
          for (const row of rows) {
            try {
              await db.insert(actionLog).values(row);
            } catch (e) {
              console.warn("[recorder] dropped one action row", e);
            }
          }
        }
      }
      if (chats.length) {
        try {
          await db.insert(chatLog).values(chats);
        } catch {
          for (const c of chats) {
            try {
              await db.insert(chatLog).values(c);
            } catch {
              /* drop */
            }
          }
        }
      }
      for (const g of gameRows) {
        await db
          .insert(games)
          .values({
            code: g.code,
            hostName: g.hostName,
            phase: g.phase,
            round: g.round,
            winner: g.winner,
            endText: g.endText,
          })
          .onConflictDoUpdate({
            target: games.code,
            set: { phase: g.phase, round: g.round, winner: g.winner, endText: g.endText },
          });
      }
      for (const p of players) {
        await db
          .insert(gamePlayers)
          .values(p)
          .onConflictDoUpdate({
            target: gamePlayers.playerId,
            set: {
              name: p.name,
              colorName: p.colorName,
              role: p.role,
              alive: p.alive,
              caged: p.caged,
              tasksDone: p.tasksDone,
              kills: p.kills,
            },
          });
      }
    } catch (err) {
      console.warn("[recorder] flush failed", err);
    } finally {
      this.flushing = false;
    }
  }

  /** Full history of a room, used by the chronicle page. */
  async chronicle(code: string) {
    try {
      const [rows, chat] = await Promise.all([
        db
          .select()
          .from(actionLog)
          .where(eq(actionLog.code, code))
          .orderBy(actionLog.id)
          .limit(4000),
        db.select().from(chatLog).where(eq(chatLog.code, code)).orderBy(chatLog.id).limit(2000),
      ]);
      return { actions: rows, chat };
    } catch (err) {
      console.warn("[recorder] chronicle failed", err);
      return { actions: [], chat: [] };
    }
  }

  async stats() {
    try {
      const rows = await db.execute<{ games: number; actions: number }>(
        sql`select (select count(*)::int from games) as games, (select count(*)::int from action_log) as actions`,
      );
      const r = (rows.rows?.[0] ?? { games: 0, actions: 0 }) as { games: number; actions: number };
      return { games: Number(r.games ?? 0), actions: Number(r.actions ?? 0) };
    } catch {
      return { games: 0, actions: 0 };
    }
  }
}

const globalForRecorder = globalThis as typeof globalThis & { __hollowRecorder?: Recorder };

export const recorder: Recorder =
  globalForRecorder.__hollowRecorder ?? (globalForRecorder.__hollowRecorder = new Recorder());

recorder.start();
