"use client";

import { useMemo } from "react";
import type { PublicBody, PublicPlayer, Snapshot, Bubble } from "@/lib/game-types";
import {
  CAGES,
  GROUND_Y,
  LANDMARKS,
  TASKS,
  WORLD_WIDTH,
} from "@/lib/world";

const MID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260">
<g fill="#0d1117">
<path d="M0 260 L0 210 L60 210 L80 150 L100 210 L160 210 L185 120 L210 210 L300 210 L300 200 L340 200 L340 210 L420 210 L440 160 L460 210 L560 210 L580 130 L600 210 L700 210 L700 205 L760 205 L780 165 L800 210 L900 210 L900 260 Z"/>
</g>
<g fill="#141a22">
<rect x="120" y="170" width="10" height="45"/><path d="M125 140 L145 175 L105 175 Z"/>
<rect x="430" y="160" width="11" height="52"/><path d="M436 128 L458 165 L414 165 Z"/>
<rect x="700" y="168" width="10" height="46"/><path d="M705 138 L726 173 L684 173 Z"/>
</g>
<g fill="#0a0e14">
<path d="M0 260 L0 236 L900 236 L900 260 Z"/>
</g>
</svg>`;

function svgUrl(svg: string) {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export type RenderPlayer = PublicPlayer & { rx: number; bubbles: Bubble[] };

type Props = {
  snap: Snapshot;
  selfX: number;
  camX: number;
  viewW: number;
  viewH: number;
  players: RenderPlayer[];
  dark: boolean;
};

export default function WorldScene({ snap, selfX, camX, viewW, viewH, players, dark }: Props) {
  const screenX = (x: number) => x - camX;
  const vision = snap.you.vision;
  const px = screenX(selfX);

  const bubbleMap = useMemo(() => {
    const m = new Map<string, Bubble[]>();
    for (const b of snap.bubbles) {
      const arr = m.get(b.playerId) ?? [];
      arr.push(b);
      m.set(b.playerId, arr);
    }
    return m;
  }, [snap.bubbles]);

  const visible = useMemo(() => {
    const left = camX - 200;
    const right = camX + viewW + 200;
    const inView = (x: number) => x > left && x < right;
    return {
      landmarks: LANDMARKS.filter((l) => inView(l.x + l.w / 2) || (l.x < right && l.x + l.w > left)),
      tasks: TASKS.filter((t) => inView(t.x)),
      players: players.filter((p) => inView(p.rx)),
      bodies: snap.bodies.filter((b) => inView(b.x)),
    };
  }, [camX, viewW, players, snap.bodies]);

  const R = Math.max(120, Math.min(vision, 1400));

  // keep the street framed on any aspect: shift up on short screens, gently
  // down on tall ones so it never sits crammed under the HUD
  const spare = viewH - (GROUND_Y + 130);
  const offsetY = spare < 0 ? spare : Math.min(spare * 0.45, 170);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#070a12]">
    <div className="absolute inset-0" style={{ transform: `translateY(${offsetY}px)` }}>
      {/* sky */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg,#05060d 0%,#0a0f1c 22%,#1a1420 46%,#3a1e1a 62%,#5a2c17 72%,#2a1a14 82%,#0b0c12 100%)",
        }}
      />
      {/* moon */}
      <div
        className="absolute rounded-full"
        style={{
          left: Math.max(40, viewW * 0.72 - camX * 0.02),
          top: 54,
          width: 74,
          height: 74,
          background: "radial-gradient(circle at 40% 40%,#f6e7c8,#b9a276)",
          boxShadow: "0 0 60px 18px rgba(240,220,170,0.16)",
          opacity: dark ? 0.25 : 0.75,
        }}
      />
      {/* far hills photo layer */}
      <div
        className="absolute left-0 right-0"
        style={{
          bottom: GROUND_Y - 90,
          height: 330,
          backgroundImage: "url(/images/far.png)",
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPositionX: -camX * 0.18,
          opacity: dark ? 0.5 : 0.85,
          mixBlendMode: "screen",
          filter: "saturate(0.6) brightness(0.55)",
        }}
      />
      {/* mid silhouette layer */}
      <div
        className="absolute left-0 right-0"
        style={{
          bottom: GROUND_Y - 26,
          height: 260,
          backgroundImage: svgUrl(MID_SVG),
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPositionX: -camX * 0.48,
          opacity: 0.95,
        }}
      />

      {/* ground */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: GROUND_Y,
          background:
            "linear-gradient(180deg,#241a14 0%,#191410 18%,#0f0d0c 60%,#08080a 100%)",
        }}
      />
      {/* road */}
      <div
        className="absolute"
        style={{
          top: GROUND_Y - 6,
          left: 0,
          right: 0,
          height: 16,
          background:
            "repeating-linear-gradient(90deg,#2b211a 0px,#2b211a 26px,#231a15 26px,#231a15 52px)",
          borderTop: "1px solid #3a2c22",
          boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
        }}
      />

      {/* world-space props */}
      <div
        className="absolute left-0 top-0"
        style={{ width: WORLD_WIDTH, height: "100%", transform: `translateX(${-camX}px)` }}
      >
        {visible.landmarks.map((l) => (
          <Landmark key={l.id} x={l.x} w={l.w} kind={l.kind} name={l.name} />
        ))}
        {visible.tasks.map((t) => {
          const mine = snap.you.tasks.find((x) => x.id === t.id);
          const near = Math.abs(t.x - selfX) < 200;
          if (!mine && !near) return null;
          return (
            <div
              key={t.id}
              className="absolute select-none"
              style={{ left: t.x - 16, top: GROUND_Y - 66, width: 32, textAlign: "center" }}
            >
              <div
                style={{
                  fontSize: 20,
                  filter: mine && !mine.done ? "drop-shadow(0 0 8px rgba(255,170,60,.9))" : "grayscale(1)",
                  opacity: mine ? (mine.done ? 0.3 : 1) : 0.25,
                }}
              >
                {t.icon}
              </div>
            </div>
          );
        })}

        {/* cages */}
        {CAGES.map((c, i) => {
          const occId = snap.cages[i]?.occupant;
          const occ = occId ? players.find((p) => p.id === occId) : null;
          return (
            <div key={c.id} className="absolute" style={{ left: c.x - 55, top: GROUND_Y - 128 }}>
              <Cage occupied={!!occId} />
              {occ && (
                <div className="absolute" style={{ left: 22, top: 46 }}>
                  <Figure color={occ.color} facing={occ.facing} moving={false} ghost={!occ.alive} small />
                </div>
              )}
              <div
                className="absolute w-[110px] text-center text-[10px] tracking-widest uppercase"
                style={{ left: 0, top: -18, color: occId ? "#e8b44a" : "#4b5563" }}
              >
                {occ ? `${occ.name} · caged` : "empty cage"}
              </div>
            </div>
          );
        })}

        {/* key */}
        {snap.keyX !== null && Math.abs(snap.keyX - selfX) < 900 && (
          <div
            className="absolute animate-floaty"
            style={{ left: snap.keyX - 10, top: GROUND_Y - 40 }}
          >
            <div style={{ fontSize: 22, filter: "drop-shadow(0 0 10px rgba(255,215,120,.8))" }}>🗝️</div>
          </div>
        )}

        {/* bodies */}
        {visible.bodies.map((b) => (
          <Body key={b.id} b={b} />
        ))}

        {/* players */}
        {visible.players.map((p) => (
          <div key={p.id} className="absolute" style={{ left: p.rx - 22, top: GROUND_Y - 64 }}>
            {p.bubbles?.length ? (
              <Bubbles bubbles={p.bubbles} />
            ) : null}
            {!p.bubbles?.length && (
              <div
                className="absolute w-[110px] text-center text-[11px] font-semibold whitespace-nowrap"
                style={{
                  left: -33,
                  top: -14,
                  color: p.ghost ? "#8fb6d8" : "#e8dfd0",
                  textShadow: "0 2px 6px #000",
                  opacity: p.ghost ? 0.7 : 1,
                }}
              >
                {p.name}
                {p.hasKey ? " 🗝️" : ""}
                {p.caged ? " ⛓️" : ""}
              </div>
            )}
            {/* caged players are drawn inside their cage above */}
            {!p.caged && (
              <Figure
                color={p.color}
                facing={p.facing}
                moving={p.moving}
                ghost={p.ghost}
                isYou={p.isYou}
              />
            )}
          </div>
        ))}
      </div>

      {/* fog of war */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle ${R}px at ${px}px ${GROUND_Y - 20}px,
            rgba(4,6,12,0) 0%,
            rgba(4,6,12,${dark ? 0.35 : 0.16}) ${R * 0.55}px,
            rgba(3,4,10,${dark ? 0.9 : 0.72}) ${R * 0.9}px,
            #02030a ${R * 1.15}px)`,
          transition: "background 220ms linear",
        }}
      />
      {/* vignette + grain */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {dark && (
        <div className="absolute inset-0 pointer-events-none bg-[#01020a] animate-flicker opacity-60" />
      )}
    </div>
    </div>
  );
}

function Bubbles({ bubbles }: { bubbles: Bubble[] }) {
  return (
    <>
      {bubbles.map((b, i) => (
        <div
          key={b.id}
          className="absolute z-20 max-w-[190px] rounded-xl px-3 py-1.5 text-[12px] leading-tight"
          style={{
            left: -84,
            top: -76 - i * 40,
            background: "rgba(12,14,20,0.94)",
            border: `1px solid ${b.color}`,
            color: b.ghost ? "#9fc4e6" : "#efe6d8",
            boxShadow: "0 8px 22px rgba(0,0,0,0.7)",
            whiteSpace: "normal",
          }}
        >
          <span className="font-semibold" style={{ color: b.color }}>
            {b.name}:{" "}
          </span>
          {b.text}
          <span
            className="absolute"
            style={{
              left: 84,
              bottom: -7,
              width: 12,
              height: 12,
              background: "rgba(12,14,20,0.94)",
              borderRight: `1px solid ${b.color}`,
              borderBottom: `1px solid ${b.color}`,
              transform: "rotate(45deg)",
            }}
          />
        </div>
      ))}
    </>
  );
}

export function Figure({
  color,
  facing,
  moving,
  ghost,
  small,
  isYou,
}: {
  color: string;
  facing: 1 | -1;
  moving: boolean;
  ghost?: boolean;
  small?: boolean;
  isYou?: boolean;
}) {
  const w = small ? 30 : 44;
  const h = small ? 42 : 62;
  return (
    <div
      className={moving ? "anim-bob" : ""}
      style={{
        width: w,
        height: h,
        transform: `scaleX(${facing})`,
        opacity: ghost ? 0.45 : 1,
        filter: ghost
          ? "drop-shadow(0 0 10px rgba(120,180,255,.7)) saturate(0.4)"
          : `drop-shadow(0 6px 10px rgba(0,0,0,.75))`,
      }}
    >
      <svg viewBox="0 0 40 60" width="100%" height="100%">
        <defs>
          <radialGradient id={`lg-${color.replace("#", "")}`} cx="50%" cy="50%">
            <stop offset="0%" stopColor="#ffd68a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="9" cy="46" rx="14" ry="4" fill="#000" opacity="0.5" />
        {/* cloak */}
        <path
          d="M9 58 C7 36 11 22 20 19 C29 22 33 36 31 58 Z"
          fill={color}
          stroke="#05070c"
          strokeWidth="1.5"
        />
        {/* hood */}
        <path
          d="M20 4 C27 4 30 10 30 16 C30 22 25 25 20 25 C15 25 10 22 10 16 C10 10 13 4 20 4 Z"
          fill={color}
          stroke="#05070c"
          strokeWidth="1.5"
        />
        <ellipse cx="20" cy="16" rx="6.4" ry="5.2" fill="#05070c" />
        <circle cx="17.6" cy="15.6" r="1.1" fill={ghost ? "#cfe6ff" : "#ffd9a0"} />
        <circle cx="22.4" cy="15.6" r="1.1" fill={ghost ? "#cfe6ff" : "#ffd9a0"} />
        {/* arm + lantern */}
        <path d="M28 34 C33 36 34 40 34 44" stroke="#05070c" strokeWidth="3.4" fill="none" />
        {!ghost && (
          <>
            <circle cx="34" cy="47" r="9" fill={`url(#lg-${color.replace("#", "")})`} />
            <rect x="32.2" y="44" width="3.6" height="5" rx="1" fill="#ffca6b" />
          </>
        )}
        {isYou && <circle cx="20" cy="16" r="17" fill="none" stroke="#ffe6a8" strokeWidth="0.8" opacity="0.35" />}
      </svg>
    </div>
  );
}

function Body({ b }: { b: PublicBody }) {
  return (
    <div className="absolute" style={{ left: b.x - 40, top: GROUND_Y - 26 }}>
      <svg width="80" height="46" viewBox="0 0 80 46">
        <ellipse cx="40" cy="40" rx="30" ry="6" fill="#3a0d0d" opacity="0.85" />
        <g transform="rotate(78 40 26)">
          <path d="M9 58 C7 36 11 22 20 19 C29 22 33 36 31 58 Z" fill={b.color} stroke="#05070c" strokeWidth="1.5" />
          <path d="M20 4 C27 4 30 10 30 16 C30 22 25 25 20 25 C15 25 10 22 10 16 C10 10 13 4 20 4 Z" fill={b.color} stroke="#05070c" strokeWidth="1.5" />
        </g>
      </svg>
    </div>
  );
}

function Cage({ occupied }: { occupied: boolean }) {
  return (
    <svg width="110" height="130" viewBox="0 0 110 130">
      <rect x="4" y="4" width="102" height="122" fill="rgba(6,8,12,0.55)" />
      {[10, 26, 42, 58, 74, 90].map((x) => (
        <rect key={x} x={x} y="4" width="4" height="122" fill={occupied ? "#7c6a4a" : "#4a4238"} opacity="0.95" />
      ))}
      <rect x="2" y="2" width="106" height="8" fill="#8a7550" />
      <rect x="2" y="120" width="106" height="8" fill="#6b5a3e" />
      <rect x="0" y="0" width="110" height="130" fill="none" stroke="#2f2a22" strokeWidth="2" />
    </svg>
  );
}

function Landmark({
  x,
  w,
  kind,
  name,
}: {
  x: number;
  w: number;
  kind: string;
  name: string;
}) {
  const base = GROUND_Y;
  return (
    <div className="absolute" style={{ left: x, width: w, top: 0, height: base }}>
      <div className="absolute" style={{ bottom: 0, left: 0, right: 0, height: base }}>
        {kind === "forest" && <Forest w={w} />}
        {kind === "orchard" && <Orchard w={w} />}
        {kind === "busstop" && <BusStop w={w} />}
        {kind === "chapel" && <Chapel />}
        {kind === "graveyard" && <Graveyard w={w} />}
        {kind === "pumpkins" && <Pumpkins w={w} />}
        {kind === "square" && <Square w={w} />}
        {kind === "sawmill" && <Sawmill />}
        {kind === "dock" && <Dock w={w} />}
      </div>
      <div
        className="absolute text-[11px] uppercase tracking-[0.3em] whitespace-nowrap"
        style={{ bottom: 22, left: 0, right: 0, textAlign: "center", color: "#8b7f6d" }}
      >
        {name}
      </div>
    </div>
  );
}

function Pine({ x, h, fill }: { x: number; h: number; fill: string }) {
  return (
    <svg
      className="absolute"
      style={{ left: x, bottom: 0 }}
      width={h * 0.5}
      height={h}
      viewBox="0 0 40 100"
      preserveAspectRatio="none"
    >
      <rect x="17" y="80" width="6" height="20" fill="#20180f" />
      <path d="M20 0 L38 50 L2 50 Z" fill={fill} />
      <path d="M20 22 L40 74 L0 74 Z" fill={fill} />
    </svg>
  );
}

function Tree({ x, h }: { x: number; h: number }) {
  return (
    <svg className="absolute" style={{ left: x, bottom: 0 }} width={h} height={h} viewBox="0 0 100 100">
      <path d="M46 100 C44 70 40 60 34 48 M54 100 C56 66 60 56 68 44" stroke="#241a12" strokeWidth="7" fill="none" />
      <circle cx="34" cy="38" r="22" fill="#4a2c15" />
      <circle cx="66" cy="34" r="24" fill="#55311a" />
      <circle cx="50" cy="20" r="21" fill="#3d2412" />
      <circle cx="24" cy="52" r="10" fill="#8a3d12" opacity="0.85" />
      <circle cx="74" cy="48" r="8" fill="#a24a15" opacity="0.8" />
    </svg>
  );
}

function Forest({ w }: { w: number }) {
  const trees = useMemo(() => {
    const out: { x: number; h: number; f: string }[] = [];
    for (let i = 0; i < w / 60; i++) {
      out.push({
        x: i * 60 + (i % 3) * 12,
        h: 180 + ((i * 37) % 90),
        f: i % 2 ? "#0f151c" : "#131a22",
      });
    }
    return out;
  }, [w]);
  return (
    <>
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg,rgba(4,6,10,.75),rgba(4,6,10,.25))" }} />
      {trees.map((t, i) => (
        <Pine key={i} x={t.x} h={t.h} fill={t.f} />
      ))}
    </>
  );
}

function Orchard({ w }: { w: number }) {
  const spots = [20, 190, 360, 520];
  return (
    <>
      {spots.map((x, i) => (
        <Tree key={i} x={x} h={150 + (i % 2) * 30} />
      ))}
      {[80, 260, 440].map((x) => (
        <div key={x} className="absolute" style={{ left: x, bottom: 8, fontSize: 12, opacity: 0.9 }}>
          🍂
        </div>
      ))}
    </>
  );
}

function Lantern({ x, h = 120 }: { x: number; h?: number }) {
  return (
    <div className="absolute" style={{ left: x, bottom: 0, height: h, width: 20 }}>
      <div className="absolute bottom-0 left-2 w-[5px] bg-[#1c1a17]" style={{ height: h - 18 }} />
      <div
        className="absolute rounded-sm"
        style={{
          left: -2,
          top: 0,
          width: 13,
          height: 18,
          background: "#ffca6b",
          boxShadow: "0 0 34px 12px rgba(255,180,80,0.35)",
        }}
      />
    </div>
  );
}

function BusStop({ w }: { w: number }) {
  return (
    <>
      <svg className="absolute" style={{ left: 120, bottom: 0 }} width="220" height="150" viewBox="0 0 220 150">
        <rect x="6" y="20" width="8" height="130" fill="#1a1d22" />
        <rect x="196" y="20" width="8" height="130" fill="#1a1d22" />
        <rect x="0" y="8" width="220" height="12" fill="#2a2119" />
        <rect x="16" y="24" width="180" height="6" fill="#1a1d22" />
        <rect x="30" y="30" width="150" height="70" fill="rgba(90,120,140,0.14)" stroke="#1a1d22" />
      </svg>
      <Lantern x={40} />
      <Lantern x={w - 60} />
      <div className="absolute" style={{ left: 300, bottom: 6, fontSize: 15, opacity: 0.5 }}>
        🚏
      </div>
    </>
  );
}

function Chapel() {
  return (
    <>
      <svg className="absolute" style={{ left: 120, bottom: 0 }} width="320" height="290" viewBox="0 0 320 290">
        <path d="M40 290 L40 120 L160 40 L280 120 L280 290 Z" fill="#14161c" stroke="#0a0c10" strokeWidth="3" />
        <rect x="150" y="0" width="20" height="70" fill="#14161c" />
        <path d="M160 -14 L166 6 L154 6 Z" fill="#1d2028" />
        <path d="M150 0 a10 10 0 0 1 20 0" fill="none" stroke="#2b2f38" strokeWidth="3" />
        <path d="M110 290 L110 180 Q160 140 210 180 L210 290 Z" fill="#0a0c12" />
        <path d="M0 290 L0 200 L60 200 L60 290 Z" fill="#111319" />
      </svg>
      <Lantern x={60} h={100} />
      <Lantern x={440} h={100} />
    </>
  );
}

function Graveyard({ w }: { w: number }) {
  const stones = [30, 110, 200, 300, 400, 470];
  return (
    <>
      <div
        className="absolute"
        style={{
          left: 0,
          right: 0,
          bottom: 0,
          height: 90,
          background: "linear-gradient(180deg,rgba(20,26,24,.5),rgba(8,10,10,.9))",
        }}
      />
      {stones.map((x, i) => (
        <svg key={x} className="absolute" style={{ left: x, bottom: 6 }} width="46" height={i % 2 ? 58 : 44} viewBox="0 0 46 58">
          <path d="M4 58 L4 18 Q23 0 42 18 L42 58 Z" fill={i % 3 === 0 ? "#22262c" : "#1b1f24"} />
          <rect x="14" y="20" width="18" height="3" fill="#0d0f12" />
          <rect x="20" y="14" width="6" height="16" fill="#0d0f12" />
        </svg>
      ))}
      <div className="absolute" style={{ left: w - 90, bottom: 4, fontSize: 14, opacity: 0.6 }}>🪦</div>
    </>
  );
}

function Pumpkins({ w }: { w: number }) {
  return (
    <>
      {[40, 130, 250, 330, 460].map((x, i) => (
        <div key={x} className="absolute" style={{ left: x, bottom: 4, fontSize: 26 + (i % 3) * 8 }}>
          🎃
        </div>
      ))}
      <svg className="absolute" style={{ left: 180, bottom: 0 }} width="120" height="180" viewBox="0 0 120 180">
        <rect x="56" y="70" width="8" height="110" fill="#241a12" />
        <rect x="20" y="100" width="80" height="6" fill="#241a12" transform="rotate(-12 60 103)" />
        <circle cx="60" cy="56" r="26" fill="#2a2118" />
        <path d="M34 56 Q60 26 86 56" stroke="#241a12" strokeWidth="8" fill="none" />
      </svg>
    </>
  );
}

function Square({ w }: { w: number }) {
  return (
    <>
      <svg className="absolute" style={{ left: 30, bottom: 0 }} width="230" height="220" viewBox="0 0 230 220">
        <rect x="0" y="90" width="230" height="130" fill="#161821" />
        <path d="M-6 92 L115 20 L236 92 Z" fill="#1d202a" />
        <rect x="34" y="120" width="42" height="60" fill="#0a0c12" />
        <rect x="150" y="120" width="42" height="60" fill="#0a0c12" />
        <rect x="96" y="140" width="38" height="46" fill="#1a1410" />
      </svg>
      {/* the meeting bell frame */}
      <svg className="absolute" style={{ left: w - 210, bottom: 0 }} width="150" height="220" viewBox="0 0 150 220">
        <rect x="10" y="30" width="10" height="190" fill="#241a12" />
        <rect x="128" y="30" width="10" height="190" fill="#241a12" />
        <path d="M0 34 L75 -6 L150 34 Z" fill="none" stroke="#241a12" strokeWidth="10" />
        <path d="M62 44 Q75 20 88 44 Q75 58 62 44 Z" fill="#8a6a2a" />
      </svg>
      {/* well */}
      <svg className="absolute" style={{ left: 330, bottom: 0 }} width="110" height="110" viewBox="0 0 110 110">
        <ellipse cx="55" cy="96" rx="46" ry="10" fill="#0a0c10" />
        <path d="M14 96 L14 46 L96 46 L96 96 Z" fill="#1b1d24" />
        <ellipse cx="55" cy="46" rx="41" ry="9" fill="#05070a" />
        <path d="M8 46 L55 8 L102 46" stroke="#241a12" strokeWidth="7" fill="none" />
      </svg>
      <Lantern x={290} h={130} />
    </>
  );
}

function Sawmill() {
  return (
    <>
      <svg className="absolute" style={{ left: 90, bottom: 0 }} width="420" height="200" viewBox="0 0 420 200">
        <rect x="0" y="70" width="300" height="130" fill="#171a20" />
        <path d="M-6 74 L150 10 L306 74 Z" fill="#20242c" />
        <rect x="330" y="120" width="90" height="12" fill="#2a2118" />
        <circle cx="360" cy="96" r="34" fill="#2b3038" stroke="#0d0f12" strokeWidth="3" />
        <circle cx="360" cy="96" r="6" fill="#0d0f12" />
        <rect x="336" y="150" width="90" height="10" fill="#2a2118" />
      </svg>
      {[20, 60, 100].map((x) => (
        <div key={x} className="absolute" style={{ left: x, bottom: 4, fontSize: 18, opacity: 0.75 }}>
          🪵
        </div>
      ))}
    </>
  );
}

function Dock({ w }: { w: number }) {
  return (
    <>
      <div
        className="absolute"
        style={{
          left: 120,
          right: 0,
          bottom: 0,
          height: 120,
          background: "linear-gradient(180deg,#0a141c 0%,#050a10 100%)",
        }}
      />
      <svg className="absolute" style={{ left: 100, bottom: 0 }} width="260" height="150" viewBox="0 0 260 150">
        <rect x="20" y="40" width="12" height="110" fill="#241a12" />
        <rect x="110" y="40" width="12" height="110" fill="#241a12" />
        <rect x="200" y="40" width="12" height="110" fill="#241a12" />
        <rect x="0" y="30" width="240" height="12" fill="#2f2418" />
        <path d="M40 26 L200 26 L180 8 L60 8 Z" fill="#1c1610" />
      </svg>
      <div className="absolute" style={{ left: 420, bottom: 8, fontSize: 22, opacity: 0.7 }}>⛵</div>
      <Lantern x={40} h={110} />
      <div className="absolute" style={{ left: w - 60, bottom: 10, fontSize: 16, opacity: 0.5 }}>🕸️</div>
    </>
  );
}
