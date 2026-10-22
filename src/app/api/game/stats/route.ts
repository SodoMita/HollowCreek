import { NextResponse } from "next/server";
import { db } from "@/db";
import { playerStats } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Lifetime records for every soul who ever walked the street (JSON). */
export async function GET() {
  let rows: (typeof playerStats.$inferSelect)[] = [];
  try {
    rows = await db.select().from(playerStats).orderBy(desc(playerStats.wins), desc(playerStats.games)).limit(200);
  } catch (e) {
    console.error("stats read failed", e);
  }
  const global = rows.reduce(
    (a, r) => ({
      souls: a.souls + 1,
      games: a.games + r.games,
      wins: a.wins + r.wins,
      losses: a.losses + r.losses,
      kills: a.kills + r.kills,
      deaths: a.deaths + r.deaths,
      tasksDone: a.tasksDone + r.tasksDone,
      chatChars: a.chatChars + r.chatChars,
      cagings: a.cagings + r.cagings,
      reports: a.reports + r.reports,
      unlocks: a.unlocks + r.unlocks,
      blackouts: a.blackouts + r.blackouts,
      bells: a.bells + r.bells,
      playtimeSec: a.playtimeSec + r.playtimeSec,
    }),
    {
      souls: 0, games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, tasksDone: 0,
      chatChars: 0, cagings: 0, reports: 0, unlocks: 0, blackouts: 0, bells: 0, playtimeSec: 0,
    }
  );
  return NextResponse.json({ global, rows });
}