import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bird,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Flame,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { cn } from "../utils/cn";
import { getWard, type MinigameId } from "../lib/game";
import { sfx } from "../lib/audio";
import { Button, Chip, Modal, WardIcon } from "./ui";

interface GameProps {
  onWin: () => void;
}

/* ------------------------------------------------------------------ */
/* 1. LANTERN RITES                                                    */
/* ------------------------------------------------------------------ */

const RING_GLYPHS = ["✦", "☾", "◈", "✧", "◉", "❖", "☉", "⌁"];

function LanternRites({ onWin }: GameProps) {
  const [rings, setRings] = useState<[number, number, number]>(() => {
    const draw = () => 1 + Math.floor(Math.random() * 7);
    return [draw(), draw(), draw()];
  });
  const [turns, setTurns] = useState(0);
  const scored = useRef(false);
  const aligned = rings[0] === 0 && rings[1] === 0 && rings[2] === 0;

  useEffect(() => {
    if (!aligned || scored.current) return;
    scored.current = true;
    sfx("seal");
    const timer = window.setTimeout(onWin, 650);
    return () => window.clearTimeout(timer);
  }, [aligned, onWin]);

  const turn = (index: number, direction: number) => {
    if (aligned) return;
    sfx("click");
    setTurns((turns) => turns + 1);
    setRings((current) => {
      const next: [number, number, number] = [...current];
      next[index] = (next[index] + direction + 8) % 8;
      return next;
    });
  };

  return (
    <div>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_230px] sm:items-center">
        <div className="relative mx-auto w-full max-w-[340px]">
          <div className="absolute inset-8 rounded-full bg-amber/10 blur-3xl" aria-hidden />
          <svg viewBox="0 0 300 300" className="relative w-full" role="img" aria-label="Three brass rings around a lantern wick">
            <defs>
              <radialGradient id="lr-core" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#f5d7a0" stopOpacity="0.95" />
                <stop offset="55%" stopColor="#d7a35f" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#d7a35f" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="150" cy="150" r="132" fill="none" stroke="#efe6cf" strokeOpacity="0.08" />
            <g opacity="0.55">
              {Array.from({ length: 24 }).map((_, i) => {
                const angle = (i / 24) * Math.PI * 2;
                return (
                  <line
                    key={i}
                    x1={150 + Math.cos(angle) * 138}
                    y1={150 + Math.sin(angle) * 138}
                    x2={150 + Math.cos(angle) * 145}
                    y2={150 + Math.sin(angle) * 145}
                    stroke="#d7a35f"
                    strokeOpacity={i % 2 === 0 ? 0.6 : 0.25}
                    strokeWidth="1"
                  />
                );
              })}
            </g>
            {[120, 90, 60].map((radius, ringIndex) => {
              const angle = ((rings[ringIndex] * 45 - 90) * Math.PI) / 180;
              const x = 150 + Math.cos(angle) * radius;
              const y = 150 + Math.sin(angle) * radius;
              return (
                <g
                  key={radius}
                  className="cursor-pointer"
                  onClick={() => turn(ringIndex, 1)}
                  role="presentation"
                >
                  <circle
                    cx="150"
                    cy="150"
                    r={radius}
                    fill="none"
                    stroke={rings[ringIndex] === 0 ? "#e6c184" : "#b7ab93"}
                    strokeOpacity={rings[ringIndex] === 0 ? 0.9 : 0.4}
                    strokeWidth={ringIndex === 1 ? 7 : 6}
                    strokeDasharray={ringIndex === 1 ? "18 5" : "3 12"}
                    strokeLinecap="round"
                    className="transition-all duration-300"
                  />
                  <circle
                    cx={150 + Math.cos(angle) * radius}
                    cy={150 + Math.sin(angle) * radius}
                    r="15"
                    fill="#0e130f"
                    stroke={rings[ringIndex] === 0 ? "#f0c784" : "#d7a35f"}
                    strokeOpacity={rings[ringIndex] === 0 ? 1 : 0.7}
                    strokeWidth="1"
                    className="transition-all duration-300"
                  />
                  <text
                    x={x}
                    y={y + 4.5}
                    textAnchor="middle"
                    fill={rings[ringIndex] === 0 ? "#f4d8a8" : "#b7ab93"}
                    fontSize="13"
                    fontFamily="Georgia, serif"
                  >
                    {RING_GLYPHS[rings[ringIndex]]}
                  </text>
                  <text x="150" y={150 - radius + 23} textAnchor="middle" fill="#8d9387" fontSize="6.5" letterSpacing="1.6">
                    {ringIndex === 0 ? "INNER" : ringIndex === 1 ? "MIDDLE" : "OUTER"}
                  </text>
                </g>
              );
            })}
            <circle cx="150" cy="150" r="45" fill="url(#lr-core)" />
            <path d="M150 150V22" stroke="#d7a35f" strokeOpacity="0.55" strokeDasharray="2 4" strokeWidth="1" />
            <path d="M150 32l5 8h-10l5-8Z" fill="#e5ac5f" fillOpacity="0.8" />
            <g transform="translate(150 150)">
              <rect x="-12" y="-20" width="24" height="38" rx="3" fill="#101611" stroke="#cfc2a8" strokeOpacity="0.6" />
              <path d="M-6 -8h12v18H-6z" fill="#e5ac5f" fillOpacity="0.35" />
              <path d="M0 -16c4 6 4 10 0 15-4-5-4-9 0-15Z" fill="#f4d7a1" />
            </g>
            <text x="150" y="284" textAnchor="middle" fill="#8d9387" fontSize="7" letterSpacing="2" fontFamily="monospace">
              THE WICK REMEMBERS
            </text>
          </svg>
          {aligned && (
            <div className="pointer-events-none absolute inset-0 rounded-full bg-amber/10 blur-2xl" aria-hidden />
          )}
        </div>

        <div className="space-y-2.5">
          <p className="mb-3 font-mono text-[8.5px] uppercase tracking-[0.18em] text-ash">
            Bring all three notches to the wick
          </p>
          {(["Inner", "Middle", "Outer"] as const).map((label, index) => (
            <div
              key={label}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2 transition-colors",
                rings[index] === 0 ? "border-amber/40 bg-amber/[0.07]" : "border-parchment/10 bg-parchment/[0.025]",
              )}
            >
              <div>
                <div className="text-[12px] font-medium text-parchment">{label} band</div>
                <div className="font-mono text-[8px] uppercase tracking-[0.13em] text-ash">
                  {rings[index] === 0 ? "At the wick" : `${rings[index]} of 8 turns away`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => turn(index, -1)}
                  className="grid h-7 w-7 place-items-center rounded-md border border-parchment/12 text-parchment-dim transition hover:border-amber/40 hover:text-amber"
                  aria-label={`Turn ${label.toLowerCase()} band anticlockwise`}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => turn(index, 1)}
                  className="grid h-7 w-7 place-items-center rounded-md border border-parchment/12 text-parchment-dim transition hover:border-amber/40 hover:text-amber"
                  aria-label={`Turn ${label.toLowerCase()} band clockwise`}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 font-mono text-[8px] uppercase tracking-[0.13em] text-ash/70">
            <span>{turns} turns taken</span>
            <span className="inline-flex items-center gap-1">
              <Check className="h-2.5 w-2.5" /> click a band to turn it
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. THE LONG DRAW                                                    */
/* ------------------------------------------------------------------ */

function TheLongDraw({ onWin }: GameProps) {
  const [position, setPosition] = useState(22);
  const [target, setTarget] = useState(() => 28 + Math.random() * 40);
  const [draws, setDraws] = useState(0);
  const [misses, setMisses] = useState(0);
  const [lost, setLost] = useState(false);
  const direction = useRef(1);
  const lostRef = useRef(false);
  const wonRef = useRef(false);
  const width = 20 - draws * 2;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (lostRef.current || wonRef.current) return;
      setPosition((current) => {
        let next = current + direction.current * 1.9;
        if (next >= 100) {
          next = 100;
          direction.current = -1;
        }
        if (next <= 0) {
          next = 0;
          direction.current = 1;
        }
        return next;
      });
    }, 34);
    return () => window.clearInterval(timer);
  }, []);

  const caught = Math.abs(position - target) <= width / 2;

  const draw = () => {
    if (lost || draws >= 3) return;
    if (caught) {
      const next = draws + 1;
      sfx("chime");
      setDraws(next);
      setTarget(20 + Math.random() * 60);
      if (next >= 3) {
        wonRef.current = true;
        window.setTimeout(onWin, 550);
      }
    } else {
      sfx("error");
      const next = misses + 1;
      setMisses(next);
      if (next >= 4) {
        lostRef.current = true;
        setLost(true);
      }
    }
  };

  const retry = () => {
    setDraws(0);
    setMisses(0);
    setLost(false);
    lostRef.current = false;
    direction.current = 1;
    setPosition(18);
    setTarget(25 + Math.random() * 45);
  };

  return (
    <div>
      <div className="grid gap-6 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
        <div className="relative mx-auto h-[250px] w-[150px]">
          <div className="absolute left-1/2 top-0 h-full w-[62px] -translate-x-1/2 rounded-t-[31px] rounded-b-[8px] border border-parchment/15 bg-gradient-to-b from-[#111812] via-[#0d130e] to-[#0a0e0b] shadow-inner" />
          <div
            className="absolute left-1/2 w-[46px] -translate-x-1/2 rounded-sm border border-amber/30 bg-gradient-to-b from-amber/20 to-amber/[0.04]"
            style={{ bottom: `${target - width / 2}%`, height: `${width}%` }}
          >
            <div className="absolute -right-2 top-1/2 h-px w-2 -translate-y-1/2 bg-amber/60" />
          </div>
          <div
            className="absolute left-1/2 z-10 flex w-[58px] -translate-x-1/2 flex-col items-center transition-[bottom] duration-75"
            style={{ bottom: `calc(${position}% - 20px)` }}
          >
            <div className="h-6 w-px bg-[#c8bda6]/50" />
            <div className="grid h-9 w-12 place-items-center rounded-sm border border-[#d7ccb4]/45 bg-[#1a211a] shadow-[0_4px_18px_rgba(0,0,0,0.7)]">
              <Droplets className={cn("h-4 w-4", caught ? "text-amber-bright" : "text-[#93a6a0]")} strokeWidth={1.5} />
            </div>
            <div className={cn("mt-1 h-1 w-8 rounded-full transition-colors", caught ? "bg-amber shadow-[0_0_12px_rgba(215,163,95,0.9)]" : "bg-[#d7ccb4]/20")} />
          </div>
          <div className="absolute bottom-0 left-1/2 h-7 w-[92px] -translate-x-1/2 rounded-t-md border border-parchment/12 bg-[#121a14]" />
          <div className="absolute bottom-7 left-1/2 h-2 w-[56px] -translate-x-1/2 bg-[#050805]" />
          <div className="absolute -right-1 top-2 font-mono text-[7px] uppercase tracking-[0.15em] text-ash/60 [writing-mode:vertical-rl]">
            the old shaft
          </div>
        </div>

        <div>
          <div className="flex items-end justify-between">
            <div>
              <div className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">Bucket caught</div>
              <div className="mt-1 flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-full border transition-all",
                      i < draws ? "border-amber/60 bg-amber/15 text-amber-bright" : "border-parchment/15 text-ash/40",
                    )}
                  >
                    <Droplets className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </span>
                ))}
                <span className="ml-1 font-serif text-2xl leading-none text-parchment">{draws}<span className="text-sm text-ash">/3</span></span>
              </div>
            </div>
            <Chip tone={caught ? "amber" : "default"}>{caught ? "In the band" : "Crank on"}</Chip>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-parchment/10">
            <div
              className="h-full bg-amber transition-[width] duration-200"
              style={{ width: `${Math.min(100, (draws / 3) * 100)}%` }}
            />
          </div>

          <button
            type="button"
            onClick={draw}
            disabled={lost}
            className={cn(
              "mt-5 flex w-full items-center justify-center gap-2 rounded-xl border py-4 font-mono text-[11px] font-medium uppercase tracking-[0.18em] transition-all",
              caught
                ? "border-amber bg-amber text-[#17130c] shadow-[0_10px_32px_-14px_rgba(215,163,95,0.8)] hover:bg-amber-bright"
                : "border-parchment/20 bg-parchment/[0.04] text-parchment hover:border-amber/40",
              lost && "opacity-40",
            )}
          >
            <ArrowUpRight className="h-4 w-4" /> Catch the bucket
          </button>

          <div className="mt-3 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.12em] text-ash">
            <span>Splices lost: {misses} / 4</span>
            <span>{width}% band</span>
          </div>

          {lost ? (
            <div className="mt-4 rounded-lg border border-ember/30 bg-ember/[0.07] p-3">
              <p className="text-[12px] leading-relaxed text-[#e4b49d]">The rope slipped its cleat. The bucket is at the bottom again.</p>
              <Button variant="secondary" onClick={retry} className="mt-3 px-3 py-2 text-[9px]">
                <RotateCcw className="h-3 w-3" /> Take up the rope
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-[11px] leading-relaxed text-ash">
              The pale band is the only sound stretch of rope. Press when the bucket sits within it — four slips and the crank resets.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3. NINE CANDLES                                                     */
/* ------------------------------------------------------------------ */

const CROSS = [
  [1, 3],
  [0, 2, 4],
  [1, 5],
  [0, 4, 6],
  [1, 3, 5, 7],
  [2, 4, 8],
  [3, 7],
  [4, 6, 8],
  [5, 7],
];

function toggleAt(board: boolean[], index: number): boolean[] {
  const next = [...board];
  next[index] = !next[index];
  for (const neighbour of CROSS[index]) next[neighbour] = !next[neighbour];
  return next;
}

function makeCandles(): boolean[] {
  let board = Array.from({ length: 9 }, () => true);
  const changes = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < changes; i += 1) {
    board = toggleAt(board, Math.floor(Math.random() * 9));
  }
  if (board.every(Boolean)) board = toggleAt(board, 4);
  return board;
}

function NineCandles({ onWin }: GameProps) {
  const [board, setBoard] = useState<boolean[]>(makeCandles);
  const [moves, setMoves] = useState(0);
  const [reset, setReset] = useState(0);
  const scored = useRef(false);
  const lit = board.filter(Boolean).length;
  const solved = lit === 9;

  useEffect(() => {
    if (!solved || scored.current) return;
    scored.current = true;
    sfx("seal");
    const timer = window.setTimeout(onWin, 700);
    return () => window.clearTimeout(timer);
  }, [solved, onWin]);

  const tap = (index: number) => {
    if (solved) return;
    sfx("click");
    setMoves((m) => m + 1);
    setBoard((current) => toggleAt(current, index));
  };

  const resetPuzzle = () => {
    sfx("click");
    scored.current = false;
    setBoard(makeCandles());
    setMoves(0);
    setReset((r) => r + 1);
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="relative grid h-9 w-9 place-items-center rounded-full border border-amber/30 bg-amber/10 text-amber">
            <Flame className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <div>
            <div className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">Altar wicks</div>
            <div className="font-serif text-xl leading-tight text-parchment">
              {lit} <span className="text-sm text-ash">of 9 lit</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={resetPuzzle}
          className="inline-flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-ash transition hover:text-amber"
        >
          <RotateCcw className="h-3 w-3" /> reset the draught
        </button>
      </div>

      <div className="relative rounded-2xl border border-parchment/10 bg-[radial-gradient(ellipse_at_center,_rgba(215,163,95,0.09),_transparent_65%)] p-4 sm:p-7" key={reset}>
        <div className="mx-auto grid max-w-[350px] grid-cols-3 gap-2.5 sm:gap-3">
          {board.map((on, index) => (
            <button
              key={index}
              type="button"
              onClick={() => tap(index)}
              disabled={solved}
              aria-pressed={on}
              aria-label={`Candle ${index + 1} ${on ? "burning" : "unlit"}`}
              className={cn(
                "group relative flex aspect-[3/4] flex-col items-center justify-end overflow-hidden rounded-lg border pb-2 pt-3 transition-all duration-300",
                on
                  ? "border-amber/40 bg-gradient-to-b from-amber/[0.12] to-transparent shadow-[inset_0_0_22px_-8px_rgba(215,163,95,0.6)]"
                  : "border-parchment/10 bg-[#0b100c] hover:border-parchment/25",
              )}
            >
              {on && <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,_rgba(240,199,132,0.18),_transparent_65%)]" aria-hidden />}
              <span
                className={cn(
                  "relative mb-1.5 h-3.5 w-2.5 rounded-full transition-all duration-500",
                  on ? "bg-amber-bright shadow-[0_0_14px_4px_rgba(240,199,132,0.55)]" : "bg-parchment/10",
                )}
                style={on ? { borderRadius: "50% 50% 50% 50% / 65% 65% 35% 35%" } : undefined}
                aria-hidden
              />
              <span className={cn("relative h-2 w-2 rounded-full", on ? "bg-amber shadow-[0_0_7px_2px_rgba(215,163,95,0.45)]" : "bg-parchment/10")} aria-hidden />
              <span className="mt-1.5 h-7 w-3 rounded-t-sm border border-parchment/20 bg-gradient-to-b from-[#d8cbb2]/80 to-[#9b917f]/50" aria-hidden />
              <span className="mt-1 h-1.5 w-2 rounded-b-sm border border-parchment/15 bg-[#171e17]" aria-hidden />
              <span className={cn("absolute bottom-2 font-mono text-[7px] uppercase tracking-[0.12em]", on ? "text-amber/80" : "text-ash/50")}>
                {on ? "burning" : "cold"}
              </span>
            </button>
          ))}
        </div>
        <p className="mx-auto mt-5 max-w-[420px] text-center text-[11px] leading-relaxed text-ash">
          Each wick you touch changes itself and the four wicks sharing a wall with it. No trick is hidden — only the
          order is.
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between font-mono text-[8px] uppercase tracking-[0.14em] text-ash/70">
        <span>{moves} touches</span>
        <span>{solved ? "The altar holds its breath" : "The draught is watching"}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 4. CROW CALL                                                        */
/* ------------------------------------------------------------------ */

const RUNES = [
  { id: 0, label: "Caw", glyph: "⌁", colour: "#d7a35f" },
  { id: 1, label: "Skree", glyph: "✦", colour: "#9c9ac1" },
  { id: 2, label: "Kraa", glyph: "◉", colour: "#89a294" },
  { id: 3, label: "Wheet", glyph: "✧", colour: "#c58d74" },
];

function CrowCall({ onWin }: GameProps) {
  const sequences = useMemo(
    () =>
      [3, 4, 5, 6].map((length) =>
        Array.from({ length }, () => Math.floor(Math.random() * RUNES.length)),
      ),
    [],
  );
  const [round, setRound] = useState(0);
  const [sequence, setSequence] = useState<number[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [stage, setStage] = useState<"showing" | "input" | "done">("showing");
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState("The crows gather on the wire. Watch.");
  const scored = useRef(false);
  const roundTimer = useRef<number | null>(null);

  useEffect(() => {
    const call = sequences[round];
    setSequence(call);
    setStage("showing");
    setProgress(0);
    setHighlight(null);
    setMessage(round === 0 ? "Watch the runes they light." : "A longer call this time. Watch.");
    const timers: number[] = [];
    call.forEach((rune, index) => {
      timers.push(
        window.setTimeout(() => {
          setHighlight(rune);
          sfx("click");
        }, 600 + index * 640),
      );
      timers.push(window.setTimeout(() => setHighlight(null), 600 + index * 640 + 400));
    });
    timers.push(
      window.setTimeout(() => {
        setStage("input");
        setMessage("Now give it back, one bird at a time.");
      }, 600 + call.length * 640 + 100),
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      if (roundTimer.current) window.clearTimeout(roundTimer.current);
      roundTimer.current = null;
    };
  }, [round, attempt, sequences]);

  useEffect(() => {
    if (stage !== "done" || scored.current) return;
    scored.current = true;
    sfx("seal");
    window.setTimeout(onWin, 500);
  }, [stage, onWin]);

  const callRune = (rune: number) => {
    if (stage !== "input") return;
    if (sequence[progress] === rune) {
      sfx("click");
      const next = progress + 1;
      if (next >= sequence.length) {
        if (round >= sequences.length - 1) {
          setStage("done");
        } else {
          setMessage("They tilt their heads. Not finished yet.");
          roundTimer.current = window.setTimeout(() => setRound((r) => r + 1), 800);
        }
      } else {
        setProgress(next);
      }
    } else {
      sfx("error");
      setMessage("Wrong call. They start the lesson over.");
      setAttempt((a) => a + 1);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">The old call</div>
          <div className="font-serif text-xl leading-tight text-parchment">
            Round {Math.min(round + 1, 4)} <span className="text-sm text-ash">of 4</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full border font-mono text-[8px]",
                i < round || stage === "done"
                  ? "border-amber/60 bg-amber/15 text-amber"
                  : i === round
                    ? "border-parchment/35 text-parchment"
                    : "border-parchment/10 text-ash/40",
              )}
            >
              {i < round || stage === "done" ? <Check className="h-3 w-3" /> : i + 1}
            </span>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-parchment/10 bg-[linear-gradient(180deg,_#101811_0%,_#0a100c_100%)] p-4 sm:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[radial-gradient(ellipse_at_top,_rgba(160,154,193,0.1),_transparent_70%)]" aria-hidden />
        <div className="relative mb-5 flex h-16 items-center justify-between gap-1 border-b border-parchment/10 px-1 pb-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="relative flex flex-1 flex-col items-center">
              <span className="absolute bottom-0 h-6 w-px bg-parchment/10" aria-hidden />
              <Bird
                className={cn(
                  "relative h-3.5 w-3.5 transition-all duration-300",
                  highlight === i % RUNES.length ? "scale-125 text-parchment" : "text-parchment/25",
                )}
                strokeWidth={1.25}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {RUNES.map((rune) => (
            <button
              key={rune.id}
              type="button"
              onClick={() => callRune(rune.id)}
              disabled={stage !== "input"}
              className={cn(
                "group relative overflow-hidden rounded-xl border px-2 py-4 transition-all duration-150 disabled:cursor-default",
                highlight === rune.id
                  ? "border-parchment/60 bg-parchment/[0.09] shadow-[0_0_35px_-8px_rgba(238,229,208,0.4)]"
                  : "border-parchment/12 bg-parchment/[0.03] enabled:hover:border-amber/40 enabled:hover:bg-amber/[0.06]",
              )}
              aria-label={`Call ${rune.label}`}
            >
              <span
                className="mx-auto grid h-11 w-11 place-items-center rounded-full border text-xl transition-all"
                style={{
                  borderColor: highlight === rune.id ? rune.colour : "rgba(238,229,208,0.16)",
                  color: highlight === rune.id ? rune.colour : "rgba(238,229,208,0.7)",
                  boxShadow: highlight === rune.id ? `0 0 26px -5px ${rune.colour}` : undefined,
                }}
              >
                {rune.glyph}
              </span>
              <span className="mt-2.5 block font-mono text-[8px] uppercase tracking-[0.18em] text-parchment-dim">
                {rune.label}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="text-center text-[11.5px] leading-relaxed text-parchment-dim" aria-live="polite">
            {message}
          </p>
          <div className="flex items-center gap-1.5">
            {sequence.map((_, index) => (
              <span
                key={index}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  index < progress ? "w-5 bg-amber" : "w-2.5 bg-parchment/15",
                )}
              />
            ))}
            <span className="ml-2 font-mono text-[8px] uppercase tracking-[0.12em] text-ash">
              {stage === "showing" ? "listen" : stage === "input" ? "repeat" : "remembered"}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-ash">
        The runes are not sounds you can hear with the ears alone. Watch which one the crows light, then press them in
        that order. Four correct rounds and the field is yours.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WARD FRAME                                                          */
/* ------------------------------------------------------------------ */

const GAME_MAP = {
  lantern: LanternRites,
  well: TheLongDraw,
  candles: NineCandles,
  crow: CrowCall,
};

export function MinigameModal({
  game,
  mode = "practice",
  onClose,
  onSolved,
}: {
  game: MinigameId | null;
  mode?: "practice" | "tutorial" | "night";
  onClose: () => void;
  onSolved?: () => void;
}) {
  const [solved, setSolved] = useState(false);

  if (!game) return null;
  const ward = getWard(game);
  const Game = GAME_MAP[game];

  return (
    <Modal open={Boolean(game)} onClose={onClose} wide label={`${ward.game} ward minigame`}>
      <div className="border-b border-parchment/10 bg-[linear-gradient(135deg,_rgba(215,163,95,0.08),_transparent_60%)] px-5 pb-5 pt-6 sm:px-7">
        <div className="flex items-start gap-4 pr-10">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-amber/30 bg-amber/10 font-serif text-2xl text-amber">
            {ward.glyph}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-amber">
                {mode === "tutorial" ? "Tutorial ward" : mode === "night" ? "Night ward" : "Ward  practice"} · {ward.station}
              </span>
              <Chip tone="default">{ward.difficulty}</Chip>
            </div>
            <h2 className="mt-1 font-serif text-2xl leading-tight text-parchment sm:text-[27px]">{ward.game}</h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ash">{ward.blurb}</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-6 sm:px-7 sm:py-7">
        {solved ? (
          <div className="relative overflow-hidden rounded-2xl border border-amber/30 bg-[radial-gradient(ellipse_at_top,_rgba(215,163,95,0.16),_transparent_65%)] px-6 py-9 text-center">
            <div className="relative mx-auto mb-5 grid h-20 w-20 place-items-center">
              <span className="absolute inset-0 animate-[seal-pulse_3s_ease-in-out_infinite] rounded-full border border-amber/30" />
              <span className="absolute inset-2 rounded-full border border-amber/40" />
              <WardIcon id={game} className="h-7 w-7 text-amber-bright" />
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-amber">Ward restored</div>
            <h3 className="mt-2 font-serif text-3xl text-parchment">The dark loses an inch.</h3>
            <p className="mx-auto mt-2 max-w-[400px] text-[12px] leading-relaxed text-parchment-dim">
              {game === "lantern" && "The wick catches. For a moment the lane is longer than it was, and every window seems to be watching."}
              {game === "well" && "The bucket comes up brim-full and cold. In the black water, a second moon keeps its own counsel."}
              {game === "candles" && "Nine small flames stand up at once. The chapel smells of beeswax and something older underneath."}
              {game === "crow" && "The crows lift from the wire and settle again in a different order. It is as close to an apology as they come."}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button
                onClick={() => {
                  sfx("chime");
                  onSolved?.();
                }}
              >
                <Check className="h-4 w-4" />
                {mode === "practice" ? "Keep the seal" : "Seal the ward"}
              </Button>
              <Button variant="ghost" onClick={onClose} className="text-[10px]">
                Leave it for now
              </Button>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 border-t border-parchment/10 pt-4 font-mono text-[8px] uppercase tracking-[0.16em] text-ash/70">
              <Sparkles className="h-2.5 w-2.5" /> A seal for your ledger
            </div>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-parchment/10 bg-parchment/[0.025] px-3.5 py-3">
              <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" strokeWidth={1.5} />
              <p className="text-[11px] leading-relaxed text-parchment-dim">{ward.how}</p>
            </div>
            <Game onWin={() => setSolved(true)} />
            <div className="mt-6 flex items-center justify-between border-t border-parchment/10 pt-4">
              <Button variant="ghost" onClick={onClose} className="text-[10px]">
                <ArrowLeft className="h-3.5 w-3.5" /> Step away
              </Button>
              <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash/60">{ward.duration}</span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
