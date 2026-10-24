"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, DoorOpen, Flame, Moon, Plus, RefreshCw, Skull, Trophy, Users } from "lucide-react";
import Link from "next/link";
import type { RoomListing } from "@/game/types";
import { SettingsStore, applyDocumentPreferences, createDefaultSettings, keyLabel, type GameSettings } from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";

function getPid(): string {
  let pid = localStorage.getItem("hc_pid");
  if (!pid) {
    pid = crypto.randomUUID();
    localStorage.setItem("hc_pid", pid);
  }
  return pid;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [settings, setSettings] = useState<GameSettings>(createDefaultSettings);
  const settingsDialog = useRef<SettingsDialog | null>(null);

  useEffect(() => {
    setName(localStorage.getItem("hc_name") ?? "");
    const store = new SettingsStore();
    setSettings(store.value);
    applyDocumentPreferences(store.value);
    const unsubscribe = store.subscribe((next) => {
      setSettings(next);
      applyDocumentPreferences(next);
    });
    const dialog = new SettingsDialog(store);
    settingsDialog.current = dialog;
    return () => {
      unsubscribe();
      dialog.destroy();
      settingsDialog.current = null;
    };
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const r = await fetch("/api/game/rooms");
      const d = await r.json();
      setRooms(d.rooms ?? []);
    } catch { /* keep last list */ }
    setRoomsLoaded(true);
  }, []);

  useEffect(() => {
    void refreshRooms();
    const t = setInterval(refreshRooms, 3000);
    return () => clearInterval(t);
  }, [refreshRooms]);

  const saveName = () => localStorage.setItem("hc_name", name.trim() || "Stranger");

  const create = async () => {
    setBusy(true); setError(null);
    saveName();
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: getPid(), name: name.trim() || "Stranger" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      router.push(`/room/${data.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  const join = async (target?: string) => {
    const c = (target ?? code).trim().toUpperCase();
    if (c.length < 4) { setError("Enter the 4-letter town code."); return; }
    setBusy(true); setError(null);
    saveName();
    try {
      const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: c, playerId: getPid(), name: name.trim() || "Stranger" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to join");
      if (data.playerId) localStorage.setItem("hc_pid", data.playerId);
      router.push(`/room/${c}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b0710]">
      {/* sky */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#120b1e] via-[#33172b] to-[#6e3320]" />
      {/* moon */}
      <div className="pointer-events-none absolute right-[12%] top-[10%] h-28 w-28 rounded-full bg-[#e8ddc0] shadow-[0_0_90px_40px_rgba(240,225,190,0.25)]" />
      {/* falling leaves */}
      {settings.graphics.particles && Array.from({ length: 14 }).map((_, i) => (
        <span
          key={i}
          className="pointer-events-none absolute top-0 block h-2.5 w-3.5 rounded-[60%_40%_60%_40%]"
          style={{
            left: `${(i * 7.3 + 3) % 100}%`,
            background: ["#b4552a", "#c9762f", "#8f3b1f", "#d99a3d"][i % 4],
            animation: `hc-leaf-fall ${9 + (i % 5) * 2.4}s ${(i * 1.7) % 9}s linear infinite`,
          }}
        />
      ))}
      {/* fog */}
      {settings.graphics.fog && <div
        className="pointer-events-none absolute bottom-[16%] left-[-10%] h-40 w-[120%] rounded-full bg-[#8a7f95]/10 blur-2xl"
        style={{ animation: "hc-fog-drift 14s ease-in-out infinite" }}
      />}
      {/* skyline silhouette */}
      <svg className="pointer-events-none absolute bottom-0 left-0 w-full" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden>
        <path
          d="M0,260 L0,190 L60,190 L60,150 L110,150 L110,190 L160,190 L160,120 L175,100 L190,120 L190,190 L260,190 L260,160 L330,160 L330,190 L390,190 L390,90 L400,60 L410,90 L410,190 L470,190 L470,140 L540,140 L540,190 L610,190 L610,110 L660,80 L710,110 L710,190 L780,190 L780,150 L840,150 L840,190 L900,190 L920,60 L940,190 L1000,190 L1000,130 L1070,130 L1070,190 L1200,190 L1200,260 Z"
          fill="#0d0810"
        />
        <rect x="395" y="120" width="10" height="14" fill="#e8a04a" opacity="0.8" />
        <rect x="640" y="120" width="12" height="16" fill="#e8a04a" opacity="0.7" />
        <rect x="270" y="168" width="10" height="12" fill="#e8a04a" opacity="0.6" />
        <rect x="0" y="188" width="1200" height="72" fill="#0a0609" />
      </svg>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12 lg:flex-row lg:items-center lg:gap-16">
        {/* left: title & lore */}
        <div className="flex-1">
          <p className="hc-rise font-body text-sm uppercase tracking-[0.4em] text-[#c9762f]">October, 1893 · population: uncertain</p>
          <h1 className="hc-title-flicker hc-rise-1 mt-3 font-display text-7xl leading-none text-[#e9dfcf] drop-shadow-[0_4px_24px_rgba(200,90,40,0.35)] sm:text-8xl">
            Hollow<br />Creek
          </h1>
          <p className="hc-rise-2 mt-6 max-w-md text-lg leading-relaxed text-[#c9b8a4]">
            The harvest was good. Then the church bell rang on its own, and not
            everyone who came home was <em>people</em> anymore. The wards lie broken.
            Bring kits from the one movable supply cart, mend the street, and watch your neighbours.
          </p>
          <p className="hc-rise-3 mt-4 max-w-md text-[#8f7d6b]">
            When the bell tolls, walk to the square and vote. The condemned are
            not hanged here — they are <span className="text-[#d99a3d]">caged in iron</span>,
            still able to plead… until a key, a vote, or the Hollow sets them free.
          </p>
          <div className="hc-rise-3 mt-8 grid max-w-lg grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [`${keyLabel(settings.controls.left)} / ${keyLabel(settings.controls.right)}`, "walk the street"],
              [keyLabel(settings.controls.interact), settings.controls.interactMode === "hold" ? "take / deliver kit · hold to repair" : "take / deliver kit · toggle repair"],
              [`${keyLabel(settings.controls.ability)} / ${keyLabel(settings.controls.blackout)}`, "role ability · snuff lights"],
              [keyLabel(settings.controls.chat), "speak (bubble)"],
            ].map(([k, v]) => (
              <div key={k} className="rounded border border-[#3a2733] bg-[#160e1a]/80 p-3">
                <div className="font-mono text-[#d99a3d]">{k}</div>
                <div className="mt-1 text-xs text-[#9c8b7a]">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* right: forms */}
        <div className="hc-rise-2 w-full max-w-sm shrink-0 rounded-lg border border-[#3a2733] bg-[#140d18]/90 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-3xl text-[#e9dfcf]">Enter the town</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => settingsDialog.current?.open()}
                className="rounded border border-[#3a2733] px-2.5 py-1.5 text-xs text-[#c9b8a4] transition hover:border-[#c9762f]/40 hover:text-[#ffd98a]"
                aria-label="Open settings"
              >⚙ Settings</button>
              <Link
                href="/stats"
                className="flex items-center gap-1.5 rounded border border-[#3a2733] px-2.5 py-1.5 text-xs text-[#9c8b7a] transition hover:border-[#c9762f]/40 hover:text-[#d99a3d]"
              >
                <Trophy className="h-3.5 w-3.5" /> Records
              </Link>
            </div>
          </div>
          <label className="mt-5 block text-xs uppercase tracking-widest text-[#9c8b7a]">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={14}
            placeholder="Stranger"
            className="mt-1 w-full rounded border border-[#3a2733] bg-[#0d0810] px-3 py-2.5 text-[#e9dfcf] outline-none placeholder:text-[#5a4a50] focus:border-[#c9762f]"
          />
          <button
            onClick={create}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#8f3b1f] px-4 py-3 font-display text-xl tracking-wide text-[#f3e6d0] transition hover:bg-[#a84a26] disabled:opacity-50"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} /> Found a new town
          </button>
          <div className="my-5 flex items-center gap-3 text-xs text-[#5a4a50]">
            <div className="h-px flex-1 bg-[#3a2733]" /> or travel to one <div className="h-px flex-1 bg-[#3a2733]" />
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="CODE"
              className="w-full rounded border border-[#3a2733] bg-[#0d0810] px-3 py-2.5 text-center font-mono text-xl tracking-[0.5em] text-[#d99a3d] outline-none placeholder:text-[#5a4a50] focus:border-[#c9762f]"
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
            <button
              onClick={() => join()}
              disabled={busy}
              className="flex shrink-0 items-center gap-1.5 rounded border border-[#c9762f]/50 px-4 font-display text-xl text-[#d99a3d] transition hover:bg-[#c9762f]/10 disabled:opacity-50"
            >
              <DoorOpen className="h-4 w-4" /> Join
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-[#e06a5a]">{error}</p>}

          {/* ---- open towns browser ---- */}
          <div className="mt-6 border-t border-[#3a2733] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl text-[#e9dfcf]">Open towns</h3>
              <button
                onClick={() => void refreshRooms()}
                className="flex items-center gap-1.5 text-xs text-[#9c8b7a] transition hover:text-[#d99a3d]"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" /> live
                <span className="relative flex h-2 w-2">
                  <span className="absolute h-2 w-2 animate-ping rounded-full bg-[#6b8e23] opacity-60" />
                  <span className="h-2 w-2 rounded-full bg-[#6b8e23]" />
                </span>
              </button>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {!roomsLoaded && <p className="text-sm text-[#6b5a55]">Reading the map…</p>}
              {roomsLoaded && rooms.length === 0 && (
                <p className="text-sm italic text-[#6b5a55]">No towns on the map yet. Found one, and others will find you.</p>
              )}
              {rooms.map((r) => (
                <div
                  key={r.code}
                  className="group flex items-center gap-3 rounded border border-[#2a1c28] bg-[#0d0810]/80 px-3 py-2.5 transition hover:border-[#c9762f]/40"
                >
                  <span className={`shrink-0 ${r.phase === "lobby" ? "text-[#d99a3d]" : r.phase === "ended" ? "text-[#6b5a55]" : "text-[#8f7d9b]"}`}>
                    {r.phase === "lobby" ? <Flame className="h-4 w-4" /> : r.phase === "meeting" ? <Bell className="h-4 w-4" /> : r.phase === "ended" ? <Skull className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm tracking-[0.25em] text-[#e9dfcf]">{r.code}</span>
                      <span className="truncate text-xs text-[#9c8b7a]">
                        {r.phase === "lobby" ? "gathering at dusk" : r.phase === "meeting" ? "the bell tolls" : r.phase === "ended" ? "the tale ended" : `night ${r.round || 1} has fallen`}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[#6b5a55]">
                      <Users className="h-3 w-3 shrink-0" />
                      <span>{r.playerCount}/10</span>
                      <span className="truncate">· {r.names.slice(0, 4).join(", ")}{r.names.length > 4 ? "…" : ""}</span>
                    </div>
                  </div>
                  {r.phase === "lobby" ? (
                    <button
                      onClick={() => join(r.code)}
                      disabled={busy || r.playerCount >= 10}
                      className="shrink-0 rounded bg-[#8f3b1f]/80 px-3 py-1.5 font-display text-base text-[#f3e6d0] transition hover:bg-[#a84a26] disabled:opacity-40"
                    >
                      {r.playerCount >= 10 ? "Full" : "Join"}
                    </button>
                  ) : r.phase === "ended" ? (
                    <button
                      onClick={() => join(r.code)}
                      disabled={busy}
                      title="Only the town's own souls may return"
                      className="shrink-0 rounded border border-[#3a2733] px-3 py-1.5 font-display text-base text-[#9c8b7a] transition hover:border-[#c9762f]/40 hover:text-[#d99a3d] disabled:opacity-40"
                    >
                      Return
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs italic text-[#5a4a50]">in progress</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[#6b5a55]">
            4–10 townsfolk. One or two among you are Hollow. The wards begin broken:
            take kits from the one cart, deliver them, then hold E to repair. Push the cart
            together to move it faster; carrying a kit slows and tires you. Drop it if you
            must. The Hollow can ruin a mended ward.
          </p>
        </div>
      </div>
    </main>
  );
}