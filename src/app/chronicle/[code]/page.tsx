import { db } from "@/db";
import { gameEvents } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { chronicleIsOpen } from "@/game/chronicle-access";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, [string, string]> = {
  room_created: ["🏚", "A town was founded"],
  join: ["🚶", "arrived in town"],
  game_start: ["🌒", "Night fell — roles were dealt"],
  move_input: ["👣", "changed direction"],
  chat: ["💬", "spoke"],
  task_complete: ["🕯", "finished a chore"],
  kill: ["🩸", "killed"],
  report: ["❗", "reported a body"],
  ring_bell: ["🔔", "rang the bell"],
  meeting_start: ["🔔", "A meeting was called"],
  vote: ["⚖️", "voted"],
  meeting_result: ["📜", "The verdict was tallied"],
  unlock_cage: ["🗝", "unlocked a cage"],
  pickup_key: ["🗝", "took the iron key"],
  blackout: ["🌑", "snuffed every lantern in town"],
  leave: ["🚪", "left the town"],
  rejoin: ["🔁", "returned to their old seat"],
  restart: ["🕯", "gathered the same souls for another night"],
  room_restored: ["🏚", "the town was remembered after the long dark"],
  seat_claimed: ["🪑", "reclaimed their old seat"],
  game_end: ["🌅", "The tale ended"],
};

export default async function ChroniclePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // The ledger is sealed while the night is still being lived — it names the
  // Hollow, and no soul may read the ending before it happens.
  if (!(await chronicleIsOpen(code))) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#0b0710] px-6 text-center">
        <Lock className="h-12 w-12 text-[#8f3b1f]" />
        <h1 className="mt-4 font-display text-5xl text-[#e9dfcf]">The ledger is sealed</h1>
        <p className="mt-3 max-w-md italic text-[#9c8b7a]">
          The clerk&rsquo;s hand is still moving. The chronicle of {code.toUpperCase()} may
          only be read once the night has ended — from the records shown at match end.
        </p>
        <Link href={`/room/${code.toUpperCase()}`} className="mt-6 rounded bg-[#8f3b1f] px-6 py-2.5 font-display text-xl text-[#f3e6d0] hover:bg-[#a84a26]">
          Back to the street
        </Link>
      </main>
    );
  }
  const rows = await db
    .select()
    .from(gameEvents)
    .where(eq(gameEvents.roomCode, code.toUpperCase()))
    .orderBy(desc(gameEvents.id))
    .limit(800);
  const events = rows.reverse();

  return (
    <main className="min-h-screen bg-[#0b0710] px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-[#9c8b7a] hover:text-[#d99a3d]">← back to the crossroads</Link>
        <h1 className="mt-2 font-display text-5xl text-[#e9dfcf]">The Chronicle of {code.toUpperCase()}</h1>
        <p className="mt-2 italic text-[#9c8b7a]">
          Every step, word, vote and kill — written down by the town clerk, who saw more than he said.
        </p>
        <div className="mt-8 space-y-1.5">
          {events.length === 0 && <p className="text-[#6b5a55]">Nothing is written here yet.</p>}
          {events.map((e) => {
            const [icon, label] = TYPE_LABELS[e.type] ?? ["•", e.type];
            const d = (e.data ?? {}) as Record<string, unknown>;
            const detail =
              e.type === "chat" ? `“${String(d.text ?? "")}”${d.ghost ? " (ghost whisper)" : ""}${d.caged ? " (from the cage)" : ""}`
              : e.type === "kill" ? `${String(d.victim ?? "")}${d.victimCaged ? " — inside their cage" : ""}`
              : e.type === "vote" ? `for ${String(d.target ?? "")}`
              : e.type === "move_input" ? `dir ${String(d.dir ?? "")}`
              : e.type === "task_complete" ? String(d.task ?? "")
              : e.type === "meeting_start" ? String(d.reason ?? "")
              : e.type === "game_end" ? `${String(d.winner ?? "")} — ${String(d.reason ?? "")}`
              : e.type === "meeting_result" ? JSON.stringify(d.tally ?? {})
              : e.type === "unlock_cage" ? `freed ${String(d.freed ?? "")}`
              : "";
            const danger = e.type === "kill" || e.type === "game_end";
            return (
              <div key={e.id} className={`flex items-baseline gap-3 rounded border px-3 py-2 text-sm ${danger ? "border-[#4a1210] bg-[#1c0e0e]/60" : "border-[#241a26] bg-[#140d18]/60"}`}>
                <span className="shrink-0 font-mono text-xs text-[#6b5a55]">
                  {new Date(e.createdAt).toLocaleTimeString()}
                </span>
                <span className="shrink-0">{icon}</span>
                <span className="text-[#d8c9b4]">
                  {e.playerName ? <b className="text-[#e9dfcf]">{e.playerName}</b> : <i className="text-[#9c8b7a]">the town</i>}{" "}
                  {label} {detail && <span className="italic text-[#9c8b7a]">{detail}</span>}
                </span>
                {typeof d.x === "number" && <span className="ml-auto shrink-0 font-mono text-xs text-[#5a4a50]">x:{d.x}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}