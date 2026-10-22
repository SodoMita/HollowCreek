import { sql } from "drizzle-orm";
import { db } from "@/db";
import { playerStats } from "@/db/schema";

export type StatField =
  | "games" | "wins" | "losses" | "kills" | "deaths" | "tasksDone"
  | "chatChars" | "cagings" | "reports" | "unlocks" | "blackouts" | "bells" | "playtimeSec";

const COLS = {
  games: playerStats.games,
  wins: playerStats.wins,
  losses: playerStats.losses,
  kills: playerStats.kills,
  deaths: playerStats.deaths,
  tasksDone: playerStats.tasksDone,
  chatChars: playerStats.chatChars,
  cagings: playerStats.cagings,
  reports: playerStats.reports,
  unlocks: playerStats.unlocks,
  blackouts: playerStats.blackouts,
  bells: playerStats.bells,
  playtimeSec: playerStats.playtimeSec,
} as const;

/** Fire-and-forget atomic increment — one bad write can never break the game. */
export function bumpStats(playerId: string, name: string, deltas: Partial<Record<StatField, number>>) {
  const entries = Object.entries(deltas).filter(([, v]) => typeof v === "number" && v !== 0) as [StatField, number][];
  if (entries.length === 0) return;
  const values: Record<string, number> = {};
  const set: Record<string, unknown> = { name, updatedAt: new Date() };
  for (const [k, v] of entries) {
    values[k] = v;
    set[k] = sql`${COLS[k]} + ${v}`;
  }
  db.insert(playerStats)
    .values({ playerId, name, ...values })
    .onConflictDoUpdate({ target: playerStats.playerId, set })
    .catch((e) => console.error("stats write failed", e));
}