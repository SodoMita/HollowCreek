import { NextResponse } from "next/server";
import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { chronicleIsOpen } from "@/game/chronicle-access";

export const dynamic = "force-dynamic";

const CODE = /^[A-Za-z0-9]{1,16}$/;

/**
 * The town ledger for one room, oldest first (JSON). Sealed (403) while the
 * night is still being lived: the ledger names the Hollow, and no soul may
 * read the ending before it happens. 503 when the database is unreachable.
 */
export async function GET(req: Request) {
  const code = (new URL(req.url).searchParams.get("code") ?? "").trim().toUpperCase();
  if (!CODE.test(code)) {
    return NextResponse.json({ ok: false, error: "A town code is needed." }, { status: 400 });
  }
  if (!(await chronicleIsOpen(code))) {
    return NextResponse.json({ ok: false, sealed: true, code }, { status: 403 });
  }
  try {
    const rows = await db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.roomCode, code))
      .orderBy(desc(gameEvents.id))
      .limit(800);
    return NextResponse.json({ ok: true, code, events: rows.reverse() });
  } catch (e) {
    console.error("chronicle read failed", e);
    return NextResponse.json({ ok: false, dbDown: true, code }, { status: 503 });
  }
}
