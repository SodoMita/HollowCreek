// Canvas rendering loop: owns the Renderer, DPR-capped resize (incl. mobile
// visualViewport), and local movement prediction between server snapshots.
import { useEffect, type RefObject } from "react";
import { Renderer } from "@/game/render";
import { CARRY_SPEED, GHOST_SPEED, SPEED, type Snapshot } from "@/game/types";
import type { GameSettings } from "@/game/settings";

/** Shared with the stream hook (arrival of positions) and the input layer (own steering). */
export interface NetState {
  rttMs: number; // smoothed input round trip
  arrival: number; // performance.now() when positions last arrived
  inputs: { t: number; dir: number }[]; // our steering changes, oldest first
}

export interface GameRenderDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<Renderer | null>;
  snapRef: RefObject<Snapshot | null>;
  displayX: RefObject<Map<string, number>>;
  focusRef: RefObject<number | null>;
  lastDir: RefObject<number>;
  netRef: RefObject<NetState>;
  getSettingsStore: () => { value: GameSettings; subscribe: (cb: (n: GameSettings) => void) => () => void };
}

const walkSpeed = (p: { alive: boolean; hasSupply: boolean }) => (!p.alive ? GHOST_SPEED : p.hasSupply ? CARRY_SPEED : SPEED);

/**
 * Where the server will have put us once it has applied every steering change
 * we have already sent: start from the acknowledged position and replay our
 * own input log from (arrival − round trip) to now. Classic reconciliation
 * without sequence numbers — good enough for 1D walking.
 */
function reconcile(serverX: number, spd: number, net: NetState, nowMs: number): number {
  const since = net.arrival - net.rttMs;
  let dir = 0;
  for (const e of net.inputs) if (e.t <= since) dir = e.dir; else break;
  let x = serverX;
  let t0 = since;
  for (const e of net.inputs) {
    if (e.t <= since) continue;
    x += dir * spd * (e.t - t0) / 1000;
    t0 = e.t;
    dir = e.dir;
  }
  return x + dir * spd * (nowMs - t0) / 1000;
}

export function useGameRender(d: GameRenderDeps) {
  const { canvasRef, rendererRef, snapRef, displayX, focusRef, lastDir, netRef, getSettingsStore } = d;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderer = new Renderer();
    rendererRef.current = renderer;
    const store = getSettingsStore();
    renderer.setSettings(store.value);
    let raf = 0;
    let last = performance.now();
    // visualViewport: mobile URL bars otherwise clip the bottom controls
    const vw = () => window.visualViewport?.width ?? window.innerWidth;
    const vh = () => window.visualViewport?.height ?? window.innerHeight;
    const resize = () => {
      const graphics = store.value.graphics;
      const dprCap = graphics.quality === "high" ? 2 : graphics.quality === "medium" ? 1.5 : 1;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * graphics.resolution;
      canvas.width = Math.max(1, Math.round(vw() * dpr));
      canvas.height = Math.max(1, Math.round(vh() * dpr));
      canvas.style.width = `${vw()}px`;
      canvas.style.height = `${vh()}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const unsubscribe = store.subscribe((next) => { renderer.setSettings(next); resize(); });
    resize();
    // visualViewport fires continuously while the mobile URL bar animates — debounce
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resizeTimer = null; resize(); }, 150);
    };
    window.addEventListener("resize", debouncedResize);
    window.visualViewport?.addEventListener("resize", debouncedResize);
    // Frames arrive sparsely now (only when something changes), so the room
    // clock is advanced locally between them; bubbles, countdowns and the
    // bell glow keep moving smoothly. The server's `now` is only ever moved
    // forward, never back.
    let clockSnap: Snapshot | null = null;
    let clockBase = 0;
    let clockAt = 0;
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const s = snapRef.current;
      if (!s) return;
      if (s !== clockSnap) { clockSnap = s; clockBase = s.now; clockAt = nowMs; }
      s.now = Math.max(s.now, clockBase + (nowMs - clockAt));
      const net = netRef.current;
      const age = net.arrival ? Math.min(0.3, (nowMs - net.arrival) / 1000) : 0;
      for (const p of s.players) {
        const cur = displayX.current.get(p.id);
        if (cur === undefined) { displayX.current.set(p.id, p.x); continue; }
        if (p.id === s.self.id && s.phase === "playing" && !s.self.caged) {
          // Move at once on our own input; the server's position only corrects
          // the replayed estimate, so the round trip is never felt as lag.
          const spd = walkSpeed(p);
          const target = reconcile(p.x, spd, net, nowMs);
          let next = cur + lastDir.current * spd * dt;
          next += (target - next) * Math.min(1, dt * 8);
          displayX.current.set(p.id, Math.abs(target - next) > 220 ? target : next);
        } else {
          // Neighbours: carry them on at their last known pace until the next
          // frame lands, then ease onto it — no 100 ms stepping.
          const target = p.x + (p.moving ? p.facing * walkSpeed(p) * age : 0);
          displayX.current.set(p.id, Math.abs(target - cur) > 300 ? p.x : cur + (target - cur) * Math.min(1, dt * 14));
        }
      }
      renderer.setFocus(focusRef.current);
      renderer.render(ctx, vw(), vh(), s, displayX.current, nowMs / 1000, dt);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", debouncedResize);
      window.visualViewport?.removeEventListener("resize", debouncedResize);
    };
  }, [getSettingsStore, canvasRef, rendererRef, snapRef, displayX, focusRef, lastDir, netRef]);
}
