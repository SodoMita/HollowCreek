import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").toUpperCase();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  const rows = await db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.roomCode, code))
    .orderBy(desc(gameEvents.id))
    .limit(600);
  return NextResponse.json({ events: rows.reverse() });
}