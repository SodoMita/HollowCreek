import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  CircleDot,
  Eye,
  Feather,
  Footprints,
  Flame,
  Lamp,
  Leaf,
  MapPin,
  Moon,
  Search,
  Sparkles,
  Volume2,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  SUSPECTS,
  TUTORIAL_CHAPTERS,
  formatTime,
  getWard,
  type MinigameId,
  type Suspect,
} from "../lib/game";
import { sfx } from "../lib/audio";
import { Button, Chip, Kicker, Ornament, Portrait } from "./ui";
import { MinigameModal } from "./Minigames";

const COACH_LINES = [
  "You are new, and the creek can smell it. Keep your lantern close. — the Gloamwing",
  "Walk the lane before you work it. A lantern shows the way; it rarely shows the truth. — the Gloamwing",
  "Wards belong to the town, not to you. The dark hates a thing that is finished. — the Gloamwing",
  "Look first. Speak second. The dead are patient, but bad evidence is not. — the Gloamwing",
  "A hunch is not a hook. Match the small thing to the hand that left it. — the Gloamwing",
  "Dawn is a kind of forgiveness. It does not mean you were right. — the Gloamwing",
];

const EVIDENCE = [
  {
    id: "lampblack",
    label: "On the body's cuff",
    title: "A thumbprint of lampblack",
    text: "Black wick-oil, still tacky. Only the bell-ringer keeps the chapel's oil and trims its wicks.",
    icon: Flame,
  },
  {
    id: "button",
    label: "Beside the boot",
    title: "A sexton's pewter button",
    text: "Torn from a long coat. Silas Pike's coat is missing its second button — the whole lane has seen it.",
    icon: CircleDot,
  },
  {
    id: "sign",
    label: "At the gutter",
    title: "One long, uneven bootprint",
    text: "A sexton's stride, walking away upright and unhurried. The Hollow did not run.",
    icon: Footprints,
  },
];

function Coach({ step, compact = false }: { step: number; compact?: boolean }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-amber/20 bg-[rgba(215,163,95,0.055)]",
        compact ? "p-4" : "p-4",
      )}
    >
      <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-transparent via-amber/70 to-transparent" aria-hidden />
      <div className="flex items-start gap-3">
        <div className="relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-amber/30 bg-amber/10">
          <MothMark className="h-4.5 w-4.5 text-amber" />
        </div>
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-amber/80">The Gloamwing remembers</p>
          <p className="mt-1.5 font-serif text-[14px] italic leading-relaxed text-parchment-dim">{COACH_LINES[step]}</p>
        </div>
      </div>
    </div>
  );
}

export function MothMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" aria-hidden>
      <path d="M20 14c-3-6-11-10-15-6-3 4 1 13 8 17 3 2 5 2 7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 14c3-6 11-10 15-6 3 4-1 13-8 17-3 2-5 2-7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 14c-2 7-2 13 0 20 2-7 2-13 0-20Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M20 13c-1-4-3-6-5-7M20 13c1-4 3-6 5-7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="14" cy="19" r="1.5" fill="currentColor" fillOpacity="0.65" />
      <circle cx="26" cy="19" r="1.5" fill="currentColor" fillOpacity="0.65" />
    </svg>
  );
}

function ChapterRail({
  step,
  onStep,
}: {
  step: number;
  onStep: (step: number) => void;
}) {
  return (
    <ol className="relative space-y-0.5">
      {TUTORIAL_CHAPTERS.map((chapter, index) => {
        const active = step === index;
        const done = step > index;
        return (
          <li key={chapter.id} className="relative">
            {index < TUTORIAL_CHAPTERS.length - 1 && (
              <span
                className={cn(
                  "absolute left-[15px] top-[32px] h-[calc(100%-16px)] w-px",
                  done ? "bg-amber/35" : "bg-parchment/10",
                )}
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => onStep(index)}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                active ? "bg-parchment/[0.055]" : "hover:bg-parchment/[0.025]",
              )}
            >
              <span
                className={cn(
                  "relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border font-mono text-[9px] transition-colors",
                  active
                    ? "border-amber bg-amber text-[#17130c]"
                    : done
                      ? "border-amber/40 bg-[#141b15] text-amber"
                      : "border-parchment/15 bg-[#0f150f] text-ash",
                )}
              >
                {done && !active ? <Check className="h-3 w-3" strokeWidth={2.5} /> : index === 0 ? "✦" : index}
              </span>
              <span className="min-w-0">
                <span className={cn("block font-mono text-[7.5px] uppercase tracking-[0.17em]", active ? "text-amber" : "text-ash/70")}>
                  {chapter.kicker}
                </span>
                <span className={cn("block truncate text-[12px] leading-snug", active ? "text-parchment" : "text-parchment-dim")}>
                  {chapter.title}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter 1: walking the lane                                        */
/* ------------------------------------------------------------------ */

const STATION_AT = 68;

function LaneWalk({ onArrive }: { onArrive: () => void }) {
  const [position, setPosition] = useState(10);
  const [direction, setDirection] = useState(0);
  const arrived = position >= STATION_AT - 4;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPosition((current) => Math.max(2, Math.min(84, current + direction * 0.9)));
    }, 36);
    return () => window.clearInterval(interval);
  }, [direction]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        setDirection(1);
      }
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        setDirection(-1);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (["ArrowRight", "ArrowLeft", "a", "d", "A", "D"].includes(event.key)) setDirection(0);
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, []);

  const stop = () => setDirection(0);

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-parchment/15">
        <img
          src="/images/hollow-creek.jpg"
          alt="A foggy village lane at dusk with warm lantern light"
          className="h-[220px] w-full object-cover object-[50%_58%] sm:h-[265px]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060a07] via-[#070c08]/30 to-[#060a07]/55" aria-hidden />
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-parchment/15 bg-[#070b08]/70 px-2.5 py-1 backdrop-blur">
          <MapPin className="h-3 w-3 text-amber" />
          <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-parchment-dim">Callow Lane · 21 paces</span>
        </div>

        <div className="absolute bottom-6 left-[6%] right-[6%] h-[2px] bg-parchment/20" aria-hidden />
        <div className="absolute bottom-[21px] left-[6%] h-1.5 w-1.5 rounded-full bg-amber/50" aria-hidden />

        <div
          className="absolute bottom-6 z-10 transition-[left] duration-75"
          style={{ left: `${6 + (position / 100) * 88}%` }}
        >
          <div className="relative -translate-x-1/2">
            <div className="absolute bottom-0 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-amber/20 blur-xl" aria-hidden />
            <div className="relative flex flex-col items-center">
              <span className="mb-1 grid h-7 w-7 place-items-center rounded-full border border-amber/60 bg-[#1a160d] shadow-[0_0_22px_rgba(215,163,95,0.45)]">
                <Flame className="h-3.5 w-3.5 text-amber-bright" />
              </span>
              <svg viewBox="0 0 22 44" className="h-9 w-5 text-[#0a0d09]" aria-hidden>
                <path d="M8 3h6v7H8z" fill="#d0c3a9" fillOpacity="0.8" />
                <path d="M5 10h12l3 22H2L5 10Z" fill="#121812" stroke="#d7a35f" strokeOpacity="0.45" />
                <path d="M6 32h10v9H6z" fill="#090c09" />
              </svg>
              <span className="mt-1 whitespace-nowrap font-mono text-[7px] uppercase tracking-[0.13em] text-parchment/60">
                you
              </span>
            </div>
          </div>
        </div>

        <div className="absolute bottom-7 right-[13%] z-10 -translate-x-1/2">
          <div className={cn("absolute bottom-0 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full blur-2xl transition-colors", arrived ? "bg-amber/25" : "bg-amber/[0.06]")} aria-hidden />
          <div className="relative flex flex-col items-center">
            <span className={cn("mb-1 grid h-9 w-9 place-items-center rounded-full border transition-colors", arrived ? "border-amber/70 text-amber-bright" : "border-parchment/20 text-parchment/40")}>
              <Lamp className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <div className="relative h-14 w-1 bg-parchment/30">
              <span className="absolute -left-[7px] top-0 h-2 w-4 bg-parchment/30" />
              <div className={cn("absolute -left-[11px] top-3 h-6 w-6 rounded-sm border", arrived ? "border-amber/60 bg-amber/20" : "border-parchment/25 bg-[#0d120e]")} />
            </div>
            <span className="mt-1 whitespace-nowrap font-mono text-[7px] uppercase tracking-[0.13em] text-parchment/60">
              old lamp
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-parchment/10 bg-parchment/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button
              type="button"
              onPointerDown={() => setDirection(-1)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="grid h-10 w-10 touch-none place-items-center rounded-lg border border-parchment/20 bg-[#121913] text-parchment transition hover:border-amber/40 active:bg-amber/10"
              aria-label="Walk left"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onPointerDown={() => setDirection(1)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="grid h-10 w-10 touch-none place-items-center rounded-lg border border-parchment/20 bg-[#121913] text-parchment transition hover:border-amber/40 active:bg-amber/10"
              aria-label="Walk right"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-ash">
            Hold to walk · A / D or arrow keys
          </span>
        </div>
        {arrived ? (
          <Button onClick={() => { sfx("chime"); onArrive(); }} className="py-3 text-[10px]">
            Examine the old lamp <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <span className="inline-flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.13em] text-amber/80">
            <Footprints className="h-3.5 w-3.5" /> {Math.max(0, Math.ceil(STATION_AT - position))} paces to the lamp
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter 3: the body                                                */
/* ------------------------------------------------------------------ */

function BodyScene({
  found,
  onFind,
  onReport,
}: {
  found: string[];
  onFind: (id: string) => void;
  onReport: () => void;
}) {
  const spots = [
    { id: "lampblack", x: 54, y: 46, label: "The body", icon: Eye },
    { id: "button", x: 31, y: 61, label: "A glint", icon: Search },
    { id: "sign", x: 73, y: 64, label: "The gutter", icon: Footprints },
  ];
  const all = found.length === EVIDENCE.length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div>
      <div className="relative min-h-[300px] overflow-hidden rounded-xl border border-parchment/15 bg-[#0d120e] sm:min-h-[330px]">
        <img
          src="/images/hollow-creek.jpg"
          alt="A dark village lane with a shape lying in the fog"
          className="absolute inset-0 h-full w-full object-cover object-[36%_66%] opacity-55"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(7,11,8,0.35),_rgba(5,8,6,0.9))]" aria-hidden />
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full border border-ember/40 bg-ember/10">
            <Moon className="h-3 w-3 text-[#e6a283]" />
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-parchment-dim">Bell past eleven</span>
        </div>

        <div className="absolute bottom-[18%] left-[44%] h-8 w-28 rounded-[50%] bg-black/40 blur-sm" aria-hidden />
        <div className="absolute bottom-[24%] left-[48%] h-5 w-14 -rotate-6 rounded-full bg-[#11160f] opacity-90" aria-hidden />

        {spots.map((spot) => {
          const isFound = found.includes(spot.id);
          const Icon = spot.icon;
          return (
            <button
              key={spot.id}
              type="button"
              onClick={() => onFind(spot.id)}
              className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
              aria-label={`Inspect ${spot.label}`}
            >
              <span className={cn("relative grid h-9 w-9 place-items-center rounded-full border transition-all", isFound ? "border-amber/60 bg-amber/20 text-amber-bright" : "border-parchment/30 bg-[#0a0e0b]/80 text-parchment-dim group-hover:border-amber/60 group-hover:text-amber")}>
                {isFound ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" strokeWidth={1.5} />}
                {!isFound && <span className="absolute inset-0 animate-ping rounded-full border border-amber/30" aria-hidden />}
              </span>
              <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap font-mono text-[7.5px] uppercase tracking-[0.12em] text-parchment/70">
                {spot.label}
              </span>
            </button>
          );
        })}

        <div className="absolute bottom-3 left-4 z-10 flex items-center gap-2">
          <Bell className="h-3 w-3 text-amber/70" />
          <span className="font-mono text-[7.5px] uppercase tracking-[0.14em] text-parchment/55">the bell is three lanes away</span>
        </div>
      </div>

      <div className="mt-2.5 rounded-lg border border-parchment/10 bg-[#080c09]/80 p-3">
        <p className="text-[11.5px] leading-relaxed text-parchment-dim">
          A neighbour lies still in the lane. Three small things wait to be noticed. Look first — then ring the bell.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-ash">
            {found.length} / 3 details gathered
          </span>
          {all ? (
            <Button onClick={onReport} className="px-3 py-2 text-[9px]">
              <Bell className="h-3 w-3" /> Ring and report
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-amber/80">
              <Search className="h-3 w-3" /> click each glowing pin
            </span>
          )}
        </div>
      </div>
      </div>

      <div className="space-y-2.5">
        {EVIDENCE.map((item) => {
          const isFound = found.includes(item.id);
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-lg border px-3.5 py-3 transition-colors",
                isFound ? "border-amber/25 bg-amber/[0.05]" : "border-parchment/10 bg-parchment/[0.02] opacity-60",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-3.5 w-3.5", isFound ? "text-amber" : "text-ash")} strokeWidth={1.5} />
                <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-ash">{item.label}</span>
                {isFound && <Check className="ml-auto h-3 w-3 text-amber" />}
              </div>
              <div className={cn("mt-1 text-[12.5px] font-medium", isFound ? "text-parchment" : "text-parchment-dim")}>
                {isFound ? item.title : "Unread"}
              </div>
              {isFound && <p className="mt-1 text-[11px] leading-relaxed text-parchment-dim">{item.text}</p>}
            </div>
          );
        })}
        {!all && (
          <div className="flex items-start gap-2 pt-1 text-[11px] leading-relaxed text-ash">
            <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Inspect each mark on the scene. Click a glowing pin.
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chapter 4: the question                                            */
/* ------------------------------------------------------------------ */

function VoteScene({
  verdict,
  onVote,
}: {
  verdict: Suspect | null;
  onVote: (id: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState(false);
  const correct = picked === "silas";

  const submit = () => {
    if (!picked) return;
    if (picked === "silas") {
      onVote(picked);
    } else {
      sfx("error");
      setWrong(true);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-parchment/10 bg-parchment/[0.03] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-amber" />
          <span className="text-[11.5px] text-parchment-dim">Your three gathered details:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EVIDENCE.map((e) => (
            <Chip key={e.id} tone="amber">{e.label}</Chip>
          ))}
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {SUSPECTS.map((suspect) => {
          const selected = picked === suspect.id;
          return (
            <button
              key={suspect.id}
              type="button"
              onClick={() => { setPicked(suspect.id); setWrong(false); sfx("click"); }}
              disabled={Boolean(verdict)}
              className={cn(
                "group rounded-xl border p-3.5 text-left transition-all",
                selected ? "border-amber/55 bg-amber/[0.07]" : "border-parchment/10 bg-parchment/[0.025] hover:border-parchment/25",
              )}
            >
              <div className="flex items-start gap-3">
                <Portrait initials={suspect.initials} colour={suspect.colour} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-parchment">{suspect.name}</span>
                    {selected && <Check className="h-3.5 w-3.5 text-amber" />}
                  </div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.13em] text-ash">{suspect.role}</div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-parchment-dim">{suspect.tell}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!verdict && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] leading-relaxed text-ash">Choose the hand that left the evidence. There is one clean answer.</p>
          <Button
            disabled={!picked}
            onClick={submit}
            className="py-3 text-[10px]"
          >
            Put the question <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {correct && verdict && (
        <div className="mt-4 rounded-xl border border-amber/35 bg-[radial-gradient(ellipse_at_top_left,_rgba(215,163,95,0.14),_transparent_65%)] p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-amber/40 text-amber">
              <Check className="h-4 w-4" />
            </span>
            <div>
              <p className="font-serif text-lg leading-tight text-parchment">The lampblack gives him away.</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-parchment-dim">
                Silas Pike keeps the wicks and the black oil. The torn button is his. He does not deny it. The iron
                cage closes with a sound like a held breath.
              </p>
            </div>
          </div>
        </div>
      )}

      {wrong && !verdict && (
        <div className="mt-4 rounded-xl border border-ember/30 bg-ember/[0.06] p-4">
          <p className="font-serif text-[16px] italic text-parchment-dim">
            &ldquo;The evidence is a small thing. Do not make it into a large one.&rdquo;
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-parchment-dim">
            The Gloamwing settles on your shoulder. Try again: match the mark to the trade that could have left it.
          </p>
          <Button variant="secondary" onClick={() => { setPicked(null); setWrong(false); }} className="mt-3 px-3 py-2 text-[9px]">
            Look at the evidence again
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tutorial shell                                                     */
/* ------------------------------------------------------------------ */

export function Tutorial({
  initialStep,
  name,
  onName,
  onStep,
  onSeal,
  onComplete,
  onExit,
  onPlayNight,
  onBestiary,
}: {
  initialStep: number;
  name: string;
  onName: (value: string) => void;
  onStep: (step: number) => void;
  onSeal: (id: MinigameId) => void;
  onComplete: () => void;
  onExit: () => void;
  onPlayNight: () => void;
  onBestiary: () => void;
}) {
  const [step, setStep] = useState(Math.min(5, Math.max(0, initialStep)));
  const [draft, setDraft] = useState(name);
  const [gameOpen, setGameOpen] = useState(false);
  const [wardDone, setWardDone] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const [reported, setReported] = useState(false);
  const [verdict, setVerdict] = useState<Suspect | null>(null);
  const [finished, setFinished] = useState(false);
  const completed = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  useEffect(() => {
    if (step !== 5 || completed.current) return;
    completed.current = true;
    setFinished(true);
    sfx("seal");
    onComplete();
  }, [step, onComplete]);

  const goTo = (next: number) => {
    setStep(next);
    onStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const advance = () => goTo(Math.min(5, step + 1));

  const revealEvidence = (id: string) => {
    if (found.includes(id)) return;
    sfx("click");
    setFound((current) => [...current, id]);
  };

  const vote = (id: string) => {
    sfx("bell");
    setVerdict(SUSPECTS.find((s) => s.id === id) ?? null);
  };

  const startNight = () => {
    if (draft.trim()) onName(draft.trim());
    onPlayNight();
  };

  const ward = getWard("lantern");

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-5 sm:px-7 lg:px-9 lg:pt-8">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Kicker>Singleplayer tutorial · the first night</Kicker>
          <h1 className="mt-2 font-serif text-[26px] leading-tight text-parchment sm:text-[32px]">
            One lantern. One lane. One lesson at a time.
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {TUTORIAL_CHAPTERS.map((chapter, index) => (
              <span
                key={chapter.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  index === step ? "w-7 bg-amber" : index < step ? "w-3 bg-amber/40" : "w-3 bg-parchment/12",
                )}
              />
            ))}
          </div>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-ash">{step + 1} / 6</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[235px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="rounded-xl border border-parchment/10 bg-[#0d130f]/75 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-ash">The lesson</span>
              <Feather className="h-3 w-3 text-ash" />
            </div>
            <ChapterRail step={step} onStep={(next) => goTo(next)} />
          </div>
          <div className="mt-3">
            <Coach step={step} />
          </div>
          <button
            type="button"
            onClick={onExit}
            className="mt-4 inline-flex items-center gap-1.5 px-2 font-mono text-[8px] uppercase tracking-[0.14em] text-ash/70 transition hover:text-amber"
          >
            <ArrowLeft className="h-3 w-3" /> Back to the creek
          </button>
        </aside>

        <div className="min-w-0">
          <div className="lg:hidden">
            <Coach step={step} compact />
            <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
              {TUTORIAL_CHAPTERS.map((chapter, index) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => goTo(index)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1.5 font-mono text-[8px] uppercase tracking-[0.1em]",
                    index === step
                      ? "border-amber/50 bg-amber/15 text-amber-bright"
                      : index < step
                        ? "border-parchment/15 text-parchment-dim"
                        : "border-parchment/10 text-ash/60",
                  )}
                >
                  {chapter.short}
                </button>
              ))}
            </div>
          </div>

          <div
            key={step}
            className="relative mt-4 overflow-hidden rounded-2xl border border-parchment/12 bg-[#0c120e] shadow-[0_24px_80px_-40px_rgba(0,0,0,0.9)] lg:mt-0"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent" aria-hidden />
            <div className="p-5 sm:p-7 lg:p-8">
              {step === 0 && (
                <div>
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-[460px]">
                      <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">Before you walk</span>
                      <h2 className="mt-2 font-serif text-[34px] leading-[1.02] text-parchment sm:text-[42px]">
                        The first night is
                        <br />
                        <span className="italic text-amber-bright">the only honest one.</span>
                      </h2>
                      <p className="mt-3 max-w-[420px] text-[12.5px] leading-relaxed text-parchment-dim">
                        Nobody expects you to know the creek yet. In eight quiet minutes, you will learn to carry a
                        light, finish a ward, read a body, and put a question to the town. The Hollow will not wait
                        forever — but tonight, it will wait for you.
                      </p>
                    </div>
                    <div className="w-full max-w-[210px] shrink-0 rounded-xl border border-parchment/12 bg-parchment/[0.025] p-4">
                      <label htmlFor="tutorial-name" className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">
                        The name on your coat
                      </label>
                      <input
                        id="tutorial-name"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.slice(0, 18))}
                        placeholder="Wren"
                        className="mt-2 w-full border-b border-parchment/25 bg-transparent pb-2 font-serif text-xl text-parchment outline-none transition placeholder:text-ash/40 focus:border-amber"
                      />
                      <p className="mt-3 text-[10.5px] leading-relaxed text-ash">
                        The town will remember it. This stays on this device.
                      </p>
                    </div>
                  </div>

                  <div className="mt-7 grid gap-2.5 sm:grid-cols-3">
                    {[
                      { icon: Flame, title: "Your lantern", text: "You see what it can reach. No wallhacks in the dark." },
                      { icon: Leaf, title: "Shared wards", text: "Anyone living can finish any chore. Work is never owned." },
                      { icon: Eye, title: "Read, then vote", text: "Evidence is small. Accusations are cheap. Choose carefully." },
                    ].map((rule) => (
                      <div key={rule.title} className="rounded-lg border border-parchment/10 bg-parchment/[0.02] p-3.5">
                        <rule.icon className="h-4 w-4 text-amber" strokeWidth={1.5} />
                        <div className="mt-2 text-[12px] font-medium text-parchment">{rule.title}</div>
                        <p className="mt-1 text-[10.5px] leading-relaxed text-ash">{rule.text}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-7 flex flex-col items-start gap-3 border-t border-parchment/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="inline-flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.14em] text-ash">
                      <Volume2 className="h-3 w-3" /> Best with sound & the room lights low
                    </span>
                    <Button
                      onClick={() => {
                        onName(draft.trim() || "Wren");
                        sfx("chime");
                        advance();
                      }}
                      className="group"
                    >
                      Take up the lantern
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">Chapter I · the lane</span>
                  <h2 className="mt-2 font-serif text-[30px] leading-tight text-parchment sm:text-[36px]">
                    Find your feet. Find the lamp.
                  </h2>
                  <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-parchment-dim">
                    The lane runs one way. Hold the arrows or use <span className="text-parchment">A</span> and{" "}
                    <span className="text-parchment">D</span> to carry your lantern to the old lamp post. There is
                    nothing behind you worth seeing.
                  </p>
                  <div className="mt-5">
                    <LaneWalk onArrive={advance} />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div>
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">Chapter II · a ward</span>
                  <h2 className="mt-2 font-serif text-[30px] leading-tight text-parchment sm:text-[36px]">
                    The lane is dark. Earn its light.
                  </h2>
                  <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-parchment-dim">
                    Chores in Hollow Creek are called wards, and they belong to the whole town. This one is yours for
                    as long as it takes: three brass bands, one drowned wick, and no penalty for thinking.
                  </p>

                  <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_210px]">
                    <div className="relative overflow-hidden rounded-xl border border-parchment/12 bg-[radial-gradient(ellipse_at_center,_rgba(215,163,95,0.12),_transparent_70%)] p-5">
                      <div className="absolute right-4 top-4 font-mono text-[7.5px] uppercase tracking-[0.16em] text-ash/60">
                        ward I of IV
                      </div>
                      <div className="flex items-start gap-4">
                        <div className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full border border-amber/25">
                          <span className="absolute inset-2 rounded-full border border-amber/15" aria-hidden />
                          <Flame className="h-7 w-7 text-amber-bright" strokeWidth={1.2} />
                        </div>
                        <div>
                          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-ash">{ward.station}</div>
                          <h3 className="mt-1 font-serif text-2xl leading-tight text-parchment">{ward.game}</h3>
                          <p className="mt-1.5 max-w-[320px] text-[11.5px] leading-relaxed text-parchment-dim">{ward.blurb}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex items-center gap-2.5">
                        <Button onClick={() => setGameOpen(true)} className="py-3 text-[10px]">
                          {wardDone ? "Look at the sealed ward" : "Work the ward"} <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                        {wardDone ? <Chip tone="moss"><Check className="h-2.5 w-2.5" /> sealed</Chip> : <Chip>~40 sec</Chip>}
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber/20 bg-amber/[0.04] p-4">
                      <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-amber">Why it matters</span>
                      <p className="mt-2 font-serif text-[15px] italic leading-relaxed text-parchment-dim">
                        &ldquo;A ward is not a progress bar. It is a small argument with the dark — and you are allowed
                        to enjoy winning it.&rdquo;
                      </p>
                      <p className="mt-2 text-[10.5px] text-ash">Every completed ward earns one clue about the Hollow.</p>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-parchment/10 pt-4">
                    <Button variant="ghost" onClick={() => goTo(1)} className="px-1 text-[10px]">
                      <ArrowLeft className="h-3.5 w-3.5" /> The lane
                    </Button>
                    <Button variant="secondary" disabled={!wardDone} onClick={advance} className="py-3 text-[10px]">
                      Follow the cold smell <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">Chapter III · the body</span>
                  <h2 className="mt-2 font-serif text-[30px] leading-tight text-parchment sm:text-[36px]">
                    Look first. Shout second.
                  </h2>
                  <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-parchment-dim">
                    The ward-light finds your neighbour in the lane. Gather the three details that survive the dark,
                    then ring the bell. The town will walk to the square on its own feet — no teleporting, no hiding.
                  </p>
                  <div className="mt-5">
                    <BodyScene found={found} onFind={revealEvidence} onReport={() => { setReported(true); sfx("bell"); }} />
                  </div>
                  {reported && (
                    <div className="mt-4 rounded-lg border border-amber/30 bg-amber/[0.06] p-4">
                      <div className="flex items-start gap-3">
                        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
                        <div>
                          <p className="text-[12.5px] font-medium text-parchment">The bell goes out across the creek.</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-parchment-dim">
                            Every living soul now walks to the square. You carry three details and one long walk.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-5 flex items-center justify-between border-t border-parchment/10 pt-4">
                    <Button variant="ghost" onClick={() => goTo(2)} className="px-1 text-[10px]">
                      <ArrowLeft className="h-3.5 w-3.5" /> The ward
                    </Button>
                    <Button variant="secondary" disabled={!reported} onClick={advance} className="py-3 text-[10px]">
                      Walk to the square <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div>
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">Chapter IV · the square</span>
                  <h2 className="mt-2 font-serif text-[30px] leading-tight text-parchment sm:text-[36px]">
                    Four neighbours. One wrong question.
                  </h2>
                  <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-parchment-dim">
                    No one is hanged in Hollow Creek. The condemned go into an iron cage in the square, still able to
                    speak, still able to lie. Your job is not certainty. It is the best answer the evidence allows.
                  </p>
                  <div className="mt-5">
                    <VoteScene verdict={verdict} onVote={vote} />
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-parchment/10 pt-4">
                    <Button variant="ghost" onClick={() => goTo(3)} className="px-1 text-[10px]">
                      <ArrowLeft className="h-3.5 w-3.5" /> The body
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!verdict || verdict.id !== "silas"}
                      onClick={advance}
                      className="py-3 text-[10px]"
                    >
                      See the morning <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 5 && (
                <div>
                  <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-start">
                    <div>
                      <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">Dawn · the ledger</span>
                      <h2 className="mt-2 font-serif text-[32px] leading-[1.05] text-parchment sm:text-[40px]">
                        A name in the ledger.
                      </h2>
                      <p className="mt-3 max-w-[440px] text-[12.5px] leading-relaxed text-parchment-dim">
                        The sun finds you with lampblack on your own hands and a town still standing. Your first night
                        is over. Whatever else happens in Hollow Creek, the creek now knows your stride.
                      </p>

                      <div className="mt-6 rounded-xl border border-amber/25 bg-[radial-gradient(ellipse_at_top_left,_rgba(215,163,95,0.12),_transparent_65%)] p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 place-items-center rounded-full border border-amber/40 text-amber">
                              <MothMark className="h-4.5 w-4.5" />
                            </span>
                            <div>
                              <div className="font-mono text-[7.5px] uppercase tracking-[0.18em] text-amber">First night complete</div>
                              <div className="font-serif text-[18px] leading-tight text-parchment">{draft || name || "Wren"}</div>
                            </div>
                          </div>
                          <Chip tone="moss"><Check className="h-2.5 w-2.5" /> witnessed</Chip>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-parchment/10 pt-3">
                          <div>
                            <div className="font-serif text-xl text-parchment">1</div>
                            <div className="font-mono text-[7px] uppercase tracking-[0.13em] text-ash">ward sealed</div>
                          </div>
                          <div>
                            <div className="font-serif text-xl text-parchment">3</div>
                            <div className="font-mono text-[7px] uppercase tracking-[0.13em] text-ash">details read</div>
                          </div>
                          <div>
                            <div className="font-serif text-xl text-parchment">{formatTime(8 * 60 + 42)}</div>
                            <div className="font-mono text-[7px] uppercase tracking-[0.13em] text-ash">ledger time</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-parchment/12 bg-[#0b100c]">
                      <img
                        src="/images/gloamwing.jpg"
                        alt="The Gloamwing, a pale moth with lantern-like wings"
                        className="h-[185px] w-full object-cover"
                      />
                      <div className="p-3.5">
                        <div className="font-mono text-[7.5px] uppercase tracking-[0.18em] text-amber">Your witness</div>
                        <div className="mt-0.5 font-serif text-[18px] text-parchment">The Gloamwing</div>
                        <p className="mt-1.5 text-[10px] leading-relaxed text-ash">
                          It followed your lantern home. It has no side in the game of Hollow and crew — it is the
                          night's own witness.
                        </p>
                        <button
                          type="button"
                          onClick={onBestiary}
                          className="mt-2.5 inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.13em] text-amber"
                        >
                          Read the field note <ChevronRight className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-2 border-t border-parchment/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="inline-flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.14em] text-ash">
                      <Feather className="h-3 w-3" /> {finished ? "Saved in your night ledger" : "Writing the ledger…"}
                    </span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button variant="ghost" onClick={onExit} className="px-2 text-[10px]">Back to the creek</Button>
                      <Button onClick={startNight} className="py-3 text-[10px]">
                        Walk a night alone <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {step === 1 && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-parchment/10 px-4 py-3">
              <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-ash">Hint: the lamp is to your right</span>
              <Button variant="ghost" onClick={() => goTo(0)} className="px-1 text-[10px]">
                <ArrowLeft className="h-3.5 w-3.5" /> Rules
              </Button>
            </div>
          )}
          {step === 0 && (
            <button
              type="button"
              onClick={() => goTo(5)}
              className="mt-3 block w-full text-right font-mono text-[8px] uppercase tracking-[0.14em] text-ash/50 transition hover:text-amber"
            >
              I have walked this creek before · skip to the ledger
            </button>
          )}
        </div>
      </div>

      <div className="mt-7 flex items-center justify-center">
        <Ornament />
      </div>

      <MinigameModal
        key={`tutorial-lantern-${gameOpen}`}
        game={gameOpen ? "lantern" : null}
        mode="tutorial"
        onClose={() => setGameOpen(false)}
        onSolved={() => {
          setWardDone(true);
          onSeal("lantern");
          setGameOpen(false);
          goTo(3);
        }}
      />
    </div>
  );
}
