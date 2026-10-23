import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  ArrowRight,
  Bird,
  Check,
  Droplet,
  Flame,
  Moon,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { MinigameId } from "../lib/game";

type ButtonVariant = "primary" | "secondary" | "ghost" | "dark";

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        "group inline-flex items-center justify-center gap-2 rounded-full font-sans text-[12px] font-semibold uppercase tracking-[0.16em] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber",
        variant === "primary" &&
          "bg-amber px-5 py-3.5 text-[#17130c] shadow-[0_10px_35px_-16px_rgba(215,163,95,0.9)] hover:bg-amber-bright hover:shadow-[0_14px_45px_-14px_rgba(240,199,132,0.75)]",
        variant === "secondary" &&
          "border border-parchment/22 bg-parchment/[0.03] px-5 py-3.5 text-parchment hover:border-amber/60 hover:bg-amber/10 hover:text-amber-bright",
        variant === "ghost" &&
          "px-3 py-2 text-parchment-dim normal-case tracking-[0.06em] hover:text-amber-bright",
        variant === "dark" &&
          "border border-ink/20 bg-ink px-5 py-3.5 text-parchment hover:bg-pine hover:text-amber-bright",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ArrowTag({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber transition-colors hover:text-amber-bright"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
    </button>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="h-px w-7 bg-amber/60" aria-hidden />
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-amber">
        {children}
      </span>
    </div>
  );
}

export function Chip({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "amber" | "moss" | "ember" | "outline";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-medium uppercase tracking-[0.14em]",
        tone === "default" && "border-parchment/12 bg-parchment/[0.04] text-parchment-dim",
        tone === "amber" && "border-amber/30 bg-amber/10 text-amber-bright",
        tone === "moss" && "border-moss/30 bg-moss/10 text-[#a7bda9]",
        tone === "ember" && "border-ember/35 bg-ember/10 text-[#e6a283]",
        tone === "outline" && "border-parchment/20 text-parchment",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Ornament({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-3 text-amber/55", className)} aria-hidden>
      <span className="h-px w-12 bg-gradient-to-r from-transparent to-amber/40" />
      <span className="text-[10px] tracking-[0.4em]">✦</span>
      <span className="h-px w-12 bg-gradient-to-l from-transparent to-amber/40" />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className,
  wide = false,
  label = "Dialog",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  wide?: boolean;
  label?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[#050705]/85 backdrop-blur-md"
      />
      <div
        className={cn(
          "relative z-10 max-h-[94dvh] w-full overflow-y-auto border border-parchment/12 bg-[#0e130f] shadow-[0_30px_120px_-20px_rgba(0,0,0,0.95)]",
          "rounded-t-[22px] sm:rounded-[22px]",
          wide ? "sm:max-w-4xl" : "sm:max-w-2xl",
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 grid h-9 w-9 place-items-center rounded-full border border-parchment/15 text-parchment-dim transition hover:border-amber/50 hover:text-amber-bright"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function WardIcon({ id, className }: { id: MinigameId; className?: string }) {
  const shared = cn("h-5 w-5", className);
  if (id === "lantern") return <Flame className={shared} strokeWidth={1.5} />;
  if (id === "well") return <Droplet className={shared} strokeWidth={1.5} />;
  if (id === "candles") return <Sparkles className={shared} strokeWidth={1.5} />;
  return <Bird className={shared} strokeWidth={1.5} />;
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-9 w-9", className)} aria-hidden fill="none">
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeOpacity="0.22" />
      <path
        d="M28.7 9.2c-6.9 1.4-11.9 7.3-11.9 14.3 0 6.1 3.7 11.4 9.3 13.5-1.5.7-3.1 1.1-4.8 1.1-6.9 0-12.5-5.6-12.5-12.5S14.4 13.1 21.3 13.1c2.6 0 5.1.8 7.1 2.2"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <path d="M31 19.5c3.7 2.4 5.5 6.4 4.9 10.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M24 20.5l.4 5.9 5.9.4-5.9.4-.4 5.9-.4-5.9-5.9-.4 5.9-.4.4-5.9Z" fill="currentColor" fillOpacity="0.55" />
      <circle cx="34.5" cy="32" r="1.1" fill="currentColor" />
      <circle cx="15" cy="35" r="0.8" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

export function LanternArt({ className, lit = true }: { className?: string; lit?: boolean }) {
  return (
    <svg viewBox="0 0 120 190" className={cn("h-auto w-full", className)} aria-hidden fill="none">
      <defs>
        <radialGradient id={`flame-${lit ? "on" : "off"}`} cx="50%" cy="42%" r="50%">
          <stop offset="0%" stopColor="#ffe6b0" stopOpacity={lit ? "0.95" : "0"} />
          <stop offset="50%" stopColor="#e5ac5f" stopOpacity={lit ? "0.55" : "0"} />
          <stop offset="100%" stopColor="#d7a35f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M60 2v22" stroke="#a29a87" strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="60" cy="26" r="3" stroke="#c6bba4" strokeWidth="1.2" />
      <path d="M28 42h64l-6 12H34l-6-12Z" fill="#1b241d" stroke="#9b907c" strokeOpacity="0.65" strokeWidth="1.2" />
      <path d="M40 54h40l-4 10H44l-4-10Z" fill="#141b16" stroke="#897f6c" strokeOpacity="0.5" />
      <path d="M44 64h32v70c0 10-7 17-16 17s-16-7-16-17V64Z" fill="#111813" stroke="#a39883" strokeOpacity="0.55" strokeWidth="1.4" />
      <path d="M51 75h18v36H51V75Z" fill="#e5ac5f" fillOpacity={lit ? "0.2" : "0.06"} stroke="#cbbfa6" strokeOpacity="0.35" />
      <circle cx="60" cy="94" r="30" fill={`url(#flame-${lit ? "on" : "off"})`} />
      {lit && (
        <>
          <path d="M60 83c5 6 6 11 3 17-1 2-4 4-4 4s-3-3-3-6c0-3 2-5 2-8 0-3 2-5 2-7Z" fill="#f7d392" />
          <path d="M60 92c2 3 2 5 1 7" stroke="#a95f36" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      <path d="M40 73h40" stroke="#c4b8a1" strokeOpacity="0.5" />
      <path d="M46 147h28l4 12H42l4-12Z" fill="#1b241d" stroke="#9b907c" strokeOpacity="0.6" />
      <path d="M38 159h44" stroke="#c4b8a1" strokeOpacity="0.4" />
      <path d="M34 166h52" stroke="#c4b8a1" strokeOpacity="0.2" />
    </svg>
  );
}

export function Portrait({
  initials,
  colour,
  size = "md",
  hollow = false,
}: {
  initials: string;
  colour: string;
  size?: "sm" | "md" | "lg";
  hollow?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full border font-mono font-medium tracking-[0.08em]",
        size === "sm" && "h-8 w-8 text-[9px]",
        size === "md" && "h-11 w-11 text-[11px]",
        size === "lg" && "h-16 w-16 text-[15px]",
        hollow ? "border-ember/50 bg-[#1b1210] text-[#e5a283]" : "border-parchment/15 bg-pine text-parchment-dim",
      )}
      style={{ boxShadow: hollow ? "0 0 25px -10px rgba(184,102,63,0.8)" : `0 0 24px -14px ${colour}` }}
    >
      {initials}
      {hollow && <Moon className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-[#0e130f] p-0.5 text-ember" />}
    </span>
  );
}

export function ProgressRing({
  value,
  total,
  size = 66,
  label,
}: {
  value: number;
  total: number;
  size?: number;
  label?: string;
}) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = total === 0 ? 0 : Math.min(1, value / total);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeOpacity="0.14" strokeWidth="2" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#d7a35f"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-serif text-base leading-none text-parchment">{value}</div>
        <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-ash">{label ?? `/${total}`}</div>
      </div>
    </div>
  );
}

export function CheckLine({ children, done = false }: { children: ReactNode; done?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
          done ? "border-amber bg-amber text-[#17130c]" : "border-parchment/20 text-transparent",
        )}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      <span className={cn("text-[12.5px] leading-relaxed", done ? "text-parchment" : "text-parchment-dim")}>{children}</span>
    </div>
  );
}
