"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BookOpen, DoorOpen, Flame, Moon, Palette, Plus, RefreshCw, Skull, Trophy, Users } from "lucide-react";
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
    let t = setInterval(refreshRooms, 3000);
    // a hidden tab does not need a live town list — pause until visible again
    const onVis = () => {
      clearInterval(t);
      if (!document.hidden) { void refreshRooms(); t = setInterval(refreshRooms, 3000); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
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
    <main id="main" className="relative min-h-screen overflow-hidden bg-[#0b0710]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-[#8f3b1f] focus:px-3 focus:py-2 focus:text-[#f3e6d0]">Skip to towns</a>
      {/* sky */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#120b1e] via-[#33172b] to-[#6e3320]" />
      {/* moon */}
      {/* smaller and tucked into the corner on phones so it never sits on the title */}
      <div className="pointer-events-none absolute right-[4%] top-[3%] h-12 w-12 rounded-full bg-[#e8ddc0] shadow-[0_0_50px_20px_rgba(240,225,190,0.25)] sm:right-[12%] sm:top-[10%] sm:h-28 sm:w-28 sm:shadow-[0_0_90px_40px_rgba(240,225,190,0.25)]" />
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
        className="hc-fog pointer-events-none absolute bottom-[16%] left-[-10%] h-40 w-[120%] rounded-full bg-[#8a7f95]/10 blur-2xl"
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
          <p className="hc-rise max-w-[68%] font-body text-sm uppercase tracking-[0.4em] text-[#c9762f]">October, 1893 · population: uncertain</p>
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
          <p className="hc-rise-3 mt-4 max-w-md text-sm text-[#a9c9c4]">Find the timepiece and press M to visit a recorded moment. Your stay in the past lasts at most one minute.</p>
          <div className="hc-rise-3 mt-8 grid max-w-lg grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              [`${keyLabel(settings.controls.left)} / ${keyLabel(settings.controls.right)}`, "walk the street"],
              [keyLabel(settings.controls.interact), "interact · open / close doors"],
              [`${keyLabel(settings.controls.ability)} / ${keyLabel(settings.controls.blackout)}`, "role ability · snuff lights"],
              ["L", "lock / unlock with its own key"],
            ].map(([k, v]) => (
              <div key={k} className="rounded border border-[#3a2733] bg-[#160e1a]/80 p-3">
                <div className="font-mono text-[#d99a3d]">{k}</div>
                <div className="mt-1 text-xs text-[#9c8b7a]">{v}</div>
              </div>
            ))}
          </div>

          {/* stageshow-style product still: one quiet window, one story (the mended ward) */}
          <div className="hc-rise-3 mt-8 max-w-lg overflow-hidden rounded-lg border border-[#3a2733] bg-[#0d0810] shadow-[0_16px_60px_rgba(0,0,0,0.55)]" data-testid="home-still" aria-hidden="true">
            <svg viewBox="0 0 520 300" className="block h-auto w-full">
              <rect x="0" y="0" width="520" height="300" fill="#0d0810" />
              <circle cx="18" cy="16" r="4" fill="#4a3040" />
              <circle cx="32" cy="16" r="4" fill="#4a3040" />
              <circle cx="46" cy="16" r="4" fill="#8f3b1f" />
              <text x="64" y="20" fontSize="10" fill="#8f7d6b" fontFamily="monospace">hollow creek — night watch</text>
              <line x1="0" y1="32" x2="520" y2="32" stroke="#3a2733" strokeWidth="1" />
              <text x="20" y="66" fontSize="13" fill="#e9dfcf" fontFamily="Georgia, serif">Ward 3 · mending</text>
              <rect x="20" y="76" width="360" height="10" rx="5" fill="#1f151c" />
              <rect x="20" y="76" width="295" height="10" rx="5" fill="#d99a3d" />
              <text x="392" y="85" fontSize="10" fill="#d99a3d" fontFamily="monospace">82%</text>
              <rect x="20" y="104" width="240" height="7" rx="3.5" fill="#241a26" />
              <rect x="20" y="118" width="300" height="7" rx="3.5" fill="#241a26" />
              <rect x="20" y="132" width="180" height="7" rx="3.5" fill="#241a26" />
              <rect x="20" y="164" width="300" height="26" rx="6" fill="#1f151c" stroke="#3a2733" strokeWidth="1" />
              <rect x="32" y="174" width="170" height="6" rx="3" fill="#3a2f3a" />
              <rect x="20" y="206" width="128" height="24" rx="12" fill="#140d18" stroke="#84624c" strokeWidth="1" />
              <text x="34" y="222" fontSize="11" fill="#ffd98a" fontFamily="monospace">M · visit the past</text>
              <polygon points="368,88 368,106 373,101 377,110 380,108 376,99 383,99" fill="#e9dfcf" />
              <rect x="0" y="252" width="520" height="48" fill="#0a0609" />
              <rect x="20" y="266" width="200" height="7" rx="3.5" fill="#241a26" />
              <rect x="20" y="280" width="140" height="7" rx="3.5" fill="#241a26" />
            </svg>
          </div>
        </div>

        {/* right: forms */}
        <div className="hc-rise-2 w-full max-w-sm shrink-0 rounded-lg border border-[#3a2733] bg-[#140d18]/90 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-3xl text-[#e9dfcf]">Enter the town</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => settingsDialog.current?.open()}
                className="rounded border border-[#3a2733] px-2.5 py-1.5 text-xs text-[#c9b8a4] transition-colors hover:border-[#c9762f]/40 hover:text-[#ffd98a]"
                aria-label="Open settings"
              >⚙ Settings</button>
              <Link
                href="/tutorial"
                className="flex items-center gap-1.5 rounded border border-[#3a2733] px-2.5 py-1.5 text-xs text-[#9c8b7a] transition-colors hover:border-[#c9762f]/40 hover:text-[#ffd98a]"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#d99a3d]" /> Tutorial
              </Link>
              <Link
                href="/stats"
                className="flex items-center gap-1.5 rounded border border-[#3a2733] px-2.5 py-1.5 text-xs text-[#9c8b7a] transition-colors hover:border-[#c9762f]/40 hover:text-[#d99a3d]"
              >
                <Trophy className="h-3.5 w-3.5" /> Records
              </Link>
              <Link href="/art" className="flex items-center gap-1.5 rounded border border-[#3a2733] px-2.5 py-1.5 text-xs text-[#9c8b7a] transition-colors hover:border-[#c9762f]/40 hover:text-[#ffd98a]">
                <Palette className="h-3.5 w-3.5" /> Art
              </Link>
            </div>
          </div>
          <label htmlFor="hc-name" className="mt-5 block text-xs uppercase tracking-widest text-[#9c8b7a]">Your name</label>
          <input
            id="hc-name"
            name="player-name"
            autoComplete="nickname"
            spellCheck={false}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={14}
            placeholder="Stranger"
            className="mt-1 w-full rounded border border-[#3a2733] bg-[#0d0810] px-3 py-2.5 text-[#e9dfcf] placeholder:text-[#8a7a82] focus:border-[#c9762f] focus-visible:outline-2 focus-visible:outline-[#c9762f]"
          />
          <button
            onClick={create}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-[#8f3b1f] px-4 py-3 font-display text-xl tracking-wide text-[#f3e6d0] transition-colors hover:bg-[#a84a26] disabled:opacity-50"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} /> Found a new town
          </button>
          <Link
            href="/tutorial"
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded border border-[#84624c]/80 bg-[#1f151c]/90 px-4 py-2.5 font-display text-lg tracking-wide text-[#ffd98a] transition-colors hover:bg-[#321f28]"
          >
            <BookOpen className="h-4 w-4 text-[#d99a3d]" /> Walk Alone · Singleplayer Tutorial
          </Link>
          <div className="my-5 flex items-center gap-3 text-xs text-[#8a7a82]">
            <div className="h-px flex-1 bg-[#3a2733]" /> or travel to one <div className="h-px flex-1 bg-[#3a2733]" />
          </div>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="CODE"
              aria-label="Town code"
              name="town-code"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded border border-[#3a2733] bg-[#0d0810] px-3 py-2.5 text-center font-mono text-xl tracking-[0.5em] text-[#d99a3d] placeholder:text-[#8a7a82] focus:border-[#c9762f] focus-visible:outline-2 focus-visible:outline-[#c9762f]"
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
            <button
              onClick={() => join()}
              disabled={busy}
              className="flex shrink-0 items-center gap-1.5 rounded border border-[#c9762f]/50 px-4 font-display text-xl text-[#d99a3d] transition-colors hover:bg-[#c9762f]/10 disabled:opacity-50"
            >
              <DoorOpen className="h-4 w-4" /> Join
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-[#e06a5a]">{error}</p>}

          {/* ---- open towns browser ---- */}
          <div className="mt-6 border-t border-[#3a2733] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-2xl text-[#e9dfcf]">Open towns</h3>
              <button
                onClick={() => void refreshRooms()}
                className="flex items-center gap-1.5 rounded text-xs text-[#9c8b7a] transition-colors hover:text-[#d99a3d] focus-visible:outline-2 focus-visible:outline-[#d99a3d]"
                title="Refresh the list of open towns"
                aria-label="Refresh the list of open towns"
              >
                <RefreshCw className="h-3.5 w-3.5" /> live
                <span className="relative flex h-2 w-2">
                  <span className="absolute h-2 w-2 animate-ping rounded-full bg-[#6b8e23] opacity-60" />
                  <span className="h-2 w-2 rounded-full bg-[#6b8e23]" />
                </span>
              </button>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {!roomsLoaded && <p className="text-sm text-[#9a877f]">Reading the map…</p>}
              {roomsLoaded && rooms.length === 0 && (
                <p className="text-sm italic text-[#9a877f]">No towns on the map yet. Found one, and others will find you.</p>
              )}
              {rooms.map((r) => (
                <div
                  key={r.code}
                  className="group flex items-center gap-3 rounded border border-[#2a1c28] bg-[#0d0810]/80 px-3 py-2.5 transition-colors hover:border-[#c9762f]/40"
                >
                  <span className={`shrink-0 ${r.phase === "lobby" ? "text-[#d99a3d]" : r.phase === "ended" ? "text-[#9a877f]" : "text-[#8f7d9b]"}`}>
                    {r.phase === "lobby" ? <Flame className="h-4 w-4" /> : r.phase === "meeting" ? <Bell className="h-4 w-4" /> : r.phase === "ended" ? <Skull className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm tracking-[0.25em] text-[#e9dfcf]">{r.code}</span>
                      <span className="truncate text-xs text-[#9c8b7a]">
                        {r.phase === "lobby" ? "gathering at dusk" : r.phase === "meeting" ? "the bell tolls" : r.phase === "ended" ? "the tale ended" : `night ${r.round || 1} has fallen`}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[#9a877f]">
                      <Users className="h-3 w-3 shrink-0" />
                      <span>{r.playerCount}/10</span>
                      <span className="truncate">· {r.names.slice(0, 4).join(", ")}{r.names.length > 4 ? "…" : ""}</span>
                    </div>
                  </div>
                  {r.phase === "lobby" ? (
                    <button
                      onClick={() => join(r.code)}
                      disabled={busy || r.playerCount >= 10}
                      className="shrink-0 rounded bg-[#8f3b1f]/80 px-3 py-1.5 font-display text-base text-[#f3e6d0] transition-colors hover:bg-[#a84a26] disabled:opacity-40"
                    >
                      {r.playerCount >= 10 ? "Full" : "Join"}
                    </button>
                  ) : r.phase === "ended" ? (
                    <button
                      onClick={() => join(r.code)}
                      disabled={busy}
                      title="Only the town's own souls may return"
                      className="shrink-0 rounded border border-[#3a2733] px-3 py-1.5 font-display text-base text-[#9c8b7a] transition-colors hover:border-[#c9762f]/40 hover:text-[#d99a3d] disabled:opacity-40"
                    >
                      Return
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs italic text-[#8a7a82]">in progress</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[#9a877f]">
            4–10 townsfolk. One or two among you are Hollow. The wards begin broken:
            take kits from the one cart, deliver them, then press E to play a repair puzzle. Push the cart
            together to move it faster; carrying a kit slows and tires you. Drop it if you
            must. Cages hold suspects, but the town wins only by mending every ward.
            The Hollow can ruin a mended ward.
          </p>
        </div>
      </div>
    </main>
  );
}