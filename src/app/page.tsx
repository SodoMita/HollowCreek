"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RoomInfo = { code: string; players: number; phase: string; round: number; names: string[] };

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(localStorage.getItem("hollow.name") ?? "");
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/rooms", { cache: "no-store" });
        const d = (await r.json()) as { rooms: RoomInfo[] };
        setRooms(d.rooms ?? []);
      } catch {
        /* ignore */
      }
    };
    void load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("hollow.name", name.trim() || "Stranger");
      const r = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Stranger" }),
      });
      const d = (await r.json()) as { code: string };
      router.push(`/play/${d.code}`);
    } catch {
      setError("The gate would not open.");
      setBusy(false);
    }
  };

  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length < 3) {
      setError("That code is too short.");
      return;
    }
    localStorage.setItem("hollow.name", name.trim() || "Stranger");
    router.push(`/play/${c}`);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05070c] text-[#efe3d0]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "url(/images/title.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center 40%",
          filter: "saturate(0.75) brightness(0.55)",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#05070cbb] via-[#05070cdd] to-[#05070c]" />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-14">
        <header>
          <p className="text-[11px] uppercase tracking-[0.55em] text-[#c98a3c]">a one-screen horror town</p>
          <h1 className="mt-3 text-[clamp(2.6rem,7vw,5rem)] font-semibold leading-[0.95] text-[#f6ead6]">
            THE HOLLOW CREEK
            <span className="block text-[#c98a3c]">BELL</span>
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-[#a2988a]">
            A 1D side-scrolling social deduction game. One long autumn street, fog on both ends.
            Everyone walks left and right; the server owns every step. Do your chores, keep your
            lantern up, and try not to be alone when the leaves stop rustling. Something in town is
            wearing a neighbour&apos;s face.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
          <section className="rounded-2xl border border-[#3a2b1c] bg-[#0b0d13ee] p-6 backdrop-blur">
            <label className="text-[10px] uppercase tracking-[0.3em] text-[#8b7f6d]">your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={14}
              placeholder="Stranger"
              className="mt-2 w-full rounded-lg border border-[#3a2b1c] bg-[#141118] px-4 py-3 outline-none focus:border-[#c98a3c]"
            />
            <button
              onClick={create}
              disabled={busy}
              className="mt-3 w-full rounded-lg bg-[#8a4a1c] px-4 py-3 font-semibold text-[#fff1dd] transition hover:bg-[#a55a25] disabled:opacity-50"
            >
              {busy ? "Lighting the lamps…" : "Start a new town"}
            </button>
            <div className="mt-4 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="CODE"
                className="w-full rounded-lg border border-[#3a2b1c] bg-[#141118] px-4 py-3 font-mono tracking-[0.3em] outline-none focus:border-[#c98a3c]"
              />
              <button
                onClick={join}
                className="whitespace-nowrap rounded-lg border border-[#8a4a1c] px-5 py-3 text-sm font-semibold text-[#ffd68a] hover:bg-[#241609]"
              >
                Join
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            <p className="mt-4 text-xs text-[#6c6357]">
              Best with 4–10 people on separate screens in the same room. One of them will be lying.
            </p>
          </section>

          <section className="rounded-2xl border border-[#3a2b1c] bg-[#0b0d13ee] p-6 backdrop-blur">
            <h2 className="text-[10px] uppercase tracking-[0.3em] text-[#c98a3c]">towns right now</h2>
            <ul className="mt-3 space-y-2">
              {rooms.length === 0 && (
                <li className="text-sm text-[#6c6357]">Every town is dark. Start one.</li>
              )}
              {rooms.map((r) => (
                <li key={r.code}>
                  <button
                    onClick={() => router.push(`/play/${r.code}`)}
                    className="flex w-full items-center justify-between rounded-lg border border-[#2a2119] bg-[#0e1016] px-3 py-2 text-left hover:border-[#8a4a1c]"
                  >
                    <span className="font-mono tracking-[0.2em] text-[#ffd68a]">{r.code}</span>
                    <span className="text-xs text-[#9d9285]">
                      {r.players} in · {r.phase === "lobby" ? "at the crossroads" : `round ${r.round}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 space-y-2 text-xs leading-relaxed text-[#8b7f6d]">
              <p>
                <b className="text-[#c98a3c]">Bell &amp; cages.</b> When a body is reported the bell
                rings and every player walks themselves to the cages in Harvest Square. No teleporting,
                no hiding.
              </p>
              <p>
                <b className="text-[#c98a3c]">Caged, not gone.</b> Whoever the town votes for is locked
                up — but they keep talking. Free them by vote, with the iron key, or let them die in
                there.
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
