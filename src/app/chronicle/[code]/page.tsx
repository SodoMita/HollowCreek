import { recorder } from "@/server/recorder";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SECRET_LABEL: Record<string, string> = {
  kill: "MURDER",
  killed: "MURDERED",
  role_assign: "ROLE GIVEN",
  lights_snuffed: "LIGHTS SNUFFED",
  hedge_travel: "SLIPPED THROUGH A HEDGE",
  game_start: "NIGHT BEGAN",
  game_end: "NIGHT ENDED",
};

function timeOf(d: Date | string | null) {
  if (!d) return "--:--:--";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString([], { hour12: false });
}

export default async function ChroniclePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const upper = code.toUpperCase();
  const { actions, chat } = await recorder.chronicle(upper);

  return (
    <main className="min-h-screen bg-[#05070c] px-6 py-12 text-[#efe3d0]">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] uppercase tracking-[0.5em] text-[#c98a3c]">the town record</p>
        <h1 className="mt-2 text-4xl font-semibold">Chronicle of room {upper}</h1>
        <p className="mt-2 text-sm text-[#8b7f6d]">
          Every action taken in this room is recorded server-side, in order, including the ones the
          town was never meant to see. {actions.length} recorded actions · {chat.length} spoken lines.
        </p>
        <Link href={`/play/${upper}`} className="mt-4 inline-block text-sm text-[#c98a3c] hover:underline">
          ← back to the street
        </Link>

        <section className="mt-8 overflow-hidden rounded-2xl border border-[#3a2b1c]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0e1016] text-[10px] uppercase tracking-widest text-[#8b7f6d]">
              <tr>
                <th className="px-4 py-3">time</th>
                <th className="px-4 py-3">who</th>
                <th className="px-4 py-3">action</th>
                <th className="px-4 py-3">where</th>
                <th className="px-4 py-3">detail</th>
              </tr>
            </thead>
            <tbody>
              {actions.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#6c6357]">
                    Nothing has happened here yet.
                  </td>
                </tr>
              )}
              {actions.map((a) => (
                <tr key={a.id} className="border-t border-[#1a1410] align-top">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-[#6c6357]">
                    {timeOf(a.createdAt)}
                  </td>
                  <td className="px-4 py-2" style={{ color: a.secret ? "#ff9d8a" : "#d8cdbc" }}>
                    {a.playerName}
                  </td>
                  <td className="px-4 py-2 text-xs uppercase tracking-widest text-[#c98a3c]">
                    {SECRET_LABEL[a.type] ?? a.type.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[#7d7468]">{a.x ?? ""}</td>
                  <td className="px-4 py-2 text-xs text-[#a2988a]">
                    {a.payload ? JSON.stringify(a.payload) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {chat.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[10px] uppercase tracking-[0.3em] text-[#c98a3c]">everything said</h2>
            <ul className="mt-3 space-y-1">
              {chat.map((c) => (
                <li key={c.id} className="text-sm">
                  <span className="font-mono text-xs text-[#6c6357]">{timeOf(c.createdAt)} </span>
                  <span className={c.ghost ? "text-[#7fa6c9]" : "text-[#d8cdbc]"}>{c.name}:</span>{" "}
                  <span className="text-[#a2988a]">{c.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
