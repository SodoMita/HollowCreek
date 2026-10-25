import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { loadRoom } from "@/game/engine";
import { EXPANDED_ICE_SERVERS, voiceCanHear, voiceGainFor, voicePanFor } from "@/game/voice-range";

export const dynamic = "force-dynamic";

const PRESENCE_MS = 12_000;
const MAX_SIGNAL_BYTES = 64_000;
type SignalType = "offer" | "answer" | "candidate";
type Signal = { from: string; type: SignalType; data: Record<string, unknown> };
export type AudioPacket = {
  id: number;
  from: string;
  chunk: string;
  rate: number;
  at: number;
};
type VoiceRoom = {
  listeners: Map<string, { session: string; seen: number }>;
  inbox: Map<string, Signal[]>;
  audioQueue: AudioPacket[];
  audioSeq: number;
  rates: Map<string, { start: number; count: number }>;
};
const globalVoice = globalThis as typeof globalThis & { __hollowVoiceRooms?: Map<string, VoiceRoom> };
const rooms = globalVoice.__hollowVoiceRooms ?? new Map<string, VoiceRoom>();
globalVoice.__hollowVoiceRooms = rooms;

function voiceRoom(code: string): VoiceRoom {
  let current = rooms.get(code);
  if (!current) {
    current = { listeners: new Map(), inbox: new Map(), audioQueue: [], audioSeq: 0, rates: new Map() };
    rooms.set(code, current);
  }
  return current;
}
function prune(v: VoiceRoom, room: NonNullable<Awaited<ReturnType<typeof loadRoom>>>) {
  const now = Date.now();
  for (const [id, entry] of v.listeners) {
    if (!room.players.has(id) || now - entry.seen > PRESENCE_MS) {
      v.listeners.delete(id);
      v.inbox.delete(id);
      v.rates.delete(id);
    }
  }
}

/** Position and role stay on the server; only the playback gain is returned. */
function volume(room: NonNullable<Awaited<ReturnType<typeof loadRoom>>>, listenerId: string, speakerId: string) {
  const listener = room.players.get(listenerId);
  const speaker = room.players.get(speakerId);
  if (!listener || !speaker || listenerId === speakerId || !voiceCanHear(listener.alive, speaker.alive)) return 0;
  return voiceGainFor(Math.abs(listener.x - speaker.x), listener.caged, speaker.caged);
}
function validSession(v: VoiceRoom, playerId: string, session: string) {
  return !!session && v.listeners.get(playerId)?.session === session;
}
function bad(error: string, status: number) { return NextResponse.json({ ok: false, error }, { status }); }

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  const playerId = req.nextUrl.searchParams.get("playerId") ?? "";
  const session = req.nextUrl.searchParams.get("session") ?? "";
  const room = code && playerId ? await loadRoom(code) : undefined;
  if (!room || !room.players.has(playerId)) return bad("No such soul in this town.", 404);
  const v = rooms.get(code);
  if (!v) return bad("Voice is not enabled for this seat.", 403);
  prune(v, room);
  if (!validSession(v, playerId, session)) {
    if (v.listeners.size === 0) rooms.delete(code);
    return bad("Voice is not enabled for this seat.", 403);
  }
  v.listeners.get(playerId)!.seen = Date.now();
  if (req.nextUrl.searchParams.get("config") === "1") {
    const iceServers: { urls: string; username?: string; credential?: string }[] = [...EXPANDED_ICE_SERVERS];
    const urls = process.env.VOICE_TURN_URL;
    const username = process.env.VOICE_TURN_USERNAME;
    const credential = process.env.VOICE_TURN_CREDENTIAL;
    if (urls && username && credential) iceServers.push({ urls, username, credential });
    return NextResponse.json({ ok: true, iceServers }, { headers: { "Cache-Control": "no-store" } });
  }
  const peers = [...v.listeners.keys()]
    .filter((id) => volume(room, playerId, id) > 0)
    .map((id) => ({
      id, name: room.players.get(id)!.name,
      gain: volume(room, playerId, id),
      pan: voicePanFor(room.players.get(id)!.x - room.players.get(playerId)!.x),
    }));
  const signals = (v.inbox.get(playerId) ?? []).filter((msg) =>
    v.listeners.has(msg.from) && volume(room, playerId, msg.from) > 0);
  v.inbox.set(playerId, []);

  // Server audio relay fallback: filter queued audio from speakers in earshot
  const sinceAudio = Number(req.nextUrl.searchParams.get("sinceAudio") ?? "0") || 0;
  const now = Date.now();
  const nearbySpeakers = new Set(peers.map((p) => p.id));
  const audioChunks = v.audioQueue
    .filter((c) => c.id > sinceAudio && c.from !== playerId && nearbySpeakers.has(c.from) && now - c.at < 3500)
    .map((c) => ({
      id: c.id,
      from: c.from,
      chunk: c.chunk,
      rate: c.rate,
    }));
  const lastAudioSeq = v.audioSeq;

  return NextResponse.json({ ok: true, peers, signals, audioChunks, lastAudioSeq }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_SIGNAL_BYTES + 2000) return bad("Voice message too large.", 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { return bad("Invalid voice message.", 400); }
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const action = body.action;
  const session = typeof body.session === "string" ? body.session : "";
  const room = code && playerId ? await loadRoom(code) : undefined;
  if (!room || !room.players.has(playerId)) return bad("No such soul in this town.", 404);
  const v = action === "join" ? voiceRoom(code) : rooms.get(code);
  if (!v) return bad("Voice is not enabled for this seat.", 403);
  prune(v, room);

  if (action === "join") {
    const existing = v.listeners.get(playerId);
    if (existing && existing.session !== session) return bad("Voice is already active in another tab. Try again shortly.", 409);
    const token = existing?.session ?? randomUUID();
    v.listeners.set(playerId, { session: token, seen: Date.now() });
    if (!v.inbox.has(playerId)) v.inbox.set(playerId, []);
    return NextResponse.json({ ok: true, session: token });
  }
  if (!validSession(v, playerId, session)) return bad("Voice is not enabled for this seat.", 403);
  v.listeners.get(playerId)!.seen = Date.now();
  if (action === "leave") {
    v.listeners.delete(playerId);
    v.inbox.delete(playerId);
    v.rates.delete(playerId);
    if (v.listeners.size === 0) rooms.delete(code);
    return NextResponse.json({ ok: true });
  }
  if (action === "audio") {
    const chunk = typeof body.chunk === "string" ? body.chunk : "";
    if (!chunk || chunk.length > 35000) return bad("Invalid audio chunk.", 400);
    const rate = Number(body.rate) || 12000;
    const packet: AudioPacket = {
      id: ++v.audioSeq,
      from: playerId,
      chunk,
      rate,
      at: Date.now(),
    };
    v.audioQueue.push(packet);
    const cutoff = Date.now() - 3500;
    while (v.audioQueue.length > 0 && (v.audioQueue[0].at < cutoff || v.audioQueue.length > 160)) {
      v.audioQueue.shift();
    }
    return NextResponse.json({ ok: true, id: v.audioSeq });
  }
  if (action !== "signal") return bad("Unknown voice action.", 400);
  const to = typeof body.to === "string" ? body.to : "";
  const type = body.type;
  if (!to || !v.listeners.has(to) || volume(room, playerId, to) <= 0) {
    return bad("That voice is out of earshot.", 403);
  }
  if (type !== "offer" && type !== "answer" && type !== "candidate") return bad("Invalid signal type.", 400);
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data) || JSON.stringify(data).length > MAX_SIGNAL_BYTES) {
    return bad("Invalid signal data.", 400);
  }
  if ((type === "offer" || type === "answer") && (data as Record<string, unknown>).type !== type) {
    return bad("Invalid session description.", 400);
  }
  const rate = v.rates.get(playerId) ?? { start: Date.now(), count: 0 };
  if (Date.now() - rate.start > 1000) { rate.start = Date.now(); rate.count = 0; }
  if (++rate.count > 60) return bad("Too many voice signals.", 429);
  v.rates.set(playerId, rate);
  const inbox = v.inbox.get(to) ?? [];
  inbox.push({ from: playerId, type, data: data as Record<string, unknown> });
  if (inbox.length > 150) inbox.splice(0, inbox.length - 150);
  v.inbox.set(to, inbox);
  return NextResponse.json({ ok: true });
}
