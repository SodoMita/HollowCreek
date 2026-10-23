import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  Eye,
  Feather,
  Flame,
  Gamepad2,
  KeyRound,
  Lamp,
  Moon,
  Play,
  Search,
  Shield,
  Sparkles,
  Sun,
  Trophy,
  Users,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  SEALS_META,
  SUSPECTS,
  TUTORIAL_CHAPTERS,
  WARDS,
  type MinigameId,
  type Progress,
  type View,
} from "../lib/game";
import { Button, Chip, Kicker, Ornament, Portrait, ProgressRing } from "./ui";

function MiniPreview({ id }: { id: MinigameId }) {
  if (id === "lantern") {
    return (
      <svg viewBox="0 0 160 108" className="h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="home-lantern-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f0c784" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#d7a35f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="54" r="50" fill="url(#home-lantern-glow)" />
        {[44, 32, 20].map((radius, index) => (
          <g key={radius}>
            <circle cx="80" cy="54" r={radius} fill="none" stroke="#cbbfa6" strokeOpacity={index === 0 ? 0.35 : 0.22} strokeWidth="1" strokeDasharray="2 5" />
            <circle
              cx={80 + Math.cos(([3, 1, 5][index] * 45 - 90) * (Math.PI / 180)) * radius}
              cy={54 + Math.sin(([3, 1, 5][index] * 45 - 90) * (Math.PI / 180)) * radius}
              r="2.5"
              fill="#f0c784"
              fillOpacity="0.85"
            />
          </g>
        ))}
        <path d="M80 54V16" stroke="#d7a35f" strokeOpacity="0.55" strokeDasharray="2 3" />
        <path d="M80 26l3 5h-6l3-5Z" fill="#e5ac5f" fillOpacity="0.7" />
        <rect x="75" y="47" width="10" height="16" rx="1.5" fill="#121812" stroke="#d7a35f" strokeOpacity="0.6" />
        <path d="M80 45c3 4 3 7 0 10-3-3-3-6 0-10Z" fill="#f5d9a3" />
      </svg>
    );
  }
  if (id === "well") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="relative h-[78px] w-10 rounded-t-full border border-parchment/20 bg-gradient-to-b from-[#151d16] to-[#0a0e0b]">
          <div className="absolute inset-x-1 top-[30%] h-[26%] border border-amber/35 bg-amber/15" />
          <div className="absolute left-1/2 top-[42%] h-3.5 w-6 -translate-x-1/2 rounded-sm border border-parchment/40 bg-[#1b241c]" />
          <span className="absolute -right-3 top-[44%] h-1 w-3 bg-amber/60" />
          <div className="absolute inset-x-2 bottom-1 h-1.5 rounded-full bg-parchment/10" />
        </div>
        <div className="ml-5 flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn("grid h-4 w-4 place-items-center rounded-full border", i < 2 ? "border-amber/50 text-amber" : "border-parchment/15 text-ash/30")}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (id === "candles") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="grid grid-cols-3 gap-2">
          {[1, 1, 0, 1, 0, 1, 0, 1, 1].map((lit, index) => (
            <div key={index} className={cn("flex h-[22px] w-[16px] flex-col items-center justify-end rounded-sm border px-0.5 pb-0.5", lit ? "border-amber/35 bg-amber/[0.08]" : "border-parchment/10")}>
              {lit && <span className="mb-0.5 h-1.5 w-1 rounded-full bg-amber-bright shadow-[0_0_6px_2px_rgba(240,199,132,0.35)]" />}
              <span className={cn("h-2.5 w-1.5 rounded-t-sm", lit ? "bg-[#bdb19a]" : "bg-parchment/20")} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="flex items-center gap-2">
        {["⌁", "✦", "◉"].map((glyph, index) => (
          <span key={glyph} className={cn("grid h-7 w-7 place-items-center rounded-full border font-serif text-sm", index === 1 ? "border-parchment/40 bg-parchment/[0.08] text-parchment" : "border-parchment/15 text-parchment/45")}>
            {glyph}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 text-[7px] uppercase tracking-[0.16em] text-ash">
        <span>remember</span>
        <ChevronRight className="h-2.5 w-2.5" />
        <span className="text-amber/80">repeat</span>
      </div>
    </div>
  );
}

function HeroCard({
  progress,
  goTutorial,
  goNight,
}: {
  progress: Progress;
  goTutorial: () => void;
  goNight: () => void;
}) {
  const tutorialLabel = progress.tutorialDone
    ? "Walk it again"
    : progress.tutorialStep > 0
      ? `Continue chapter ${progress.tutorialStep}`
      : "Begin the tutorial";
  return (
    <section className="relative overflow-hidden rounded-2xl border border-parchment/15 bg-[#0a0f0b]">
      <div className="absolute inset-0">
        <img
          src="/images/hollow-creek.jpg"
          alt="A one-street village at dusk in October 1893, with lantern light and fog"
          className="h-full w-full object-cover object-[54%_center] sm:object-[50%_center]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,_#080d09_2%,_rgba(8,13,9,0.92)_30%,_rgba(8,13,9,0.52)_62%,_rgba(8,13,9,0.14)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,_#080d09_1%,_transparent_45%)] sm:hidden" />
      </div>

      <div className="relative flex min-h-[520px] flex-col justify-between p-5 sm:min-h-[545px] sm:p-8 lg:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber/30 bg-[#080d09]/60 px-3 py-1.5 backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
            </span>
            <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-amber">The first night · a solo prologue</span>
          </div>
          <span className="hidden font-mono text-[8px] uppercase tracking-[0.18em] text-parchment/55 sm:inline">
            Hollow Creek · October, 1893
          </span>
        </div>

        <div className="mt-10 max-w-[600px] sm:mt-6">
          <h1 className="font-serif text-[42px] leading-[0.98] tracking-[-0.01em] text-parchment sm:text-[58px] lg:text-[66px]">
            The dark is not
            <span className="block italic text-amber-bright">a progress bar.</span>
          </h1>
          <p className="mt-4 max-w-[470px] text-[13px] leading-relaxed text-parchment-dim sm:text-[14px]">
            Four new ward games. One guided first night. And a creature the creek forgot to record. Hollow Creek&apos;s
            one-street folk horror, now playable alone — no server, no lobby, no one to blame but the neighbour you
            choose.
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button onClick={goTutorial} className="group py-4">
              <Play className="h-3.5 w-3.5 fill-current" /> {tutorialLabel}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button variant="secondary" onClick={goNight} className="group py-4">
              Walk a night alone
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[8px] uppercase tracking-[0.14em] text-parchment/55">
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3" /> 8 quiet minutes</span>
            <span className="inline-flex items-center gap-1.5"><Gamepad2 className="h-3 w-3" /> 4 ward minigames</span>
            <span className="inline-flex items-center gap-1.5"><Shield className="h-3 w-3" /> no account needed</span>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:mt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="relative w-full max-w-[290px] overflow-hidden rounded-xl border border-parchment/20 bg-[#0a0f0b]/80 p-3 backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="relative h-14 w-12 shrink-0 overflow-hidden rounded-lg border border-amber/20">
                <img src="/images/gloamwing.jpg" alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-0 bg-gradient-to-t from-[#0a0f0b] to-transparent" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-mono text-[7px] uppercase tracking-[0.16em] text-amber">
                  <Sparkles className="h-2 w-2" /> Your night keeper
                </div>
                <div className="mt-0.5 font-serif text-[17px] leading-none text-parchment">The Gloamwing</div>
                <p className="mt-1 text-[9.5px] leading-relaxed text-parchment/65">
                  &ldquo;I remember what the morning edits out.&rdquo;
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between border-t border-parchment/10 pt-2">
              <span className="font-mono text-[7px] uppercase tracking-[0.12em] text-parchment/50">neither crew nor hollow</span>
              <span className="grid h-4 w-4 place-items-center rounded-full border border-amber/30 text-[7px] text-amber">✦</span>
            </div>
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <span className="font-mono text-[7.5px] uppercase tracking-[0.14em] text-parchment/45">Filed under</span>
            <span className="border-b border-amber/30 pb-0.5 font-serif text-[13px] italic text-parchment-dim">things that follow lanterns</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function WardCard({ id, index, onPractice }: { id: MinigameId; index: number; onPractice: (id: MinigameId) => void }) {
  const ward = WARDS.find((item) => item.id === id)!;
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-parchment/12 bg-[#0d130f]/85 transition-colors hover:border-amber/25">
      <div className="relative h-[118px] overflow-hidden border-b border-parchment/[0.08] bg-[radial-gradient(ellipse_at_center,_rgba(215,163,95,0.07),_transparent_70%)]">
        <div className="absolute left-3 top-3 font-mono text-[7px] uppercase tracking-[0.15em] text-ash/55">Ward {String(index + 1).padStart(2, "0")}</div>
        <div className="absolute right-3 top-3">
          <Chip className="px-1.5 py-0.5">{ward.difficulty}</Chip>
        </div>
        <div className="absolute inset-0 px-6 pb-2 pt-6">
          <MiniPreview id={id} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-1.5 font-mono text-[7.5px] uppercase tracking-[0.13em] text-amber/80">
          <MapPin className="h-2.5 w-2.5" /> {ward.station}
        </div>
        <h3 className="mt-1 font-serif text-[22px] leading-tight text-parchment">{ward.game}</h3>
        <p className="mt-1.5 flex-1 text-[10.5px] leading-relaxed text-ash">{ward.blurb}</p>
        <div className="mt-3 flex items-center justify-between border-t border-parchment/[0.08] pt-3">
          <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-ash/70">{ward.duration}</span>
          <button
            type="button"
            onClick={() => onPractice(id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-parchment/20 px-2.5 py-1.5 font-mono text-[7.5px] uppercase tracking-[0.12em] text-parchment transition hover:border-amber/50 hover:bg-amber/10 hover:text-amber-bright"
          >
            Try this ward <ArrowRight className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Home({
  progress,
  go,
  onPractice,
}: {
  progress: Progress;
  go: (view: View) => void;
  onPractice: (id: MinigameId) => void;
}) {
  const lastNight = progress.nights[progress.nights.length - 1];
  const completedChapters = progress.tutorialDone ? TUTORIAL_CHAPTERS.length : progress.tutorialStep;

  return (
    <div>
      <HeroCard progress={progress} goTutorial={() => go("tutorial")} goNight={() => go("night")} />

      <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-parchment/10 bg-[#0c110d]/70 sm:grid-cols-4">
        {[
          { value: "04", label: "playable wards", icon: Flame },
          { value: "01", label: "guided first night", icon: BookOpen },
          { value: "08", label: "minutes to belong", icon: Clock },
          { value: "∞", label: "random Hollows", icon: Moon },
        ].map((stat, index) => (
          <div
            key={stat.label}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5",
              index !== 0 && "border-l border-parchment/[0.08]",
              index >= 2 && "border-t border-parchment/[0.08] sm:border-t-0",
            )}
          >
            <stat.icon className="h-4 w-4 shrink-0 text-amber/70" strokeWidth={1.3} />
            <div>
              <div className="font-serif text-lg leading-none text-parchment">{stat.value}</div>
              <div className="mt-1 font-mono text-[7px] uppercase tracking-[0.13em] text-ash">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      <section className="mt-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Kicker>What the dark was missing</Kicker>
            <h2 className="mt-3 max-w-[560px] font-serif text-[30px] leading-[1.05] text-parchment sm:text-[38px]">
              Chores you can actually <span className="italic text-amber-bright">lose yourself in.</span>
            </h2>
          </div>
          <p className="max-w-[340px] text-[11.5px] leading-relaxed text-ash">
            In the old creek, a ward was a held button. Now it is a little argument with brass, rope, wax, and proud
            crows. Four games, four moods — all of them optional to lose.
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {WARDS.map((ward, index) => (
            <WardCard key={ward.id} id={ward.id} index={index} onPractice={onPractice} />
          ))}
        </div>
        <div className="mt-3 flex flex-col justify-between gap-2 px-1 sm:flex-row sm:items-center">
          <span className="inline-flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.13em] text-ash/70">
            <Sparkles className="h-3 w-3 text-amber/70" /> Practice any ward without starting a night
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-ash/60">Every ward earns a clue in the solo night</span>
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-2xl border border-parchment/12 bg-[#0c110d]">
        <div className="absolute inset-0 opacity-20">
          <img src="/images/hollow-creek.jpg" alt="" className="h-full w-full object-cover object-[50%_78%]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0c110d] via-[#0c110d]/90 to-[#0c110d]/60" />
        </div>
        <div className="relative grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:gap-10">
          <div>
            <Kicker>The singleplayer tutorial</Kicker>
            <h2 className="mt-3 font-serif text-[30px] leading-[1.03] text-parchment sm:text-[38px]">
              The first night is
              <span className="block italic text-amber-bright">the only honest one.</span>
            </h2>
            <p className="mt-3 max-w-[390px] text-[12px] leading-relaxed text-parchment-dim">
              You will not be thrown into a meeting with strangers. A lantern, a lane, a ward, a body, and one clean
              question — taught by the only creature in the creek with no side in the game.
            </p>
            <div className="mt-5 space-y-2">
              {[
                { icon: Lamp, text: "Carry a lantern with real reach" },
                { icon: Flame, text: "Finish a ward game at your own pace" },
                { icon: Search, text: "Read a scene before you ring the bell" },
                { icon: Users, text: "Put one careful question to the square" },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-2.5 text-[11.5px] text-parchment-dim">
                  <item.icon className="h-3.5 w-3.5 text-amber/80" strokeWidth={1.5} />
                  {item.text}
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Button onClick={() => go("tutorial")} className="py-3.5 text-[10px]">
                {progress.tutorialDone ? "Walk it again" : progress.tutorialStep > 0 ? "Pick up where you left off" : "Begin the first night"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            {progress.tutorialDone && (
              <div className="mt-3 inline-flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#a7bda9]">
                <Check className="h-3 w-3" /> completed · saved in your ledger
              </div>
            )}
          </div>

          <div className="rounded-xl border border-parchment/12 bg-[#0a0f0b]/75 p-3.5 backdrop-blur sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">A walkthrough, in six lamps</span>
              <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-amber">{Math.min(completedChapters, 6)} / 6</span>
            </div>
            <div className="space-y-0.5">
              {TUTORIAL_CHAPTERS.map((chapter, index) => {
                const done = progress.tutorialDone || index < progress.tutorialStep;
                const current = !progress.tutorialDone && index === progress.tutorialStep;
                return (
                  <div key={chapter.id} className="relative flex items-start gap-3 rounded-lg px-2 py-2">
                    {index < TUTORIAL_CHAPTERS.length - 1 && <span className={cn("absolute left-[18px] top-[28px] h-[calc(100%-14px)] w-px", done ? "bg-amber/30" : "bg-parchment/10")} aria-hidden />}
                    <span className={cn("relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[8px]", done ? "border-amber/45 bg-amber/15 text-amber" : current ? "border-amber bg-amber text-[#17130c]" : "border-parchment/15 text-ash")}>
                      {done ? <Check className="h-3 w-3" /> : index === 0 ? "✦" : index}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={cn("text-[11.5px] leading-snug", current ? "text-parchment" : "text-parchment-dim")}>{chapter.title}</span>
                        <span className="shrink-0 font-mono text-[7px] uppercase tracking-[0.1em] text-ash/60">{chapter.kicker}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-parchment/[0.08] pt-3">
              <span className="inline-flex items-center gap-1.5 font-mono text-[7px] uppercase tracking-[0.12em] text-ash/60">
                <Feather className="h-2.5 w-2.5" /> taught by the Gloamwing
              </span>
              <span className="font-mono text-[7px] uppercase tracking-[0.12em] text-amber/70">progress saved locally</span>
            </div>
          </div>
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-2xl border border-[#2a2418] bg-[#e9dfc8] text-[#20241b] shadow-[0_30px_90px_-50px_rgba(0,0,0,0.9)]">
        <div className="paper-grain absolute inset-0 opacity-60" aria-hidden />
        <div className="relative grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative min-h-[300px] overflow-hidden border-b border-[#2a2418]/15 lg:min-h-[440px] lg:border-b-0 lg:border-r">
            <img
              src="/images/gloamwing.jpg"
              alt="Archival naturalist plate of the Gloamwing, a pale moth with lantern-like wings"
              className="absolute inset-0 h-full w-full object-cover object-center mix-blend-multiply saturate-[0.82]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#e9dfc8]/85 via-transparent to-[#e9dfc8]/20" aria-hidden />
            <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-sm border border-[#20241b]/35 px-2 py-1 font-mono text-[7.5px] uppercase tracking-[0.16em] text-[#20241b]/75">
              <Stamp /> plate no. I
            </div>
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-[7px] uppercase tracking-[0.17em] text-[#20241b]/55">Hollow Creek field society</div>
                <div className="mt-0.5 font-serif text-[15px] italic text-[#20241b]/80">the only entry the dark won&apos;t touch</div>
              </div>
              <span className="grid h-11 w-11 shrink-0 -rotate-6 place-items-center rounded-full border-2 border-[#7d3f2c]/45 font-mono text-[6px] uppercase leading-tight tracking-[0.08em] text-[#7d3f2c]/70">
                neither<br />side
              </span>
            </div>
          </div>

          <div className="relative p-5 sm:p-8 lg:p-10">
            <div className="flex items-center gap-2">
              <span className="h-px w-7 bg-[#7d3f2c]/50" aria-hidden />
              <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-[#7d3f2c]">Newly recorded · the creature nobody else took</span>
            </div>
            <h2 className="mt-3 font-serif text-[40px] leading-none text-[#1c2119] sm:text-[54px]">The Gloamwing</h2>
            <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em] text-[#20241b]/55">Lampyris memorialis · the lantern-moth</p>
            <p className="mt-4 max-w-[450px] font-serif text-[16px] leading-relaxed text-[#2d3227]">
              It arrives after midnight with the smoke of every snuffed lantern in its wings. The Gloamwing belongs to
              neither crew nor Hollow. It does not vote. It remembers — the last word of the dead, the shape of a hand
              on a latch, the name the morning tries to edit out.
            </p>
            <p className="mt-2.5 max-w-[450px] font-serif text-[16px] leading-relaxed text-[#2d3227]">
              It is your witness in this edition of the creek. It is also, as far as the field society knows, the only
              living thing that has never once been wrong about who came home.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {[
                { icon: Flame, title: "Drinks smoke", text: "Never eats. Keeps a lantern's last breath." },
                { icon: Eye, title: "Repeats names", text: "Only the names it has heard someone lose." },
                { icon: KeyRound, title: "Cannot enter", text: "Stops at a lit threshold it was not invited across." },
              ].map((item) => (
                <div key={item.title} className="rounded-sm border border-[#20241b]/15 bg-[#f1e9d6]/60 p-2.5">
                  <item.icon className="h-3.5 w-3.5 text-[#7d3f2c]" strokeWidth={1.5} />
                  <div className="mt-1.5 font-mono text-[7px] uppercase tracking-[0.13em] text-[#1c2119]/80">{item.title}</div>
                  <p className="mt-0.5 font-serif text-[11px] leading-snug text-[#2d3227]/80">{item.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-col items-start gap-3 border-t border-[#20241b]/15 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-serif text-[12px] italic text-[#1c2119]/55">Filed by the Gloamwing, keeper of this edition.</span>
              <Button variant="dark" onClick={() => go("bestiary")} className="py-2.5 text-[8px]">
                Open the field guide <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="relative overflow-hidden rounded-2xl border border-parchment/12 bg-[#0d130f]/85 p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Kicker>The night ledger</Kicker>
              <h2 className="mt-3 font-serif text-[28px] leading-tight text-parchment sm:text-[34px]">
                A town keeps its <span className="italic text-amber-bright">own record.</span>
              </h2>
              <p className="mt-2 max-w-[360px] text-[11.5px] leading-relaxed text-ash">
                Seals, first-night marks, and every accusation you have made. It lives on this device and nowhere
                else — the creek is nosy enough without your account details.
              </p>
            </div>
            <ProgressRing value={progress.seals.length} total={4} size={66} label="seals" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEALS_META.map((seal) => {
              const owned = progress.seals.includes(seal.id);
              return (
                <div
                  key={seal.id}
                  className={cn(
                    "rounded-lg border p-2.5 text-center",
                    owned ? "border-amber/30 bg-amber/[0.06]" : "border-parchment/10 bg-parchment/[0.02]",
                  )}
                >
                  <span className={cn("font-serif text-xl", owned ? "text-amber-bright" : "text-ash/30")}>{seal.mark}</span>
                  <div className={cn("mt-1 font-mono text-[6.5px] uppercase leading-tight tracking-[0.08em]", owned ? "text-parchment-dim" : "text-ash/45")}>
                    {seal.name}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2 border-t border-parchment/[0.08] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ash">
                <Trophy className="h-3 w-3 text-amber/70" /> {progress.nights.length} night{progress.nights.length === 1 ? "" : "s"} walked
              </span>
              <span className="h-3 w-px bg-parchment/15" aria-hidden />
              <span className="inline-flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ash">
                <Check className="h-3 w-3 text-moss" /> {progress.tutorialDone ? "first night kept" : "first night unclaimed"}
              </span>
            </div>
            <Button variant="secondary" onClick={() => go("records")} className="py-2.5 text-[8.5px]">
              Open the ledger <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          {lastNight && (
            <div className="mt-3 rounded-lg border border-parchment/10 bg-[#0a0f0b] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Portrait initials={SUSPECTS.find((s) => s.name === lastNight.culprit)?.initials ?? "??"} colour="#c9854a" size="sm" hollow />
                  <div>
                    <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-ash">Most recent night · {lastNight.name}</div>
                    <div className="text-[11px] text-parchment-dim">
                      The Hollow was <span className="text-parchment">{lastNight.culprit}</span> · you named {lastNight.accused}
                    </div>
                  </div>
                </div>
                <Chip tone={lastNight.won ? "moss" : "ember"}>{lastNight.won ? "dawn" : "lanterns out"}</Chip>
              </div>
            </div>
          )}
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber/20 bg-[radial-gradient(ellipse_at_top_right,_rgba(215,163,95,0.14),_transparent_60%)] p-5 sm:p-7">
          <div className="absolute -right-9 -top-9 h-32 w-32 rounded-full border border-amber/10" aria-hidden />
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full border border-amber/10" aria-hidden />
          <Kicker>The solo night</Kicker>
          <h2 className="mt-3 font-serif text-[28px] leading-tight text-parchment sm:text-[34px]">
            Four wards. One Hollow.
            <span className="block italic text-amber-bright">Nobody to blame but the evidence.</span>
          </h2>
          <p className="mt-2 text-[11.5px] leading-relaxed text-parchment-dim">
            A complete singleplayer night, dealt fresh each time. Finish every ward, gather the clues the dark leaves,
            report what the lane cannot bury, and name the neighbour who came home wrong.
          </p>
          <div className="mt-4 flex items-center gap-1.5">
            {SUSPECTS.map((suspect) => (
              <div key={suspect.id} className="relative -ml-2 first:ml-0">
                <Portrait initials={suspect.initials} colour={suspect.colour} size="sm" />
              </div>
            ))}
            <span className="ml-2 font-mono text-[8px] uppercase tracking-[0.12em] text-ash">4 neighbours · 1 lie</span>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={() => go("night")} className="w-full py-3.5 text-[10px]">
              <Moon className="h-3.5 w-3.5" /> Deal the night
            </Button>
            <button type="button" onClick={() => go("tutorial")} className="w-full rounded-full border border-parchment/15 py-2.5 font-mono text-[8px] uppercase tracking-[0.14em] text-parchment-dim transition hover:border-amber/40 hover:text-amber">
              Or learn the lane first
            </button>
          </div>
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-2xl border border-parchment/12 bg-[linear-gradient(120deg,_#121a14,#0a0f0b_60%,_#1b1710)] p-6 sm:p-9">
        <div className="absolute right-0 top-0 h-full w-[45%] bg-[radial-gradient(ellipse_at_right,_rgba(215,163,95,0.13),_transparent_65%)]" aria-hidden />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-[520px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber/25 px-2.5 py-1 font-mono text-[7.5px] uppercase tracking-[0.16em] text-amber">
              <Sun className="h-2.5 w-2.5" /> Morning is a choice
            </div>
            <h2 className="mt-3 font-serif text-[32px] leading-[1.03] text-parchment sm:text-[40px]">
              The lantern is lit.
              <span className="block italic text-amber-bright">The creek is waiting.</span>
            </h2>
            <p className="mt-2 max-w-[430px] text-[12px] leading-relaxed text-parchment-dim">
              You do not need a friend, a lobby, or an account. You need the eight quiet minutes it takes to learn what
              the dark is for.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:min-w-[200px]">
            <Button onClick={() => go("tutorial")} className="py-4 text-[10px]">
              <Play className="h-3.5 w-3.5 fill-current" /> Begin the first night
            </Button>
            <Button variant="secondary" onClick={() => go("night")} className="py-3.5 text-[9.5px]">
              Skip ahead to a night <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </section>

      <div className="mt-10 flex flex-col items-center gap-2">
        <Ornament />
        <p className="max-w-[560px] text-center font-serif text-[14px] italic leading-relaxed text-parchment-dim/80">
          &ldquo;A town is a stitch. Pull one loose and the whole hem goes.&rdquo;
          <span className="mt-1 block font-sans text-[8px] not-italic uppercase tracking-[0.16em] text-ash/60">
            Hester Finch, the seamstress · Hollow Creek
          </span>
        </p>
      </div>
    </div>
  );
}

function MapPin({ className }: { className?: string }) {
  return <CircleDot className={className} aria-hidden />;
}

function Stamp() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 2" />
      <path d="M8 3.5v5l3 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
