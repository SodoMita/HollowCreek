import { useCallback, useEffect, useState } from "react";
import { EMPTY_PROGRESS, loadProgress, saveProgress, type MinigameId, type NightRecord, type Progress, type View } from "./lib/game";
import { setSound as configureSound, sfx } from "./lib/audio";
import { AppShell, GameBar, ThemeFrame } from "./components/Shell";
import { Home } from "./components/Home";
import { Tutorial } from "./components/Tutorial";
import { NightGame } from "./components/NightGame";
import { Bestiary, Records } from "./components/Pages";
import { MinigameModal } from "./components/Minigames";

const TITLES: Record<Exclude<View, "home">, { eyebrow: string; title: string }> = {
  tutorial: { eyebrow: "Singleplayer prologue", title: "The First Night" },
  night: { eyebrow: "Singleplayer trial", title: "A Night Alone" },
  bestiary: { eyebrow: "The ledger", title: "The Field Guide" },
  records: { eyebrow: "The ledger", title: "Hall of Records" },
};

export default function App() {
  const [view, setView] = useState<View>("home");
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [sound, setSound] = useState(false);
  const [practice, setPractice] = useState<MinigameId | null>(null);
  const [practiceKey, setPracticeKey] = useState(0);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  const go = useCallback((next: View) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    configureSound(next);
    if (next) sfx("chime");
  };

  const setName = useCallback((name: string) => {
    setProgress((current) => ({ ...current, name }));
  }, []);

  const setTutorialStep = useCallback((step: number) => {
    setProgress((current) => ({ ...current, tutorialStep: step }));
  }, []);

  const seal = useCallback((ids: MinigameId[]) => {
    setProgress((current) => ({
      ...current,
      seals: Array.from(new Set([...current.seals, ...ids])),
    }));
  }, []);

  const completeTutorial = useCallback(() => {
    setProgress((current) => ({
      ...current,
      tutorialDone: true,
      tutorialStep: 5,
      seals: Array.from(new Set([...current.seals, "lantern" as MinigameId])),
      lanternsLit: current.lanternsLit + 1,
    }));
  }, []);

  const recordNight = useCallback((record: NightRecord) => {
    setProgress((current) => ({
      ...current,
      nights: [...current.nights, record].slice(-60),
    }));
  }, []);

  const openPractice = (id: MinigameId) => {
    setPracticeKey((key) => key + 1);
    setPractice(id);
  };

  const resetLedger = () => {
    setProgress({ ...EMPTY_PROGRESS, name: progress.name, tutorialStep: 0 });
  };

  const immersive = view === "tutorial" || view === "night";

  if (immersive) {
    const meta = TITLES[view];
    return (
      <>
        <ThemeFrame>
          <GameBar
            eyebrow={meta.eyebrow}
            title={`Hollow Creek · ${meta.title}`}
            onExit={() => go("home")}
            sound={sound}
            onSound={toggleSound}
            right={
              progress.tutorialDone ? (
                <span className="hidden items-center gap-1 rounded-full border border-moss/25 bg-moss/[0.08] px-2.5 py-1 font-mono text-[7.5px] uppercase tracking-[0.12em] text-[#a7bda9] sm:inline-flex">
                  ✓ first night kept
                </span>
              ) : null
            }
          />
          {view === "tutorial" ? (
            <Tutorial
              initialStep={progress.tutorialDone ? 0 : progress.tutorialStep}
              name={progress.name}
              onName={setName}
              onStep={setTutorialStep}
              onSeal={(id) => seal([id])}
              onComplete={completeTutorial}
              onExit={() => go("home")}
              onPlayNight={() => go("night")}
              onBestiary={() => go("bestiary")}
            />
          ) : (
            <NightGame
              name={progress.name}
              onName={setName}
              tutorialDone={progress.tutorialDone}
              onRecord={recordNight}
              onSeal={seal}
              onExit={() => go("home")}
              onTutorial={() => go("tutorial")}
              onBestiary={() => go("bestiary")}
            />
          )}
          <div className="border-t border-parchment/[0.07] px-5 py-5 text-center">
            <span className="font-mono text-[8px] uppercase leading-relaxed tracking-[0.15em] text-ash/45">
              Hollow Creek · singleplayer edition · progress saved in this browser
            </span>
          </div>
        </ThemeFrame>
        <MinigameModal
          key={`practice-${practiceKey}`}
          game={practice}
          mode="practice"
          onClose={() => setPractice(null)}
          onSolved={() => {
            if (practice) seal([practice]);
            setProgress((current) => ({ ...current, practices: current.practices + 1 }));
            setPractice(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      <AppShell view={view} go={go} progress={progress} sound={sound} onSound={toggleSound}>
        {view === "home" && <Home progress={progress} go={go} onPractice={openPractice} />}
        {view === "bestiary" && <Bestiary go={go} />}
        {view === "records" && <Records progress={progress} go={go} onReset={resetLedger} />}
      </AppShell>
      <MinigameModal
        key={`practice-${practiceKey}`}
        game={practice}
        mode="practice"
        onClose={() => setPractice(null)}
        onSolved={() => {
          if (practice) seal([practice]);
          setProgress((current) => ({ ...current, practices: current.practices + 1 }));
          setPractice(null);
        }}
      />
    </>
  );
}
