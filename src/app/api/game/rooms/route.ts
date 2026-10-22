import { NextResponse } from "next/server";
import { listRooms } from "@/game/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ rooms: listRooms() });
}