import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { chronicleIsOpen } from "@/game/chronicle-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").toUpperCase();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  if (!(await chronicleIsOpen(code))) {
    return NextResponse.json({ error: "The ledger is sealed until match end." }, { status: 403 });
  }
  const rows = await db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.roomCode, code))
    .orderBy(desc(gameEvents.id))
    .limit(600);
  return NextResponse.json({ events: rows.reverse() });
}