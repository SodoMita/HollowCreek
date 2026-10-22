"use client";

import { useEffect, useRef } from "react";
import type { Snapshot } from "@/lib/game-types";
import { nudgeChoir, setTension, sfx } from "@/lib/audio";

/**
 * Reads the authoritative snapshot and drives the generative score:
 * tension rises when the dark is close, bodies are near, or the bell is
 * dragging everyone to the square. Also fires the proximity heartbeat and
 * the occasional whisper so the town is never quite silent.
 */
export default function AudioDirector({ snap }: { snap: Snapshot }) {
  const lastBeat = useRef(0);
  const lastWhisper = useRef(0);
  const lastNear = useRef(0);

  useEffect(() => {
    const t = snap.now;
    const you = snap.you;

    // ghosts have no heartbeat
    let tension = 0;
    if (you.ghost) tension = 0.08;
    else if (you.role === "impostor") tension = 0.12;
    else tension = 0.05;

    // server-computed dread is authoritative when present
    tension = Math.max(tension, snap.danger ?? 0);
    if (you.dark) tension += 0.25;
    if (snap.phase === "meeting") tension += snap.meeting?.stage === "travel" ? 0.25 : 0.15;
    if (snap.bodies.length) tension += 0.3 * snap.bodies.length;

    // how alone are you?
    const near = snap.players.filter((p) => !p.isYou && p.alive && !p.caged).length;
    if (near === 0 && snap.phase === "playing") tension += 0.22;
    if (near >= 4) tension += 0.08;
    lastNear.current = near;

    if (snap.phase === "ended") tension = snap.winner === "crew" ? 0 : 0.5;

    setTension(tension);
    if (you.dark) nudgeChoir(-5);
    else if (snap.phase === "meeting") nudgeChoir(2);
    else nudgeChoir(0);

    // heartbeat driven by the server's dread value (falls back to proximity)
    const closest = snap.players
      .filter((p) => !p.isYou && p.alive)
      .reduce((m, p) => Math.min(m, Math.abs(p.x - you.x)), 99999);
    const dread = Math.max(snap.danger ?? 0, closest < 240 ? 0.5 : 0);
    if (you.alive && dread >= 0.4 && t - lastBeat.current > 1100) {
      lastBeat.current = t;
      sfx.heartbeat();
    }

    // sparse whispers
    if (t - lastWhisper.current > 13000 && Math.random() < 0.5) {
      lastWhisper.current = t;
      sfx.whisper();
    }
  }, [snap]);

  return null;
}
