import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Eye,
  Feather,
  Flame,
  Footprints,
  Ghost,
  Info,
  Lock,
  Moon,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  CLUES,
  SUSPECTS,
  WARDS,
  dealNight,
  formatTime,
  randomOf,
  shuffled,
  type Clue,
  type MinigameId,
  type NightRecord,
  type Suspect,
} from "../lib/game";
import { sfx } from "../lib/audio";
import { Button, Chip, Kicker, Modal, Ornament, Portrait, ProgressRing, WardIcon } from "./ui";
import { MinigameModal } from "./Minigames";

type NightPhase = "setup" | "street" | "accuse" | "dawn";

interface NightState {
  culprit: Suspect;
  victim: string;
  clueForWard: Record<MinigameId, Clue>;
}

const STAGGER = ["The lane is holding its breath.", "Somewhere, a gate is left open.", "The moon has moved. You have not."];

function pickId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export function NightGame({
  name,
  onName,
  tutorialDone,
  onRecord,
  onSeal,
  onExit,
  onTutorial,
  onBestiary,
}: {
  name: string;
  onName: (value: string) => void;
  tutorialDone: boolean;
  onRecord: (record: NightRecord) => void;
  onSeal: (ids: MinigameId[]) => void;
  onExit: () => void;
  onTutorial: () => void;
  onBestiary: () => void;
}) {
  const [phase, setPhase] = useState<NightPhase>("setup");
  const [draft, setDraft] = useState(name);
  const [night, setNight] = useState<NightState | null>(null);
  const [solved, setSolved] = useState<MinigameId[]>([]);
  const [collected, setCollected] = useState<Clue[]>([]);
  const [activeGame, setActiveGame] = useState<MinigameId | null>(null);
  const [showBody, setShowBody] = useState(false);
  const [bodyReported, setBodyReported] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [guess, setGuess] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ won: boolean; accused: Suspect } | null>(null);
  const recorded = useRef(false);

  useEffect(() => {
    if (phase !== "street") return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const begin = () => {
    const clean = draft.trim() || "Wren";
    onName(clean);
    const dealt = dealNight();
    const order = shuffled(WARDS.map((ward) => ward.id));
    const clueForWard = {} as Record<MinigameId, Clue>;
    order.forEach((id, index) => {
      clueForWard[id] = dealt.clues[index] ?? randomOf(CLUES);
    });
    setNight({ culprit: dealt.culprit, victim: dealt.victim, clueForWard });
    setSolved([]);
    setCollected([]);
    setActiveGame(null);
    setShowBody(false);
    setBodyReported(false);
    setGuess(null);
    setVerdict(null);
    setElapsed(0);
    recorded.current = false;
    setPhase("street");
    sfx("bell");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openWard = (id: MinigameId) => {
    if (solved.includes(id) || showBody) return;
    sfx("click");
    setActiveGame(id);
  };

  const wardSolved = () => {
    if (!activeGame || !night) return;
    const game = activeGame;
    setActiveGame(null);
    if (solved.includes(game)) return;
    const nextSolved = [...solved, game];
    const clue = night.clueForWard[game];
    setSolved(nextSolved);
    setCollected((current) => [...current, clue]);
    onSeal([game]);
    sfx("seal");
    // The second ward uncovers the body. Open the report at once so it can
    // never be buried beneath the next ward's dialog.
    if (nextSolved.length >= 2 && !bodyReported) {
      setShowBody(true);
    }
  };

  const report = () => {
    setBodyReported(true);
    setShowBody(false);
    sfx("bell");
  };

  const conclude = (id: string) => {
    if (!night || recorded.current) return;
    const accused = SUSPECTS.find((suspect) => suspect.id === id) ?? SUSPECTS[0];
    const won = accused.id === night.culprit.id;
    setGuess(id);
    setVerdict({ won, accused });
    setPhase("dawn");
    recorded.current = true;
    sfx(won ? "seal" : "error");
    onRecord({
      id: pickId(),
      date: new Date().toISOString(),
      name: draft.trim() || name || "Wren",
      culprit: night.culprit.name,
      accused: accused.name,
      won,
      wards: solved.length,
      seconds: elapsed,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const allDone = solved.length === WARDS.length;
  const readyToAccuse = allDone && bodyReported;
  const randomSeat = useMemo(() => (night ? SUSPECTS.findIndex((suspect) => suspect.id === night.culprit.id) + 1 : 0), [night]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 pt-5 sm:px-7 lg:px-9 lg:pt-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker>A night alone · singleplayer</Kicker>
          <h1 className="mt-2 font-serif text-[27px] leading-tight text-parchment sm:text-[34px]">
            {phase === "setup" ? "The creek will deal you in." : phase === "dawn" ? "Morning, at last." : "One street. Four wards. One Hollow."}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {tutorialDone ? (
            <Chip tone="moss"><Check className="h-2.5 w-2.5" /> first night complete</Chip>
          ) : (
            <button
              type="button"
              onClick={onTutorial}
              className="inline-flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.13em] text-amber transition hover:text-amber-bright"
            >
              <Info className="h-3 w-3" /> New here? Take the tutorial
            </button>
          )}
        </div>
      </div>

      {phase === "setup" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
          <div className="relative overflow-hidden rounded-2xl border border-parchment/12">
            <img
              src="/images/hollow-creek.jpg"
              alt="Hollow Creek at night, a long lane under a harvest moon"
              className="absolute inset-0 h-full w-full object-cover object-[55%_60%] opacity-60"
            />
            <div className="absolute inset-0 bg-[linear-gradient(110deg,_#0a0f0b_12%,_rgba(10,15,11,0.78)_48%,_rgba(10,15,11,0.2)_100%)]" aria-hidden />
            <div className="relative p-5 sm:p-8">
              <span className="inline-flex items-center gap-2 rounded-full border border-amber/30 bg-[#0b100c]/75 px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-amber backdrop-blur">
                <Moon className="h-3 w-3" /> Night trial · solo
              </span>
              <h2 className="mt-5 max-w-[440px] font-serif text-[34px] leading-[1.02] text-parchment sm:text-[46px]">
                Not everyone who came home
                <span className="block italic text-amber-bright">was people.</span>
              </h2>
              <p className="mt-3 max-w-[390px] text-[12.5px] leading-relaxed text-parchment-dim">
                Four wards keep the creek alive. One neighbour is Hollow. Work the new ward games, read what the night
                leaves behind, and name the thing wearing a familiar face.
              </p>

              <div className="mt-5 grid max-w-[440px] gap-2 sm:grid-cols-2">
                {[
                  { icon: Flame, title: "Four ward games", text: "Real puzzles, not progress bars." },
                  { icon: Eye, title: "One decisive clue", text: "Every finished ward shows you something." },
                  { icon: Bell, title: "Report the body", text: "Look first. The bell can wait." },
                  { icon: Lock, title: "The cage", text: "Name the Hollow. Or wear the consequence." },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-2.5 rounded-lg border border-parchment/10 bg-[#0b100c]/60 p-2.5 backdrop-blur">
                    <item.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" strokeWidth={1.5} />
                    <div>
                      <div className="text-[11px] font-medium text-parchment">{item.title}</div>
                      <div className="text-[10px] leading-snug text-ash">{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 max-w-[440px] rounded-xl border border-parchment/15 bg-[#0b100c]/75 p-4 backdrop-blur">
                <label htmlFor="night-name" className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash">
                  Sign the ledger as
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="night-name"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, 18))}
                    placeholder="Wren"
                    className="w-full border-b border-parchment/25 bg-transparent pb-2 font-serif text-xl text-parchment outline-none placeholder:text-ash/40 focus:border-amber"
                  />
                  <Button onClick={begin} className="shrink-0 py-3 text-[10px]">
                    Deal the night <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-ash">
                  <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber/70" />
                  The Hollow is drawn uniformly at random from the four neighbours. No account, no server, no peeking.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-parchment/10 bg-[#0d130f]/80 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-ash">Tonight&apos;s wards</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.13em] text-amber">4 games</span>
              </div>
              <div className="mt-3 space-y-2">
                {WARDS.map((ward, index) => (
                  <div key={ward.id} className="flex items-center gap-2.5 rounded-lg border border-parchment/[0.08] bg-parchment/[0.02] p-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-parchment/12 text-amber/80">
                      <WardIcon id={ward.id} className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11.5px] font-medium text-parchment">{ward.game}</div>
                      <div className="truncate font-mono text-[7.5px] uppercase tracking-[0.11em] text-ash">
                        {String(index + 1).padStart(2, "0")} · {ward.station}
                      </div>
                    </div>
                    <Chip className="shrink-0 px-1.5 py-0.5">{ward.difficulty}</Chip>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-amber/20 bg-amber/[0.04] p-4">
              <div className="flex items-center gap-2">
                <Feather className="h-3.5 w-3.5 text-amber" />
                <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-amber">The field rule</span>
              </div>
              <p className="mt-2 font-serif text-[14px] italic leading-relaxed text-parchment-dim">
                &ldquo;The Hollow can lie about its name. It cannot lie about its hands.&rdquo;
              </p>
              <button
                type="button"
                onClick={onBestiary}
                className="mt-2 inline-flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.13em] text-amber transition hover:text-amber-bright"
              >
                Meet the Gloamwing <ChevronRight className="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "street" && night && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
          <div className="min-w-0 space-y-4">
            <div className="relative overflow-hidden rounded-2xl border border-parchment/12">
              <img
                src="/images/hollow-creek.jpg"
                alt="The lane at Hollow Creek after dark"
                className="absolute inset-0 h-full w-full object-cover object-[50%_56%] opacity-75"
              />
              <div className="relative h-[240px] sm:h-[190px]" aria-hidden />
              <div className="absolute inset-0 bg-gradient-to-t from-[#080c09] via-[#080c09]/25 to-[#080c09]/60" aria-hidden />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 sm:p-4">
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-parchment/20 bg-[#080c09]/65 px-2.5 py-1 font-mono text-[7.5px] uppercase tracking-[0.12em] text-parchment-dim backdrop-blur">
                  <MapPinDot /> <span className="truncate">Callow Lane</span>
                  <span className="hidden text-ash/60 sm:inline">· after eleven</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-parchment/20 bg-[#080c09]/65 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-parchment-dim backdrop-blur">
                  <Clock className="h-3 w-3 text-amber" /> {formatTime(elapsed)}
                </span>
              </div>
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-2.5 p-3 sm:gap-3 sm:p-4">
                <div className="min-w-0">
                  <div className="font-mono text-[7.5px] uppercase tracking-[0.15em] text-amber">Your lantern finds</div>
                  <div className="font-serif text-[20px] leading-tight text-parchment sm:text-[27px]">
                    {allDone ? "The lane is yours." : `${solved.length} of 4 wards restored`}
                  </div>
                  <div className="mt-1 flex gap-1">
                    {WARDS.map((ward) => (
                      <span
                        key={ward.id}
                        className={cn(
                          "h-1.5 rounded-full transition-all",
                          solved.includes(ward.id) ? "w-8 bg-amber" : "w-4 bg-parchment/20",
                        )}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-parchment/12 bg-[#080c09]/65 px-2.5 py-1.5 backdrop-blur sm:px-3 sm:py-2">
                  <ProgressRing value={solved.length} total={4} size={36} />
                  <div>
                    <div className="font-mono text-[6.5px] uppercase tracking-[0.12em] text-ash">The cage waits</div>
                    <div className="text-[10px] text-parchment-dim sm:text-[11px]">
                      {solved.length < 4 ? "Finish every ward" : bodyReported ? "The square is ready" : "Report the body"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {WARDS.map((ward, index) => {
                const done = solved.includes(ward.id);
                const isActive = activeGame === ward.id;
                return (
                  <div
                    key={ward.id}
                    className={cn(
                      "group relative overflow-hidden rounded-xl border p-4 transition-colors",
                      done
                        ? "border-moss/25 bg-[#101710]/80"
                        : "border-parchment/12 bg-[#0d130f]/80 hover:border-amber/30",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-lg border font-serif text-base",
                            done ? "border-moss/40 bg-moss/10 text-[#b0c4b1]" : "border-amber/25 bg-amber/[0.07] text-amber",
                          )}
                          style={{ boxShadow: done ? undefined : `0 0 30px -18px ${ward.accent}` }}
                        >
                          {done ? <Check className="h-4 w-4" /> : <WardIcon id={ward.id} />}
                        </span>
                        <div>
                          <div className="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ash">
                            Ward {String(index + 1).padStart(2, "0")} · {ward.station}
                          </div>
                          <div className="mt-0.5 text-[13px] font-medium leading-tight text-parchment">{ward.title}</div>
                          <div className="mt-1 font-serif text-[12px] italic text-amber/80">{ward.game}</div>
                        </div>
                      </div>
                      {!done && <Chip className="hidden shrink-0 sm:inline-flex">{ward.difficulty}</Chip>}
                    </div>
                    <p className="mt-2.5 line-clamp-2 text-[10.5px] leading-relaxed text-ash">
                      {done ? "The ward is sealed. Whatever waited here has been persuaded to wait elsewhere." : ward.blurb}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="font-mono text-[7.5px] uppercase tracking-[0.12em] text-ash/70">
                        {done ? "clue recorded" : ward.duration}
                      </span>
                      <button
                        type="button"
                        onClick={() => openWard(ward.id)}
                        disabled={done || isActive}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.12em] transition-all",
                          done
                            ? "border-transparent text-moss/60"
                            : "border-parchment/20 text-parchment hover:border-amber/50 hover:bg-amber/10 hover:text-amber-bright",
                        )}
                      >
                        {done ? <><Check className="h-2.5 w-2.5" /> sealed</> : <>Work <ArrowRight className="h-2.5 w-2.5" /></>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-parchment/10 bg-[#0c120e]/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-amber">The square</div>
                  <div className="mt-0.5 font-serif text-lg leading-tight text-parchment">
                    {readyToAccuse ? "Four wards done. One question left." : "Finish what the night has given you."}
                  </div>
                </div>
                <Button
                  onClick={() => setPhase("accuse")}
                  disabled={!readyToAccuse}
                  className="py-3 text-[10px]"
                >
                  <Users className="h-3.5 w-3.5" /> {readyToAccuse ? "Call the square" : "Not enough evidence"}
                </Button>
              </div>
              {!allDone && (
                <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ash">
                  <Info className="h-3 w-3" /> Every finished ward earns one clue. Every clue narrows the field.
                </p>
              )}
              {allDone && !bodyReported && (
                <button
                  type="button"
                  onClick={() => setShowBody(true)}
                  className="mt-2 flex items-center gap-1.5 text-[10.5px] text-amber transition hover:text-amber-bright"
                >
                  <Bell className="h-3 w-3" /> A body is still waiting in the lane. Report it before you accuse.
                </button>
              )}
            </div>
          </div>

          <aside className="min-w-0 space-y-3">
            <div className="rounded-xl border border-parchment/10 bg-[#0d130f]/85 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">Evidence</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-amber">{collected.length} read</span>
              </div>
              <div className="mt-3 space-y-2">
                {collected.length === 0 && (
                  <div className="rounded-lg border border-dashed border-parchment/15 p-3.5 text-center">
                    <Search className="mx-auto h-4 w-4 text-ash/60" />
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-ash">
                      Seal a ward to find what the Hollow left behind.
                    </p>
                  </div>
                )}
                {collected.map((clue, index) => (
                  <div key={`${clue.id}-${index}`} className="rounded-lg border border-amber/20 bg-amber/[0.045] p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 font-mono text-[8px] text-amber">{String(index + 1).padStart(2, "0")}</span>
                      <p className="text-[10.5px] leading-relaxed text-parchment-dim">{clue.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              {bodyReported && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-ember/25 bg-ember/[0.06] px-2.5 py-2">
                  <Bell className="h-3 w-3 text-[#e6a283]" />
                  <span className="text-[10px] text-[#e4b49d]">Report filed. The town remembers.</span>
                </div>
              )}
              {!bodyReported && (
                <button
                  type="button"
                  onClick={() => setShowBody(true)}
                  disabled={solved.length < 2}
                  className={cn(
                    "mt-2 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition",
                    solved.length >= 2
                      ? "border-ember/35 bg-ember/[0.08] hover:border-ember/60"
                      : "border-parchment/10 bg-parchment/[0.02] opacity-55",
                  )}
                >
                  <Bell className={cn("h-3 w-3 shrink-0", solved.length >= 2 ? "text-[#e6a283]" : "text-ash")} />
                  <span className="text-[10px] leading-snug text-parchment-dim">
                    {solved.length >= 2 ? "A body waits in the lane. Report it." : "The lane is quiet. For now."}
                  </span>
                </button>
              )}
            </div>

            <div className="rounded-xl border border-parchment/10 bg-[#0d130f]/85 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">Neighbours</span>
                <Users className="h-3 w-3 text-ash/60" />
              </div>
              <div className="mt-2.5 divide-y divide-parchment/[0.07]">
                {SUSPECTS.map((suspect) => (
                  <div key={suspect.id} className="flex items-center gap-2.5 py-2">
                    <Portrait initials={suspect.initials} colour={suspect.colour} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-parchment">{suspect.name}</div>
                      <div className="truncate font-mono text-[7.5px] uppercase tracking-[0.1em] text-ash">{suspect.role}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 border-t border-parchment/[0.07] pt-2 text-[9.5px] leading-relaxed text-ash">
                Watch a ward is not a vote. Hover a neighbour in the square to read their tell.
              </p>
            </div>

            <div className="rounded-lg border border-amber/15 bg-[#0b100c] p-3">
              <div className="flex items-start gap-2">
                <Feather className="mt-0.5 h-3 w-3 shrink-0 text-amber" />
                <p className="text-[10.5px] italic leading-relaxed text-parchment-dim">{randomOf(STAGGER)}</p>
              </div>
            </div>
          </aside>
        </div>
      )}

      {phase === "accuse" && night && (
        <div className="rounded-2xl border border-amber/25 bg-[url('/images/hollow-creek.jpg')] bg-cover bg-[position:50%_70%]">
          <div className="rounded-2xl bg-[linear-gradient(180deg,_rgba(8,12,9,0.86),_rgba(8,12,9,0.97))] p-5 sm:p-7">
            <div className="flex flex-col gap-3 border-b border-parchment/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">The square · one question</span>
                <h2 className="mt-1 font-serif text-[28px] leading-tight text-parchment sm:text-[36px]">
                  Who came home wrong?
                </h2>
                <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-parchment-dim">
                  The town has gathered. Silas rings the bell. The cage stands open in the moonlight. You have{" "}
                  {collected.length} clues and no second chance.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Chip tone="amber"><Flame className="h-2.5 w-2.5" /> {solved.length} wards</Chip>
                <Chip tone={bodyReported ? "moss" : "ember"}>{bodyReported ? "body reported" : "body unreported"}</Chip>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash">Who do you name?</span>
                  <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-amber">choose carefully</span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {SUSPECTS.map((suspect) => (
                    <button
                      key={suspect.id}
                      type="button"
                      onClick={() => { setGuess(suspect.id); sfx("click"); }}
                      className={cn(
                        "rounded-xl border p-3.5 text-left transition-all",
                        guess === suspect.id
                          ? "border-amber/60 bg-amber/[0.09] shadow-[0_0_30px_-18px_rgba(215,163,95,0.9)]"
                          : "border-parchment/12 bg-parchment/[0.03] hover:border-parchment/25",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <Portrait initials={suspect.initials} colour={suspect.colour} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12.5px] font-medium text-parchment">{suspect.name}</span>
                            {guess === suspect.id && <Check className="h-3.5 w-3.5 text-amber" />}
                          </div>
                          <div className="font-mono text-[7.5px] uppercase tracking-[0.11em] text-ash">{suspect.role}</div>
                          <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-parchment-dim">{suspect.tell}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-parchment/10 bg-parchment/[0.025] p-4">
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash">What the lane said</div>
                  <ol className="mt-2 space-y-2">
                    {collected.map((clue, index) => (
                      <li key={`${clue.id}-accuse-${index}`} className="flex items-start gap-2 text-[10.5px] leading-relaxed text-parchment-dim">
                        <span className="mt-0.5 font-mono text-[8px] text-amber">{index + 1}</span>
                        {clue.text}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => guess && conclude(guess)} disabled={!guess} className="w-full py-3.5 text-[10px]">
                    <Lock className="h-3.5 w-3.5" /> Put the question
                  </Button>
                  <Button variant="ghost" onClick={() => setPhase("street")} className="w-full justify-center py-2 text-[10px]">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back to the lane
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "dawn" && night && verdict && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl border p-6 sm:p-8",
              verdict.won ? "border-amber/35 bg-[radial-gradient(ellipse_at_top,_rgba(215,163,95,0.16),_transparent_65%)]" : "border-ember/30 bg-[radial-gradient(ellipse_at_top,_rgba(184,102,63,0.14),_transparent_65%)]",
            )}
          >
            <div className="flex items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.2em] text-amber">
              {verdict.won ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              Dawn · the ledger closes
            </div>
            <h2 className="mt-3 max-w-[520px] font-serif text-[34px] leading-[1.03] text-parchment sm:text-[46px]">
              {verdict.won ? "The town breathes." : "The town does not."}
            </h2>
            <p className="mt-3 max-w-[500px] text-[12.5px] leading-relaxed text-parchment-dim">
              {verdict.won
                ? `You named ${night.culprit.name}. The iron cage closes, and for the first time since the bell rang, the lane sounds like a street and not a held breath.`
                : `You named ${verdict.accused.name}. The cage opens on empty air. ${night.culprit.name} smiles from the back of the crowd — and the lanterns go out one by one.`}
            </p>

            <div className="mt-6 rounded-xl border border-parchment/12 bg-[#0b100c]/70 p-4">
              <div className="flex items-start gap-3">
                <Portrait
                  initials={night.culprit.initials}
                  colour={night.culprit.colour}
                  size="lg"
                  hollow
                />
                <div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.17em] text-amber">The Hollow was</div>
                  <div className="mt-0.5 font-serif text-2xl leading-tight text-parchment">{night.culprit.name}</div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-ash">{night.culprit.role}</div>
                  <p className="mt-2 max-w-[420px] text-[11px] leading-relaxed text-parchment-dim">{night.culprit.tell}</p>
                </div>
              </div>
              <p className="mt-3 border-t border-parchment/10 pt-3 font-serif text-[14px] italic leading-relaxed text-parchment-dim">
                &ldquo;{night.culprit.quote}&rdquo;
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Wards", value: `${solved.length}/4` },
                { label: "Clues", value: `${collected.length}` },
                { label: "Night length", value: formatTime(elapsed) },
                { label: "Outcome", value: verdict.won ? "Crew win" : "Hollow win" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-parchment/10 bg-parchment/[0.025] p-2.5">
                  <div className="font-serif text-lg text-parchment">{item.value}</div>
                  <div className="font-mono text-[7px] uppercase tracking-[0.12em] text-ash">{item.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button onClick={begin} className="py-3 text-[10px]">
                <RotateCcw className="h-3.5 w-3.5" /> Deal another night
              </Button>
              <Button variant="secondary" onClick={onExit} className="py-3 text-[10px]">
                Back to the creek
              </Button>
              <Button variant="ghost" onClick={onBestiary} className="py-3 text-[10px]">
                <BookOpen className="h-3.5 w-3.5" /> Read the field guide
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-parchment/12 bg-[#0b100c]">
              <img src="/images/gloamwing.jpg" alt="The Gloamwing" className="h-[180px] w-full object-cover" />
              <div className="p-4">
                <div className="font-mono text-[7.5px] uppercase tracking-[0.18em] text-amber">Witness note</div>
                <p className="mt-1.5 font-serif text-[14px] italic leading-relaxed text-parchment-dim">
                  {verdict.won
                    ? "The moth settles on the cage and drinks the last of the candle smoke. It has your name now. It will keep it clean."
                    : "The moth does not follow you home. Some ledgers are written in a colder ink than others."}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-parchment/10 bg-[#0d130f]/80 p-4">
              <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash">The deal, in the open</div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-ash">
                The culprit was drawn uniformly at random from four neighbours (seat {randomSeat} of 4) before the
                first ward. In the multiplayer creek, roles are dealt with a cryptographic Fisher–Yates shuffle and
                tests prove every seat is equally likely.
              </p>
            </div>
          </div>
        </div>
      )}

      <Modal open={showBody} onClose={() => setShowBody(false)} label="A body in the lane">
        <div className="relative overflow-hidden">
          <div className="relative border-b border-parchment/10 bg-[#0c110d] p-5 sm:p-6">
            <div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(ellipse_at_right,_rgba(184,102,63,0.16),_transparent_70%)]" aria-hidden />
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ember/35 bg-ember/10 text-[#e6a283]">
                <Ghost className="h-5 w-5" strokeWidth={1.5} />
              </span>
              <div>
                <div className="font-mono text-[8px] uppercase tracking-[0.17em] text-[#e6a283]">In the lane · after the second ward</div>
                <h2 className="mt-1 font-serif text-2xl text-parchment sm:text-3xl">A body in the bracken.</h2>
                <p className="mt-1.5 max-w-[420px] text-[11.5px] leading-relaxed text-parchment-dim">
                  {night?.victim ?? "A neighbour"} will not see the morning. The body is cold at the edges and warm at
                  the middle, which is a thing the Gloamwing refuses to explain.
                </p>
              </div>
            </div>
          </div>
          <div className="p-5 sm:p-6">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-lg border border-parchment/10 bg-parchment/[0.02] p-3">
                <div className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.13em] text-ash">
                  <Footprints className="h-3 w-3" /> What the lane says
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-parchment-dim">
                  One set of prints leads away, upright and unhurried. The Hollow did not run.
                </p>
              </div>
              <div className="rounded-lg border border-parchment/10 bg-parchment/[0.02] p-3">
                <div className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.13em] text-ash">
                  <Bell className="h-3 w-3" /> The rule
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-parchment-dim">
                  Reporting is not a vote. It calls the town to the square so that no one hides a question in a corner.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setShowBody(false)} className="text-[10px]">Not yet</Button>
              <Button onClick={report} className="py-3 text-[10px]">
                <Bell className="h-3.5 w-3.5" /> Report the body
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <MinigameModal
        key={`night-${activeGame ?? "none"}-${solved.length}`}
        game={activeGame}
        mode="night"
        onClose={() => setActiveGame(null)}
        onSolved={wardSolved}
      />

      <div className="mt-7 flex items-center justify-center"><Ornament /></div>
    </div>
  );
}

function MapPinDot() {
  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      <span className="absolute h-2 w-2 animate-ping rounded-full bg-amber/50" />
      <span className="h-1 w-1 rounded-full bg-amber" />
    </span>
  );
}
