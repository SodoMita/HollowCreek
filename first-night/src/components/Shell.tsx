import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Feather,
  Flame,
  Home,
  Moon,
  ScrollText,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Menu,
  CircleDot,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { Progress, View } from "../lib/game";
import { WARDS } from "../lib/game";
import { BrandMark, ProgressRing } from "./ui";

interface NavItem {
  view: View;
  label: string;
  icon: typeof Home;
  hint: string;
}

const MAIN_NAV: NavItem[] = [
  { view: "home", label: "The creek", icon: Home, hint: "Start here" },
  { view: "tutorial", label: "The first night", icon: Flame, hint: "Guided tutorial" },
  { view: "night", label: "A night alone", icon: Moon, hint: "Singleplayer" },
];

const LEDGER_NAV: NavItem[] = [
  { view: "bestiary", label: "The field guide", icon: BookOpen, hint: "Creatures & roles" },
  { view: "records", label: "Hall of records", icon: Trophy, hint: "Your ledger" },
];

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-parchment/[0.07] text-parchment" : "text-parchment-dim hover:bg-parchment/[0.04] hover:text-parchment",
      )}
    >
      {active && <span className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-amber" aria-hidden />}
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-amber" : "text-ash group-hover:text-amber/80")} strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium tracking-[0.01em]">{item.label}</span>
        <span className="block truncate font-mono text-[8.5px] uppercase tracking-[0.14em] text-ash/70">{item.hint}</span>
      </span>
      {active && <CircleDot className="h-3 w-3 text-amber/70" strokeWidth={1.5} />}
    </button>
  );
}

export function Sidebar({
  view,
  go,
  progress,
  sound,
  onSound,
  onClose,
}: {
  view: View;
  go: (view: View) => void;
  progress: Progress;
  sound: boolean;
  onSound: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between px-6 pb-7 pt-7">
        <button type="button" onClick={() => go("home")} className="group flex items-center gap-3 text-left">
          <BrandMark className="h-10 w-10 shrink-0 text-amber transition-colors group-hover:text-amber-bright" />
          <span>
            <span className="block font-serif text-[19px] font-medium leading-none tracking-[0.06em] text-parchment">
              Hollow Creek
            </span>
            <span className="mt-1.5 block font-mono text-[8px] uppercase tracking-[0.24em] text-ash">
              A field guide to the night
            </span>
          </span>
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full border border-parchment/15 text-parchment-dim"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-6">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ash/70">The prologue</span>
          <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-amber/80">Oct. 1893</span>
        </div>
        <div className="mt-3 space-y-1">
          {MAIN_NAV.map((item) => (
            <NavButton key={item.view} item={item} active={view === item.view} onClick={() => go(item.view)} />
          ))}
        </div>

        <div className="mt-7 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-ash/70">The ledger</span>
          <ScrollText className="h-3 w-3 text-ash/60" strokeWidth={1.5} />
        </div>
        <div className="mt-3 space-y-1">
          {LEDGER_NAV.map((item) => (
            <NavButton key={item.view} item={item} active={view === item.view} onClick={() => go(item.view)} />
          ))}
        </div>
      </div>

      <div className="mt-auto px-6 pb-6 pt-7">
        <button
          type="button"
          onClick={() => go("records")}
          className="group relative w-full overflow-hidden rounded-xl border border-parchment/12 bg-gradient-to-br from-pine/90 to-[#101610] p-4 text-left transition-colors hover:border-amber/30"
        >
          <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-amber/[0.07] blur-xl" aria-hidden />
          <div className="flex items-center gap-3.5">
            <ProgressRing value={progress.seals.length} total={WARDS.length} size={54} />
            <div className="min-w-0">
              <div className="font-serif text-[14px] leading-tight text-parchment">Your night ledger</div>
              <div className="mt-1 font-mono text-[8.5px] uppercase leading-relaxed tracking-[0.12em] text-ash">
                {progress.seals.length} of 4 wards sealed
              </div>
              <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-amber">
                {progress.tutorialDone ? "Open the ledger" : "Continue the first night"}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => go("bestiary")}
          className="group relative mt-3 block w-full overflow-hidden rounded-xl border border-parchment/10 text-left"
        >
          <img
            src="/images/gloamwing.jpg"
            alt="A pale moth with lantern-like wings resting on a branch"
            className="h-[112px] w-full object-cover object-center opacity-70 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b100c] via-[#0b100c]/75 to-transparent" aria-hidden />
          <div className="absolute inset-0 flex flex-col justify-center p-3.5">
            <span className="inline-flex w-fit items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.18em] text-amber/90">
              <Sparkles className="h-2.5 w-2.5" /> Plate I
            </span>
            <div className="mt-1 font-serif text-[16px] leading-none text-parchment">The Gloamwing</div>
            <p className="mt-1.5 max-w-[150px] text-[10px] leading-relaxed text-parchment-dim">
              It drinks the smoke. It remembers the names.
            </p>
          </div>
        </button>

        <div className="mt-5 flex items-center justify-between border-t border-parchment/[0.08] pt-4">
          <button
            type="button"
            onClick={onSound}
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-parchment-dim transition-colors hover:text-amber"
            aria-pressed={sound}
          >
            {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {sound ? "Sound on" : "Sound off"}
          </button>
          <span className="inline-flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-ash/60">
            <Feather className="h-3 w-3" /> Solo build
          </span>
        </div>
      </div>
    </div>
  );
}

export function MobileBar({
  onMenu,
  sound,
  onSound,
  go,
}: {
  onMenu: () => void;
  sound: boolean;
  onSound: () => void;
  go: (view: View) => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-parchment/10 bg-[#0a0e0b]/95 px-4 py-3 backdrop-blur-md lg:hidden">
      <button type="button" onClick={() => go("home")} className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8 text-amber" />
        <span>
          <span className="block font-serif text-[16px] leading-none tracking-[0.04em] text-parchment">Hollow Creek</span>
          <span className="mt-1 block font-mono text-[7px] uppercase tracking-[0.2em] text-ash">The first night</span>
        </span>
      </button>
      <nav className="flex items-center gap-1.5" aria-label="Mobile menu">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open navigation"
          className="grid h-9 w-9 place-items-center rounded-full border border-parchment/15 text-parchment-dim transition hover:border-amber/40 hover:text-amber"
        >
          <Home className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSound}
          aria-label={sound ? "Mute sound" : "Enable sound"}
          className="grid h-9 w-9 place-items-center rounded-full text-parchment-dim hover:text-amber"
        >
          {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="grid h-9 w-9 place-items-center rounded-full border border-parchment/15 text-parchment-dim hover:text-amber"
        >
          <Menu className="h-4 w-4" />
        </button>
      </nav>
    </header>
  );
}

export function ThemeFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-ink text-parchment">
      <div className="grain-overlay" aria-hidden />
      <div className="pointer-events-none fixed inset-0 z-0 opacity-60" aria-hidden>
        <div className="absolute -left-20 top-1/4 h-[420px] w-[420px] rounded-full bg-moss/[0.06] blur-[110px]" />
        <div className="absolute -right-24 top-0 h-[500px] w-[500px] rounded-full bg-amber/[0.05] blur-[130px]" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function AppShell({
  view,
  go,
  progress,
  sound,
  onSound,
  children,
}: {
  view: View;
  go: (view: View) => void;
  progress: Progress;
  sound: boolean;
  onSound: () => void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    setMenu(false);
  }, [view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ThemeFrame>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[270px] border-r border-parchment/[0.08] bg-[#0a0e0b]/70 lg:block">
        <Sidebar view={view} go={go} progress={progress} sound={sound} onSound={onSound} />
      </aside>

      {menu && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMenu(false)}
            className="absolute inset-0 bg-[#050705]/85 backdrop-blur-sm"
          />
          <aside className="relative h-full w-[86%] max-w-[330px] overflow-y-auto border-r border-parchment/12 bg-[#0b100c] shadow-2xl">
            <Sidebar
              view={view}
              go={go}
              progress={progress}
              sound={sound}
              onSound={onSound}
              onClose={() => setMenu(false)}
            />
          </aside>
        </div>
      )}

      <MobileBar onMenu={() => setMenu(true)} sound={sound} onSound={onSound} go={go} />
      <div className="lg:pl-[270px]">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 pt-4 sm:px-7 lg:px-9 lg:pt-7">{children}</div>
        <Footer go={go} />
      </div>
    </ThemeFrame>
  );
}

export function GameBar({
  title,
  eyebrow,
  onExit,
  sound,
  onSound,
  right,
}: {
  title: string;
  eyebrow: string;
  onExit: () => void;
  sound: boolean;
  onSound: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="relative z-20 flex items-center justify-between gap-3 border-b border-parchment/[0.09] bg-[#0a0e0b]/85 px-4 py-3 backdrop-blur-md sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark className="hidden h-8 w-8 shrink-0 text-amber sm:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.2em] text-amber/80">
            <span className="h-1 w-1 rounded-full bg-amber" /> {eyebrow}
          </div>
          <div className="truncate font-serif text-[16px] leading-tight text-parchment">{title}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {right}
        <button
          type="button"
          onClick={onSound}
          aria-label={sound ? "Mute sound" : "Enable sound"}
          className="grid h-8 w-8 place-items-center rounded-full border border-parchment/12 text-parchment-dim transition hover:border-amber/40 hover:text-amber"
        >
          {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={onExit}
          aria-label="Leave and return to the creek"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-parchment/15 px-3 font-mono text-[9px] uppercase tracking-[0.12em] text-parchment-dim transition hover:border-amber/40 hover:text-amber"
        >
          <X className="h-3 w-3" /> <span className="hidden sm:inline">Leave</span>
        </button>
      </div>
    </header>
  );
}

export function Footer({ go }: { go: (view: View) => void }) {
  return (
    <footer className="mt-8 border-t border-parchment/[0.08] px-4 py-8 sm:px-7 lg:px-9">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-[330px]">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-7 w-7 text-amber/80" />
            <span className="font-serif text-[15px] tracking-[0.04em] text-parchment-dim">Hollow Creek</span>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ash">
            A singleplayer prologue to the one-street horror of townsfolk and things that aren't. No accounts,
            no server — only the lantern you carry and what it lets you see.
          </p>
          <p className="mt-4 font-mono text-[8px] uppercase tracking-[0.18em] text-ash/60">
            October 1893 · The creek remembers
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-2.5 text-[11.5px] text-parchment-dim sm:gap-x-16">
          <button type="button" onClick={() => go("tutorial")} className="text-left transition hover:text-amber">
            The first night
          </button>
          <button type="button" onClick={() => go("bestiary")} className="text-left transition hover:text-amber">
            Field guide
          </button>
          <button type="button" onClick={() => go("night")} className="text-left transition hover:text-amber">
            Walk a night
          </button>
          <button type="button" onClick={() => go("records")} className="text-left transition hover:text-amber">
            Hall of records
          </button>
        </div>
      </div>
      <div className="mx-auto mt-7 flex w-full max-w-[1180px] flex-col gap-2 border-t border-parchment/[0.06] pt-4 font-mono text-[8px] uppercase tracking-[0.16em] text-ash/45 sm:flex-row sm:items-center sm:justify-between">
        <span>Ward games &amp; first-night tutorial — the Gloamwing build</span>
        <span>Art, words &amp; sound made for this creek</span>
      </div>
    </footer>
  );
}
