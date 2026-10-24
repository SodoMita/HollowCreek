import { db } from "@/db";
import { roomRows } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getRoom } from "./engine";

/** The game-start event records roles. Never serve it while a night is live. */
export async function chronicleIsOpen(code: string): Promise<boolean> {
  const upper = code.trim().toUpperCase();
  if (!upper) return false;
  const live = getRoom(upper);
  // Live state wins over a write-behind DB row from a previous round.
  if (live) return live.phase === "ended";
  try {
    const [row] = await db.select({ phase: roomRows.phase })
      .from(roomRows).where(eq(roomRows.code, upper)).limit(1);
    return row?.phase === "ended";
  } catch {
    return false;
  }
}
