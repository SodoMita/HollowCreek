import { NextRequest, NextResponse } from "next/server";

/** CORS for the game API so the static client (GitHub Pages / Newgrounds
 *  iframe / any origin) can talk to this authoritative server. */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function proxy(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };