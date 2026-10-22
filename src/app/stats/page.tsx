import { db } from "@/db";
import { playerStats } from "@/db/schema";
import { desc } from "drizzle-orm";
import Link from "next/link";
import {
  ArrowLeft, Clock, DoorOpen, Footprints, KeyRound, MessageSquare,
  Moon, Skull, Sword, Trophy, Wheat, Bell,
} from "lucide-react";

export const dynamic = "force-dynamic";

function fmtTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default async function StatsPage() {
  const rows = await db
    .select()
    .from(playerStats)
    .orderBy(desc(playerStats.wins), desc(playerStats.games))
    .limit(200);

  const totals = rows.reduce(
    (a, r) => ({
      games: a.games + r.games,
      kills: a.kills + r.kills,
      deaths: a.deaths + r.deaths,
      tasks: a.tasks + r.tasksDone,
      chars: a.chars + r.chatChars,
      time: a.time + r.playtimeSec,
    }),
    { games: 0, kills: 0, deaths: 0, tasks: 0, chars: 0, time: 0 }
  );

  const cols: { key: string; label: string; icon: React.ReactNode; get: (r: (typeof rows)[number]) => string | number; title: string }[] = [
    { key: "games", label: "Nights", icon: <Moon className="h-3.5 w-3.5" />, get: (r) => r.games, title: "Games played" },
    { key: "wins", label: "Wins", icon: <Trophy className="h-3.5 w-3.5" />, get: (r) => r.wins, title: "Nights survived / claimed" },
    { key: "losses", label: "Losses", icon: <Skull className="h-3.5 w-3.5" />, get: (r) => r.losses, title: "Lost nights" },
    { key: "kills", label: "Kills", icon: <Sword className="h-3.5 w-3.5" />, get: (r) => r.kills, title: "Kills as the Hollow" },
    { key: "deaths", label: "Deaths", icon: <Footprints className="h-3.5 w-3.5" />, get: (r) => r.deaths, title: "Times found dead" },
    { key: "tasks", label: "Wards", icon: <Wheat className="h-3.5 w-3.5" />, get: (r) => r.tasksDone, title: "Chores completed" },
    { key: "cagings", label: "Caged", icon: <DoorOpen className="h-3.5 w-3.5" />, get: (r) => r.cagings, title: "Times voted into a cage" },
    { key: "unlocks", label: "Freed", icon: <KeyRound className="h-3.5 w-3.5" />, get: (r) => r.unlocks, title: "Prisoners freed with the iron key" },
    { key: "reports", label: "Reports", icon: <Skull className="h-3.5 w-3.5" />, get: (r) => r.reports, title: "Bodies reported" },
    { key: "bells", label: "Bells", icon: <Bell className="h-3.5 w-3.5" />, get: (r) => r.bells, title: "Times the bell was rung" },
    { key: "chars", label: "Letters", icon: <MessageSquare className="h-3.5 w-3.5" />, get: (r) => r.chatChars, title: "Characters spoken into the night" },
    { key: "time", label: "Time", icon: <Clock className="h-3.5 w-3.5" />, get: (r) => fmtTime(r.playtimeSec), title: "Time spent in the dark" },
  ];

  return (
    <main className="min-h-screen bg-[#0b0710] px-4 py-10">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-b from-[#120b1e]/60 via-transparent to-transparent" />
      <div className="relative mx-auto max-w-5xl">
        <Link href="/" className="flex w-fit items-center gap-1.5 text-sm text-[#9c8b7a] transition hover:text-[#d99a3d]">
          <ArrowLeft className="h-4 w-4" /> back to the crossroads
        </Link>
        <h1 className="mt-3 font-display text-6xl text-[#e9dfcf] drop-shadow-[0_4px_24px_rgba(200,90,40,0.3)]">Hall of Records</h1>
        <p className="mt-2 max-w-xl italic text-[#9c8b7a]">
          The town clerk writes down everything — every night endured, every blade,
          every cage, every letter spoken into the fog. He does not judge. He only counts.
        </p>

        {/* town totals */}
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 rounded border border-[#3a2733] bg-[#140d18]/70 px-4 py-3 text-sm text-[#c9b8a4]">
          <span><b className="text-[#d99a3d]">{rows.length}</b> souls recorded</span>
          <span><b className="text-[#d99a3d]">{totals.games}</b> nights played</span>
          <span><b className="text-[#e06a5a]">{totals.kills}</b> kills · <b className="text-[#e06a5a]">{totals.deaths}</b> deaths</span>
          <span><b className="text-[#a8c98a]">{totals.tasks}</b> wards restored</span>
          <span><b className="text-[#d99a3d]">{totals.chars.toLocaleString()}</b> letters spoken</span>
          <span><b className="text-[#d99a3d]">{fmtTime(totals.time)}</b> in the dark</span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-10 text-lg italic text-[#6b5a55]">
            The ledger is empty. No soul has yet finished a night in Hollow Creek.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded border border-[#3a2733] bg-[#140d18]/60">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-[#3a2733] text-left text-xs uppercase tracking-wider text-[#9c8b7a]">
                  <th className="px-4 py-3">Soul</th>
                  {cols.map((c) => (
                    <th key={c.key} className="px-3 py-3" title={c.title}>
                      <span className="flex items-center gap-1.5">{c.icon}{c.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.playerId} className={`border-b border-[#241a26] transition hover:bg-[#1d1420]/70 ${i < 3 ? "bg-[#1c1210]/40" : ""}`}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {i === 0 ? <Trophy className="h-4 w-4 text-[#d99a3d]" />
                          : i === 1 ? <Trophy className="h-4 w-4 text-[#9aa0a8]" />
                          : i === 2 ? <Trophy className="h-4 w-4 text-[#a06a3c]" />
                          : <span className="w-4 text-center font-mono text-xs text-[#5a4a50]">{i + 1}</span>}
                        <b className="text-[#e9dfcf]">{r.name}</b>
                        {r.games > 0 && (
                          <span className="text-xs text-[#6b5a55]">{Math.round((100 * r.wins) / r.games)}%</span>
                        )}
                      </span>
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 font-mono ${c.key === "wins" ? "text-[#a8c98a]" : c.key === "kills" || c.key === "deaths" ? "text-[#e08a7a]" : "text-[#c9b8a4]"}`}>
                        {c.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-xs text-[#6b5a55]">
          Records follow the soul (your browser identity) across towns and nights. Playtime counts nights seen through to the end.
        </p>
      </div>
    </main>
  );
}