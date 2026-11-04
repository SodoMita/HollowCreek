// Canonical, server-validated shape of a client input. Replays must produce
// byte-identical bodies, so this whitelist is the single source of truth.
import type { InputBody } from "./types";
import { NOTE_TEXT_MAX } from "./types";

export const INPUT_ACTIONS = ["interact", "ability", "blackout", "vote", "start", "restart", "leave", "drop_supply", "sabotage", "ward_move", "ward_cancel", "door_lock", "time_travel", "time_return", "pin_note"] as const;

export function canonicalInput(body: InputBody): InputBody {
  const result: InputBody = { playerId: body.playerId };
  if (typeof body.dir === "number" && Number.isFinite(body.dir)) result.dir = body.dir;
  if (typeof body.interactHeld === "boolean") result.interactHeld = body.interactHeld;
  if (typeof body.cartHeld === "boolean") result.cartHeld = body.cartHeld;
  if (typeof body.action === "string" && [...INPUT_ACTIONS].includes(body.action)) result.action = body.action;
  if (typeof body.wardId === "string") result.wardId = body.wardId.slice(0, 128);
  if (typeof body.move === "number" && Number.isFinite(body.move)) result.move = body.move;
  if (typeof body.chat === "string") result.chat = body.chat.trim().slice(0, 120);
  if (typeof body.vote === "string") result.vote = body.vote; // preserve exact legacy player IDs during replay
  if (typeof body.targetAt === "number" && Number.isFinite(body.targetAt)) result.targetAt = body.targetAt;
  if (typeof body.noteText === "string") result.noteText = body.noteText.slice(0, NOTE_TEXT_MAX + 60); // server rejects overlong text
  return result;
}
