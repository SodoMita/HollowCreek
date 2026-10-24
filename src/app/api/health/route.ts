import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensurePolishWorker } from "@/server/polish-supervisor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    ensurePolishWorker();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
