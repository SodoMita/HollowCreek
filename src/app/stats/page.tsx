"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Row = {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  tasksDone: number;
  chatLines: number;
  chatChars: number;
  playMs: number;
  reports: number;
  caged: number;
  blackouts: number;
};

type Global = {
  souls: number; games: number; wins: number; kills: number; deaths: number;
  tasksDone: number; chatChars: number; chatLines: number; playMs: number;
  reports: number; caged: number;
};

const SORTS = ["wins", "kills", "tasksDone", "playMs", "chatChars", "deaths"] as const;
type Sort = (typeof SORTS)[number];

function hms(ms: number) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function StatsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [global, setGlobal] = useState<Global | null>(null);
  const [sort, setSort] = useState<Sort>("wins");
  const [me, setMe] = useState<string>("");

  useEffect(() => {
    setMe(localStorage.getItem("hc_pid") ?? "");
    const load = async () => {
      try {
        const r = await fetch("/api/game/stats", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { rows: Row[]; global: Global };
        setRows(d.rows ?? []);
        setGlobal(d.global ?? null);
      } catch {
        /* keep whatever we have */
      }
    };
    void load();
    const iv = setInterval(() => void load(), 6000);
    return () => clearInterval(iv);
  }, []);

  const sorted = useMemo(() => [...rows].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0)), [rows, sort]);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#0b0710] text-[#e9dfcf]">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#120b1e] via-[#25142a] to-[#3a1c18]" />
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-[#c9762f]">the town records</p>
            <h1 className="mt-2 font-display text-4xl sm:text-6xl">Who survived Hollow Creek</h1>
            <p className="mt-2 max-w-xl text-sm text-[#9c8b7a]">
              Every night, kill, cage, chore and word is kept. This is the ledger of
              everyone who ever walked the street.
            </p>
          </div>
          <Link
            href="/"
            className="rounded border border-[#3a2733] px-4 py-2 text-sm text-[#9c8b7a] transition hover:text-[#d99a3d]"
          >
            ← back to the road
          </Link>
        </div>

        {/* global summary */}
        <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["souls", global?.souls ?? 0],
            ["nights", global?.games ?? 0],
            ["kills", global?.kills ?? 0],
            ["deaths", global?.deaths ?? 0],
            ["chores done", global?.tasksDone ?? 0],
            ["time in town", hms(global?.playMs ?? 0)],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border border-[#3a2733] bg-[#140d18]/80 p-3">
              <div className="font-display text-2xl text-[#d99a3d]">{value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-[#8f7d6b]">{label}</div>
            </div>
          ))}
        </div>

        {/* sort */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-[#6b5a55]">rank by</span>
          {SORTS.map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`rounded border px-3 py-1.5 text-xs transition ${
                sort === s
                  ? "border-[#c9762f] bg-[#c9762f]/15 text-[#d99a3d]"
                  : "border-[#3a2733] text-[#9c8b7a] hover:text-[#d99a3d]"
              }`}
            >
              {s === "playMs" ? "playtime" : s === "chatChars" ? "words written" : s}
            </button>
          ))}
        </div>

        {/* table */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#3a2733] bg-[#140d18]/80">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#0d0810] text-[10px] uppercase tracking-widest text-[#8f7d6b]">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">soul</th>
                <th className="px-3 py-3 text-right">nights</th>
                <th className="px-3 py-3 text-right">wins</th>
                <th className="px-3 py-3 text-right">losses</th>
                <th className="px-3 py-3 text-right">kills</th>
                <th className="px-3 py-3 text-right">deaths</th>
                <th className="px-3 py-3 text-right">chores</th>
                <th className="px-3 py-3 text-right">reports</th>
                <th className="px-3 py-3 text-right">caged</th>
                <th className="px-3 py-3 text-right">words</th>
                <th className="px-3 py-3 text-right">playtime</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-[#6b5a55]">
                    Nobody has walked the street yet.
                  </td>
                </tr>
              )}
              {sorted.map((r, i) => {
                const mine = r.playerId === me;
                return (
                  <tr
                    key={r.playerId}
                    className={`border-t border-[#2a1a26] ${mine ? "bg-[#c9762f]/10" : ""}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-[#6b5a55]">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className={mine ? "text-[#d99a3d]" : "text-[#e9dfcf]"}>{r.name}</span>
                      {mine && <span className="ml-2 text-[10px] uppercase tracking-widest text-[#c9762f]">you</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">{r.games}</td>
                    <td className="px-3 py-2 text-right text-[#a8c98a]">{r.wins}</td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">{r.losses}</td>
                    <td className="px-3 py-2 text-right text-[#ff6a5a]">{r.kills}</td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">{r.deaths}</td>
                    <td className="px-3 py-2 text-right text-[#d8c9b4]">{r.tasksDone}</td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">{r.reports}</td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">{r.caged}</td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">
                      {r.chatChars}
                      <span className="ml-1 text-[10px] text-[#5a4a50]">in {r.chatLines}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-[#9c8b7a]">{hms(r.playMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-[#6b5a55]">
          Wins and losses are counted for the side you were on when the night ended. Playtime
          accrues only while you are alive during a night. Words written counts every character
          you spoke, caged or not.
        </p>
      </div>
    </main>
  );
}
