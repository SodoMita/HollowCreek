import { NextResponse } from "next/server";
import { listRooms } from "@/game/engine";

export const dynamic = "force-dynamic";

/** Room-selection menu: every town that still exists, with who is in it. */
export async function GET() {
  const rooms = await listRooms();
  return NextResponse.json({ rooms });
}
