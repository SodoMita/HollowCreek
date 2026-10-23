"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CREATURES, DEFAULT_CREATURE, type Creature, type RoomListing } from "@/game/types";
import {
  SettingsStore, createDefaultSettings, type GameSettings,
} from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";

function getPid(): string {
  let pid = localStorage.getItem("hc_pid");
  if (!pid) { pid = crypto.randomUUID(); localStorage.setItem("hc_pid", pid); }
  return pid;
}

/** Specimen-plate sigils, drawn as vectors so they scale and reverse to one colour. */
function Sigil({ kind, className = "" }: { kind: Creature["sigil"]; className?: string }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      {kind === "strigoi" && (
        <g {...common}>
          <path d="M32 8c-9 0-15 7-15 16 0 6 2 9 2 14 0 7-3 10-3 18h32c0-8-3-11-3-18 0-5 2-8 2-14 0-9-6-16-15-16Z" />
          <path d="M24 26c2-2 5-2 6 0M34 26c2-2 5-2 6 0" />
          <path d="M28 42h8" />
          <path d="M32 8V2M26 4l6 4 6-4" />
        </g>
      )}
      {kind === "wolf" && (
        <g {...common}>
          <path d="M14 20 8 8l12 6M50 20 56 8l-12 6" />
          <path d="M12 26c0-8 9-12 20-12s20 4 20 12c0 12-9 22-20 22S12 38 12 26Z" />
          <path d="M24 28h.01M40 28h.01" />
          <path d="M32 34v5M26 44c4 3 8 3 12 0" />
        </g>
      )}
      {kind === "wraith" && (
        <g {...common}>
          <path d="M32 6c-10 0-17 8-17 18 0 12 6 16 6 26 0 4 2 8 4 8 2 0 3-3 3-6 0-4 2-6 4-6s4 2 4 6c0 3 1 6 3 6 2 0 4-4 4-8 0-10 6-14 6-26 0-10-7-18-17-18Z" />
          <path d="M23 24c2-2 6-2 8 0M33 24c2-2 6-2 8 0" />
        </g>
      )}
      {kind === "banshee" && (
        <g {...common}>
          <path d="M20 22c0-8 5-14 12-14s12 6 12 14c0 14-4 34-12 34s-12-20-12-34Z" />
          <ellipse cx="32" cy="26" rx="6" ry="9" />
          <path d="M8 20h8M48 20h8M10 34h8M46 34h8M14 48h8M42 48h8" />
        </g>
      )}
      {kind === "moroii" && (
        <g {...common}>
          <path d="M32 58V22" />
          <path d="M18 34h28" />
          <path d="M20 58h24" />
          <path d="M40 18c6-2 10-6 10-12-6 0-10 3-12 8" />
          <path d="M14 20c4-6 9-8 15-6" />
        </g>
      )}
      {kind === "vrykolakas" && (
        <g {...common}>
          <path d="M14 58V10h24v48" />
          <path d="M38 30h12v28H38" />
          <circle cx="33" cy="34" r="1.6" fill="currentColor" stroke="none" />
          <path d="M52 14c4 0 6 3 6 6M52 22c2 0 3 1 3 3" />
        </g>
      )}
    </svg>
  );
}

function CreatureCard({
  creature, selected, taken, onSelect,
}: {
  creature: Creature;
  selected: boolean;
  taken: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={taken}
      onClick={() => onSelect(creature.id)}
      className={[
        "group relative flex w-[240px] shrink-0 flex-col items-start gap-3 border p-5 text-left transition-all duration-300 sm:w-[268px]",
        taken
          ? "cursor-not-allowed border-[#2a2028] bg-[#0f0c12]/80 opacity-45"
          : selected
            ? "border-[#7B1220] bg-[#1a0f14] shadow-[0_0_0_1px_#7B1220,0_28px_60px_-30px_rgba(123,18,32,0.9)]"
            : "border-[#2a2028] bg-[#120e15]/80 hover:border-[#7B1220]/70 hover:bg-[#170f16]",
      ].join(" ")}
    >
      <div className="flex w-full items-start justify-between">
        <Sigil kind={creature.sigil} className={selected ? "h-14 w-14 text-[#C2404C]" : "h-14 w-14 text-[#9C9287]"} />
        <span className="font-body text-[10px] uppercase tracking-[0.28em] text-[#6f6459]">
          {taken ? "taken" : selected ? "yours" : "free"}
        </span>
      </div>
      <div>
        <h3 className="font-display text-2xl leading-none text-[#E8DFCF]">{creature.name}</h3>
        <p className="mt-1 font-body italic text-[13px] tracking-wide text-[#9C9287]">{creature.latin}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-[#8b8075]">{creature.blurb}</p>
      <div className="mt-auto w-full border-t border-[#2a2028] pt-3 font-body text-[10px] uppercase tracking-[0.26em]">
        {taken ? (
          <span className="text-[#6f6459]">worn by {creature.claimedBy}</span>
        ) : selected ? (
          <span className="text-[#C2404C]">claimed — rise with it</span>
        ) : (
          <span className="text-[#6f6459] group-hover:text-[#9C9287]">unclaimed</span>
        )}
      </div>
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [creature, setCreature] = useState<string>(DEFAULT_CREATURE);
  const [settings, setSettings] = useState<GameSettings>(createDefaultSettings);
  const [flash, setFlash] = useState(false);
  const settingsDialog = useRef<SettingsDialog | null>(null);

  useEffect(() => {
    setCreature(localStorage.getItem("hc_creature") || DEFAULT_CREATURE);
    setName(localStorage.getItem("hc_name") || "");
    const store = new SettingsStore();
    setSettings(store.value);
    const unsubscribe = store.subscribe((next) => {
      setSettings(next);
      document.documentElement.style.setProperty("--hc-ui-scale", String(next.interface.scale));
    });
    const dialog = new SettingsDialog(store);
    settingsDialog.current = dialog;
    return () => { unsubscribe(); dialog.destroy?.(); };
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const r = await fetch("/api/game/rooms");
      const d = await r.json();
      setRooms(Array.isArray(d.rooms) ? d.rooms : []);
      setRoomsLoaded(true);
    } catch { /* the valley is quiet */ }
  }, []);

  useEffect(() => {
    void refreshRooms();
    const t = setInterval(refreshRooms, 3000);
    return () => clearInterval(t);
  }, [refreshRooms]);

  const saveName = () => localStorage.setItem("hc_name", name.trim() || "Stranger");
  const pickCreature = (id: string) => {
    setCreature(id);
    localStorage.setItem("hc_creature", id);
  };

  const rise = () => {
    setFlash(true);
    setTimeout(() => setFlash(false), 520);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    saveName();
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: getPid(), name: name.trim() || "Stranger", creature }),
      });
      const data = await res.json();
      if (data.code) {
        localStorage.setItem("hc_creature", creature);
        router.push(`/room/${data.code}`);
      } else setError(data.error ?? "The town refused you.");
    } catch {
      setError("No answer from the valley.");
    } finally {
      setBusy(false);
    }
  };

  const join = async (target?: string) => {
    const c = (target ?? code).trim().toUpperCase();
    if (!c) { setError("Enter a town code."); return; }
    setBusy(true);
    setError(null);
    saveName();
    try {
      const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: c, playerId: getPid(), name: name.trim() || "Stranger", creature }),
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem("hc_creature", creature);
        router.push(`/room/${c}`);
      } else setError(data.error ?? "That town is closed.");
    } catch {
      setError("No answer from the valley.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#0B0A0C] text-[#E8DFCF]">
      {/* poster paper */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.16] mix-blend-soft-light"
        style={{ backgroundImage: "url(images/parchment.jpg)", backgroundSize: "620px" }}
      />

      {/* --- spine rail: the credit block on the poster's spine --- */}
      <aside className="pointer-events-none fixed left-0 top-0 z-30 hidden h-full w-[62px] flex-col items-center justify-between border-r border-[#2a2028] bg-[#0B0A0C]/80 py-8 lg:flex">
        <span className="h-16 w-px bg-[#7B1220]" />
        <p
          className="whitespace-nowrap font-body text-[10px] uppercase tracking-[0.42em] text-[#6f6459]"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Hollow Creek · Night of the Strigoi · one codebase · a game for many hands
        </p>
        <span className="h-16 w-px bg-[#2a2028]" />
      </aside>

      {/* --- flash on RISE --- */}
      {flash && (
        <div className="pointer-events-none fixed inset-0 z-50 animate-[hc-rise_0.5s_ease-out] bg-[#E8DFCF] mix-blend-difference" />
      )}

      {/* ============================ HERO ============================ */}
      <section className="relative min-h-[86dvh] w-full overflow-hidden border-b border-[#2a2028] lg:pl-[62px]">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(images/poster.jpg)", filter: "saturate(0.72) contrast(1.12)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0A0C]/85 via-[#0B0A0C]/45 to-[#0B0A0C]" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_15%,rgba(159,182,198,0.16),transparent_60%)]" />

        <div className="relative z-10 flex min-h-[86dvh] flex-col justify-end px-6 pb-12 pt-16 sm:px-10 lg:px-16">
          <p className="font-body text-[11px] uppercase tracking-[0.5em] text-[#C2404C]">
            October 1893 · a valley that keeps its dead
          </p>
          <h1 className="mt-5 font-display text-[clamp(3.6rem,13vw,11rem)] leading-[0.82] tracking-[-0.02em] text-[#E8DFCF]">
            HOLLOW
            <span className="block">
              CREEK<span className="text-[#7B1220]">.</span>
            </span>
          </h1>
          <div className="mt-7 flex max-w-4xl flex-col gap-6 border-t border-[#E8DFCF]/25 pt-6 sm:flex-row sm:items-start sm:gap-12">
            <p className="max-w-md font-body italic text-lg leading-relaxed text-[#c9b8a4]">
              &ldquo;Every soul in the valley wears a face tonight. One of them keeps its own
              underneath — and it is hungry.&rdquo;
            </p>
            <p className="max-w-sm text-[15px] leading-relaxed text-[#9C9287]">
              A multiplayer horror of townsfolk and things. Walk the whole valley — farm, chapel
              rise, sawmill, creek and cemetery — finish the wards, find the iron key, ring the
              bell and cage the Hollow before it wears your face. Authoritative server,20&nbsp;Hz
              tick, generative score.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 font-body text-[10px] uppercase tracking-[0.32em] text-[#6f6459]">
            <span>Server-authoritative</span>
            <span className="h-px w-10 bg-[#2a2028]" />
            <span>6 400 × 4 200 world</span>
            <span className="h-px w-10 bg-[#2a2028]" />
            <span>WebAudio score · no audio files</span>
            <span className="h-px w-10 bg-[#2a2028]" />
            <span>Chronicle of every deed</span>
          </div>
        </div>
      </section>

      {/* ==================== CREATURE ROSTER ==================== */}
      <section className="relative border-b border-[#2a2028] bg-[#0B0A0C] py-14 lg:pl-[62px]">
        <div className="px-6 sm:px-10 lg:px-16">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[#2a2028] pb-6">
            <div>
              <p className="font-body text-[11px] uppercase tracking-[0.42em] text-[#C2404C]">
                Specimen plate I — creatures of the night
              </p>
              <h2 className="mt-3 font-display text-[clamp(2.2rem,5vw,4.2rem)] leading-none">
                Take the one nobody else took.
              </h2>
            </div>
            <p className="max-w-sm font-body italic text-[15px] leading-relaxed text-[#9C9287]">
              Other hands already wear the wolf, the wraith and the banshee. The strigoi is
              unclaimed — a corpse that keeps its name, its appetite and its keys.
            </p>
          </div>
        </div>

        {/* full-bleed ruled band of specimen boxes */}
        <div className="mt-8 flex gap-px overflow-x-auto border-y border-[#2a2028] bg-[#2a2028] px-6 pb-2 pt-2 sm:px-10 lg:px-16">
          {CREATURES.map((c) => (
            <CreatureCard
              key={c.id}
              creature={c}
              selected={creature === c.id}
              taken={!!c.claimedBy}
              onSelect={pickCreature}
            />
          ))}
        </div>

        {/* the plate */}
        <div className="mt-12 grid gap-10 px-6 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:px-16">
          <figure className="relative overflow-hidden border border-[#2a2028]">
            <img src="images/strigoi.jpg" alt="Specimen plate: the Strigoi" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0A0C] via-transparent to-transparent" />
            <figcaption className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4 p-5">
              <div>
                <p className="font-body text-[10px] uppercase tracking-[0.34em] text-[#C2404C]">Plate I</p>
                <p className="font-display text-3xl leading-none">Strigoi vivus</p>
              </div>
              <p className="max-w-[190px] text-right font-body italic text-[12px] leading-snug text-[#9C9287]">
                Collected near the chapel rise, October 1893.
              </p>
            </figcaption>
          </figure>

          <div className="flex flex-col justify-center gap-6">
            <div>
              <p className="font-body text-[11px] uppercase tracking-[0.42em] text-[#6f6459]">Your identity</p>
              <h3 className="mt-3 font-display text-[clamp(2.4rem,6vw,4.6rem)] leading-[0.9]">
                {(CREATURES.find((c) => c.id === creature) ?? CREATURES[0]).name}
                <span className="block font-body text-base italic tracking-wide text-[#9C9287]">
                  {(CREATURES.find((c) => c.id === creature) ?? CREATURES[0]).latin}
                </span>
              </h3>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#c9b8a4]">
                {(CREATURES.find((c) => c.id === creature) ?? CREATURES[0]).blurb}
              </p>
            </div>

            {/* summoning card */}
            <div className="border border-[#2a2028] bg-[#120e15]/80 p-6">
              <label className="font-body text-[10px] uppercase tracking-[0.32em] text-[#6f6459]" htmlFor="soul-name">
                The name they will carve on your stone
              </label>
              <input
                id="soul-name"
                value={name}
                maxLength={18}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                placeholder="Stranger"
                className="mt-3 w-full border-b border-[#3a2733] bg-transparent pb-2 font-display text-2xl text-[#E8DFCF] outline-none transition-colors placeholder:text-[#4c4038] focus:border-[#C2404C]"
              />
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => { rise(); void create(); }}
                  disabled={busy}
                  className="group relative flex-1 overflow-hidden border border-[#7B1220] bg-[#7B1220] px-8 py-4 font-display text-2xl tracking-wide text-[#E8DFCF] transition-colors hover:bg-[#96182a] disabled:opacity-50"
                >
                  RISE
                </button>
                <div className="flex flex-1 items-stretch border border-[#3a2733]">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
                    onKeyDown={(e) => e.key === "Enter" && void join()}
                    placeholder="CODE"
                    className="w-24 bg-transparent px-3 text-center font-display text-xl tracking-[0.2em] outline-none placeholder:text-[#4c4038]"
                  />
                  <button
                    onClick={() => void join()}
                    disabled={busy}
                    className="border-l border-[#3a2733] px-5 font-body text-[11px] uppercase tracking-[0.28em] text-[#c9b8a4] transition-colors hover:bg-[#7B1220] hover:text-[#E8DFCF] disabled:opacity-50"
                  >
                    Enter
                  </button>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-[12px] leading-snug text-[#6f6459]">
                  {error ? <span className="text-[#C2404C]">{error}</span> : "RISE opens a new town and hands you the lantern."}
                </p>
                <button
                  onClick={() => settingsDialog.current?.open()}
                  className="font-body text-[10px] uppercase tracking-[0.28em] text-[#6f6459] underline-offset-4 hover:text-[#E8DFCF] hover:underline"
                >
                  Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== OPEN TOWNS ==================== */}
      <section className="relative bg-[#0B0A0C] py-14 lg:pl-[62px]">
        <div className="px-6 sm:px-10 lg:px-16">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-[#2a2028] pb-5">
            <h2 className="font-display text-[clamp(1.9rem,4vw,3.2rem)] leading-none">Open towns</h2>
            <p className="font-body text-[10px] uppercase tracking-[0.32em] text-[#6f6459]">
              polled every three seconds
            </p>
          </div>

          <ul className="divide-y divide-[#2a2028]">
            {rooms.length === 0 && (
              <li className="py-10 text-center font-body italic text-[#6f6459]">
                {roomsLoaded ? "No lanterns are lit. Rise and open the first town." : "Listening for lanterns…"}
              </li>
            )}
            {rooms.map((r) => (
              <li key={r.code} className="flex flex-wrap items-center gap-4 py-5">
                <span className="font-display text-3xl tracking-[0.14em] text-[#E8DFCF]">{r.code}</span>
                <span className="font-body text-[10px] uppercase tracking-[0.3em] text-[#C2404C]">
                  {r.phase === "playing" ? "night" : r.phase === "meeting" ? "the bell" : r.phase === "ended" ? "dawn" : "gathering"}
                </span>
                <span className="ml-auto font-body text-[13px] tabular-nums tracking-[0.18em] text-[#9C9287]">
                  {String(r.playerCount).padStart(2, "0")} souls
                </span>
                <span className="w-52 truncate text-[13px] text-[#6f6459]">{r.names.join(" · ") || "—"}</span>
                <button
                  onClick={() => void join(r.code)}
                  className="border border-[#3a2733] px-6 py-2 font-body text-[10px] uppercase tracking-[0.28em] text-[#c9b8a4] transition-colors hover:border-[#C2404C] hover:text-[#E8DFCF]"
                >
                  Walk in
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ==================== FOOTER / COLOPHON ==================== */}
      <footer className="relative border-t border-[#2a2028] bg-[#0f0c12] py-12 lg:pl-[62px]">
        <div className="grid gap-8 px-6 sm:px-10 lg:grid-cols-3 lg:px-16">
          <div>
            <p className="font-body text-[10px] uppercase tracking-[0.34em] text-[#6f6459]">Colophon</p>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[#8b8075]">
              Set in Cinzel and Fraunces over an ink-black field with a single spot of oxblood.
              Score synthesised in the browser: wind, bowed drone, music box, bell — currently{" "}
              {settings.audio.muted ? "muted" : "playing"}.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-body text-[10px] uppercase tracking-[0.34em] text-[#6f6459]">Records</p>
            <a href="/stats" className="text-[13px] text-[#c9b8a4] underline-offset-4 hover:text-[#E8DFCF] hover:underline">
              Lifetime ledger of every soul
            </a>
            <a href="/play" className="text-[13px] text-[#c9b8a4] underline-offset-4 hover:text-[#E8DFCF] hover:underline">
              Static client (GitHub Pages / portal builds)
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-body text-[10px] uppercase tracking-[0.34em] text-[#6f6459]">Play</p>
            <p className="text-[13px] leading-relaxed text-[#8b8075]">
              WASD or arrows to walk · hold E to work a ward · Q to strike or ring the bell ·
              F to snuff the lanterns · Enter to speak.
            </p>
          </div>
        </div>
        <p className="mt-10 px-6 text-center font-body text-[10px] uppercase tracking-[0.42em] text-[#4c4038] sm:px-10 lg:px-16">
          Hollow Creek · {new Date().getFullYear()} · the valley remembers
        </p>
      </footer>

      <p className="sr-only" aria-live="polite">
        Generative score {settings.audio.muted ? "muted" : "active"} · interface scale{" "}
        {settings.interface.scale}
      </p>
    </main>
  );
}
