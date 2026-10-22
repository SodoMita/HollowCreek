import { NextResponse } from "next/server";
import { db } from "@/db";
import { playerStats } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export type StatsRow = {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  tasksDone: number;
  chatLines: number;
  chatChars: number;
  playMs: number;
  reports: number;
  caged: number;
  blackouts: number;
};

/** Lifetime records for every soul who ever walked the street. */
export async function GET() {
  let rows: StatsRow[] = [];
  try {
    rows = (await db.select().from(playerStats).orderBy(desc(playerStats.wins)).limit(200)) as StatsRow[];
  } catch (e) {
    console.error("stats read failed", e);
  }
  const global = rows.reduce(
    (a, r) => ({
      souls: a.souls + 1,
      games: a.games + r.games,
      wins: a.wins + r.wins,
      kills: a.kills + r.kills,
      deaths: a.deaths + r.deaths,
      tasksDone: a.tasksDone + r.tasksDone,
      chatChars: a.chatChars + r.chatChars,
      chatLines: a.chatLines + r.chatLines,
      playMs: a.playMs + r.playMs,
      reports: a.reports + r.reports,
      caged: a.caged + r.caged,
    }),
    {
      souls: 0, games: 0, wins: 0, kills: 0, deaths: 0, tasksDone: 0,
      chatChars: 0, chatLines: 0, playMs: 0, reports: 0, caged: 0,
    },
  );
  void sql;
  return NextResponse.json({ global, rows });
}
