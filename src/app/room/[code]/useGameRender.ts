// Canvas rendering loop: owns the Renderer, DPR-capped resize (incl. mobile
// visualViewport), and local movement prediction between server snapshots.
import { useEffect, type RefObject } from "react";
import { Renderer } from "@/game/render";
import { CARRY_SPEED, GHOST_SPEED, SPEED, type Snapshot } from "@/game/types";
import type { GameSettings } from "@/game/settings";

export interface GameRenderDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<Renderer | null>;
  snapRef: RefObject<Snapshot | null>;
  displayX: RefObject<Map<string, number>>;
  focusRef: RefObject<number | null>;
  lastDir: RefObject<number>;
  getSettingsStore: () => { value: GameSettings; subscribe: (cb: (n: GameSettings) => void) => () => void };
}

export function useGameRender(d: GameRenderDeps) {
  const { canvasRef, rendererRef, snapRef, displayX, focusRef, lastDir, getSettingsStore } = d;
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
    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const s = snapRef.current;
      if (!s) return;
      for (const p of s.players) {
        const cur = displayX.current.get(p.id);
        if (cur === undefined || Math.abs(cur - p.x) > 300) { displayX.current.set(p.id, p.x); continue; }
        if (p.id === s.self.id && s.phase === "playing" && !s.self.caged) {
          // Local prediction at the authoritative speed; the server poll only
          // corrects drift, so movement no longer lags behind the input.
          const spd = !s.self.alive ? GHOST_SPEED : s.self.hasSupply ? CARRY_SPEED : SPEED;
          const pred = cur + lastDir.current * spd * dt;
          displayX.current.set(p.id, Math.abs(p.x - pred) > 90 ? p.x : pred + (p.x - pred) * Math.min(1, dt * 25));
        } else {
          displayX.current.set(p.id, cur + (p.x - cur) * Math.min(1, dt * 16));
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
  }, [getSettingsStore, canvasRef, rendererRef, snapRef, displayX, focusRef, lastDir]);
}
