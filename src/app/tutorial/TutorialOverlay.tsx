// Tutorial screen: the canvas frame, chapter card, status panel, touch controls and the
// practice workbench. Presentational only: every value and handler comes from TutorialClient.
import type { Dispatch, RefObject, SetStateAction } from "react";
import Link from "next/link";
import { ArrowLeft, Wrench, Zap } from "lucide-react";
import { BUILDINGS, type Building, type DoorState } from "@/game/buildings";
import { WARD_JOBS, wardProgress, wardSolved, wardView, type WardKind, type WardPuzzle } from "@/game/wards";
import { renderWardJob } from "@/game/ward-ui";
import type { AudioDirector } from "@/game/audio";
import type { SettingsStore } from "@/game/settings";
import type { SettingsDialog } from "@/game/settings-ui";
import type { TaskView } from "@/game/types";
import { CHAPTERS, type Chapter } from "./chapters";
import { WardJobSurface } from "./WardJobSurface";
import type { TutorialVisit } from "./tutorial-types";

export interface TutorialOverlayProps {
  actionHint: string | null;
  activateTimepiece: () => void;
  activeChap: Chapter;
  audioRef: RefObject<AudioDirector | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cartX: number;
  completedChapters: number[];
  currentChapter: number;
  ensureAudio: () => void;
  exhausted: boolean;
  getSettingsStore: () => SettingsStore;
  handleBuilding: (action: "interact" | "lock") => boolean;
  handleDropSupply: () => void;
  handleHollowRuin: () => void;
  handleInteract: () => void;
  handlePracticeMove: (index: number) => void;
  hasKey: boolean;
  hasSupply: boolean;
  hasTimepiece: boolean;
  inside: string | null;
  keyX: number | null;
  keys: RefObject<Set<string>>;
  muted: boolean;
  nearDoorState: DoorState | undefined;
  nearKeyedDoor: Building | undefined;
  openPracticeWard: (kind: WardKind) => void;
  playerX: number;
  practiceKind: WardKind;
  practiceModalOpen: boolean;
  practiceNow: number;
  practicePreviewUntil: number;
  practicePuzzle: WardPuzzle | null;
  setCartHeld: Dispatch<SetStateAction<boolean>>;
  setCurrentChapter: Dispatch<SetStateAction<number>>;
  setPracticeModalOpen: Dispatch<SetStateAction<boolean>>;
  settingsDialogRef: RefObject<SettingsDialog | null>;
  stamina: number;
  tasks: TaskView[];
  timeNow: number;
  timeVisit: TutorialVisit | null;
  toast: string | null;
}

export function TutorialOverlay(props: TutorialOverlayProps) {
  const { actionHint, activateTimepiece, activeChap, audioRef, canvasRef, cartX, completedChapters, currentChapter, ensureAudio, exhausted, getSettingsStore, handleBuilding, handleDropSupply, handleHollowRuin, handleInteract, handlePracticeMove, hasKey, hasSupply, hasTimepiece, inside, keyX, keys, muted, nearDoorState, nearKeyedDoor, openPracticeWard, playerX, practiceKind, practiceModalOpen, practiceNow, practicePreviewUntil, practicePuzzle, setCartHeld, setCurrentChapter, setPracticeModalOpen, settingsDialogRef, stamina, tasks, timeNow, timeVisit, toast } = props;
  return (
    <main
      className="fixed inset-0 h-[100dvh] w-full select-none overflow-hidden bg-[#0b0710]"
      style={{ touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* ---- Top Bar & Chapter Guidance HUD ---- */}
      <div className="absolute left-0 right-0 top-0 z-20 flex flex-col items-center gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:p-4">
        {/* Top Controls Row */}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded border border-[#3a2733] bg-[#140d18]/90 px-3 py-1.5 text-xs text-[#c9b8a4] backdrop-blur hover:border-[#c9762f] hover:text-[#ffd98a]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Town Menu
            </Link>
            <span className="hidden font-display text-lg text-[#d99a3d] md:inline">Singleplayer School</span>
            {(hasTimepiece || timeVisit) && <button onClick={activateTimepiece} className="rounded border border-[#7ba9a6] bg-[#243b3c]/90 px-2 py-1.5 text-xs text-[#cbeae1]">{timeVisit ? "Return · M" : "Timepiece · M"}</button>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => openPracticeWard("well")}
              className="flex items-center gap-1.5 rounded border border-[#6b5038] bg-[#2a1a16]/90 px-3 py-1.5 text-xs text-[#f0caa0] hover:bg-[#3d271f]"
            >
              <Wrench className="h-3.5 w-3.5 text-[#d99a3d]" /> Practice Any Ward
            </button>
            <button
              onClick={() => {
                ensureAudio();
                const m = !muted;
                getSettingsStore().update((draft) => { draft.audio.muted = m; });
                audioRef.current?.setMuted(m);
              }}
              title={muted ? "Unmute" : "Mute"}
              className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#9c8b7a] hover:text-[#d99a3d]"
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button
              onClick={() => settingsDialogRef.current?.open()}
              className="rounded border border-[#3a2733] bg-[#140d18]/80 px-2 py-1 text-[#c9b8a4] hover:text-[#ffd98a]"
            >
              ⚙
            </button>
          </div>
        </div>

        {/* Guided Chapter Card */}
        <div className="w-[min(96vw,720px)] rounded-xl border border-[#d99a3d]/50 bg-[#160e18]/95 p-3.5 shadow-[0_12px_45px_rgba(0,0,0,0.7)] backdrop-blur sm:p-4">
          <div className="flex items-center justify-between border-b border-[#3a2733] pb-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono uppercase tracking-[0.2em] text-[#d99a3d]">{activeChap.title}</span>
              <span className="hidden text-[#8f7d6b] sm:inline">· {activeChap.summary}</span>
            </div>
            <div className="flex gap-1.5">
              {CHAPTERS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setCurrentChapter(ch.id)}
                  title={ch.title}
                  className={`h-5 w-5 rounded text-[11px] font-mono transition-colors ${
                    currentChapter === ch.id
                      ? "bg-[#d99a3d] font-bold text-[#140d18]"
                      : completedChapters.includes(ch.id)
                      ? "border border-[#6b8e23] bg-[#1d2a1a] text-[#a8c98a]"
                      : "border border-[#3a2733] text-[#705f55]"
                  }`}
                >
                  {completedChapters.includes(ch.id) ? "✓" : ch.id}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-[#e9dfcf]">{activeChap.instruction}</p>
          <p className="mt-1 font-serif text-xs italic text-[#9c8b7a]">&ldquo;{activeChap.guideNote}&rdquo;</p>
        </div>
      </div>

      {timeVisit && <div data-testid="past-countdown" className="absolute right-3 top-48 z-20 rounded border border-[#83b9b4] bg-[#172c32]/95 px-3 py-2 text-xs text-[#d2eee5]">In the past · {Math.max(0, Math.ceil((timeVisit.endsAt - timeNow) / 1000))}s <button onClick={activateTimepiece} className="ml-2 underline">Return now</button></div>}

      {/* ---- Interactive Objectives Indicator & Wards Bar ---- */}
      <div className="absolute left-3 top-48 hidden w-56 rounded border border-[#3a2733]/70 bg-[#140d18]/80 p-3 text-xs backdrop-blur sm:block">
        <div className="mb-2 uppercase tracking-widest text-[#9c8b7a]">Tutorial Town Status</div>
        <div className="space-y-1.5 text-[#d8c9b4]">
          <div className="flex justify-between">
            <span>Repaired Wards:</span>
            <span className="font-mono text-[#a8c98a]">
              {tasks.filter((t) => t.done).length} / {tasks.length}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Carrying Kit:</span>
            <span className="font-mono text-[#d99a3d]">{hasSupply ? "YES (slow)" : "None"}</span>
          </div>
          <div className="flex justify-between">
            <span>Location:</span>
            <span data-testid="tutorial-location" className="font-mono text-[#c9b8a4]">{inside ? BUILDINGS.find((b) => b.id === inside)?.name : "The road"}</span>
          </div>
          <div className="flex justify-between">
            <span>Your position:</span>
            <span data-testid="tutorial-position" className="font-mono text-[#c9b8a4]">{Math.round(playerX)}</span>
          </div>
          <div className="flex justify-between">
            <span>Cart Position:</span>
            <span className="font-mono text-[#c9b8a4]">x={Math.round(cartX)}</span>
          </div>
          <div className="flex justify-between">
            <span>Iron Key:</span>
            <span className="font-mono text-[#e8b93c]">{hasKey ? "In Hand" : keyX !== null ? "On Road" : "Used"}</span>
          </div>
        </div>
      </div>

      {/* ---- On-Screen Touch / Keyboard Controls ---- */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
        {/* Left: Movement & Vigor */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <Zap
              className={`h-3.5 w-3.5 ${
                stamina <= 0 ? "text-[#e06a5a]" : stamina < 0.3 ? "text-[#d99a3d]" : "text-[#a8c98a]"
              }`}
            />
            <div className="h-2 w-28 overflow-hidden rounded-full border border-[#3a2733] bg-[#140d18]/80">
              <div
                className={`h-full transition-[width] duration-300 ${
                  stamina <= 0 ? "bg-[#e06a5a]" : stamina < 0.3 ? "bg-[#d99a3d]" : "bg-[#6b8e23]"
                }`}
                style={{ width: `${Math.round(stamina * 100)}%` }}
              />
            </div>
            <span className={`text-[10px] ${exhausted ? "text-[#e06a5a]" : "text-[#9c8b7a]"}`}>
              {exhausted ? "spent — rest!" : "vigor"}
            </span>
            {hasSupply && <span className="rounded bg-[#3a2410] px-1 text-[9px] text-[#ffd98a]">hauling kit</span>}
          </div>

          <div className="flex gap-2">
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                keys.current.add("left");
              }}
              onPointerUp={() => keys.current.delete("left")}
              onPointerLeave={() => keys.current.delete("left")}
              className="h-14 w-14 rounded-full border border-[#3a2733] bg-[#140d18]/90 text-2xl text-[#d8c9b4] active:bg-[#3a2733]"
            >
              ◀
            </button>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                keys.current.add("right");
              }}
              onPointerUp={() => keys.current.delete("right")}
              onPointerLeave={() => keys.current.delete("right")}
              className="h-14 w-14 rounded-full border border-[#3a2733] bg-[#140d18]/90 text-2xl text-[#d8c9b4] active:bg-[#3a2733]"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-end gap-2 sm:gap-3">
          {nearKeyedDoor && (
            <button onClick={() => handleBuilding("lock")} className="h-12 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91]">{nearDoorState?.locked ? "Unlock" : "Lock"} (L)</button>
          )}
          {hasSupply ? (
            <button
              onClick={handleDropSupply}
              className="h-12 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91] sm:h-14 sm:px-4 sm:text-sm"
            >
              Drop Kit (G)
            </button>
          ) : (
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                setCartHeld(true);
              }}
              onPointerUp={() => setCartHeld(false)}
              onPointerLeave={() => setCartHeld(false)}
              className="h-12 rounded-full border border-[#84624c] bg-[#33231f]/90 px-3 text-xs text-[#f2cf91] sm:h-14 sm:px-4 sm:text-sm"
            >
              Hold Push (Shift)
            </button>
          )}

          <div className="flex flex-col items-center gap-1">
            {actionHint && <span className="max-w-48 rounded bg-[#0d0810]/90 px-2 py-1 text-center text-xs text-[#ffd98a]">{actionHint}</span>}
            <button
              onClick={handleInteract}
              className="h-14 w-14 rounded-full border-2 border-[#d99a3d] bg-[#3a2410]/95 font-display text-xl text-[#ffd98a] shadow-[0_0_20px_rgba(217,154,61,0.3)] active:scale-95"
            >
              E
            </button>
            <span className="text-[10px] text-[#9c8b7a]">Interact</span>
          </div>

          <button
            onClick={handleHollowRuin}
            title="Practice Hollow Sabotage"
            className="h-12 rounded-full border border-[#4a1210] bg-[#2a0e0e]/90 px-3 text-xs text-[#ff8a7a] sm:h-14 sm:px-4 sm:text-sm"
          >
            Ruin (R)
          </button>
        </div>
      </div>

      {/* ---- Toast Alert ---- */}
      {toast && (
        <div className="absolute bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-lg border border-[#d99a3d]/60 bg-[#140d18]/95 px-5 py-2.5 text-center text-sm font-semibold text-[#ffd98a] shadow-2xl backdrop-blur">
          {toast}
        </div>
      )}

      {/* ---- Practice Ward Modal ---- */}
      {practiceModalOpen && practicePuzzle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur">
          <div className="w-[min(94vw,600px)] rounded-xl border border-[#d99a3d]/60 bg-[#160e18] p-5 shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#3a2733] pb-3">
              <div>
                <span className="font-mono text-xs uppercase text-[#d99a3d]">Free Practice Workbench</span>
                <h2 className="font-display text-3xl text-[#e9dfcf]">{WARD_JOBS[practiceKind].title}</h2>
              </div>
              <button
                onClick={() => setPracticeModalOpen(false)}
                className="rounded border border-[#3a2733] px-3 py-1 text-sm text-[#c9b8a4] hover:text-[#ffd98a]"
              >
                ✕ Close
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5 border-b border-[#3a2733] pb-3">
              {(Object.keys(WARD_JOBS) as WardKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => openPracticeWard(k)}
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    practiceKind === k
                      ? "bg-[#d99a3d] font-bold text-[#140d18]"
                      : "border border-[#3a2733] bg-[#1d1420] text-[#c9b8a4] hover:border-[#d99a3d]"
                  }`}
                >
                  {WARD_JOBS[k].title.split("·")[0].trim()}
                </button>
              ))}
            </div>

            <p className="mt-3 text-sm text-[#c9b8a4]">{WARD_JOBS[practiceKind].instruction}</p>

            <div className="mt-4 flex justify-between text-xs text-[#9c8b7a]">
              <span>Progress: {Math.round(wardProgress(practicePuzzle) * 100)}%</span>
              <span>Moves: {practicePuzzle.moves}</span>
            </div>

            <div className="mt-4 flex justify-center">
              {wardSolved(practicePuzzle) ? (
                <div className="text-center">
                  <p className="font-display text-2xl text-[#a8c98a]">✓ Ward Solved Successfully!</p>
                  <button
                    onClick={() => openPracticeWard(practiceKind)}
                    className="mt-3 rounded border border-[#6b8e23] bg-[#1d2a1a] px-4 py-2 text-xs text-[#a8c98a]"
                  >
                    Reset & Practice Again
                  </button>
                </div>
              ) : (
                <WardJobSurface
                  html={renderWardJob(wardView(practiceKind, WARD_JOBS[practiceKind].title, practicePuzzle, Math.max(0, practicePreviewUntil - practiceNow)))}
                  onMove={handlePracticeMove}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
