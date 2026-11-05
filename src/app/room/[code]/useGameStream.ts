// Join + state streaming for the game screen: joins the room, prefers the SSE
// push stream, and falls back to the adaptive 304 poll (with re-join on 404s).
import { useEffect, type RefObject } from "react";
import type { Snapshot } from "@/game/types";
import { expandSnapshot, feedCursor, newWireCache, type WireSnapshot } from "@/game/wire";
import type { WardPanel } from "@/game/ward-ui";
import type { TimePanel } from "@/game/time-ui";
import type { SettingsDialog } from "@/game/settings-ui";
import type { AudioDirector } from "@/game/audio";

export interface GameStreamDeps {
  code: string;
  send: (payload: Record<string, unknown>) => void;
  getPid: () => string;
  setJoinError: (e: string | null) => void;
  setSnap: (s: Snapshot) => void;
  setRoleBanner: (b: string | null) => void;
  snapRef: RefObject<Snapshot | null>;
  pendingInputRef: RefObject<Record<string, unknown> | null>;
  mainRef: RefObject<HTMLElement | null>;
  wardPanelRef: RefObject<WardPanel | null>;
  timePanelRef: RefObject<TimePanel | null>;
  settingsDialogRef: RefObject<SettingsDialog | null>;
  noteOpenRef: RefObject<boolean>;
  audioRef: RefObject<AudioDirector | null>;
  lastPhase: RefObject<string>;
  leavingRef: RefObject<boolean>;
}

export function useGameStream(d: GameStreamDeps) {
  const { code, send, getPid, setJoinError, setSnap, setRoleBanner } = d;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null; // SSE connection, closed by the cleanup below
    (async () => {
      const name = localStorage.getItem("hc_name") || "Stranger";
      const doJoin = async (): Promise<boolean> => {
        try {
          const res = await fetch("/api/game/join", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code, playerId: getPid(), name }),
          });
          const data = await res.json();
          if (!alive) return false;
          if (!res.ok || !data.ok) { setJoinError(data.error ?? "Could not enter the town."); return false; }
          // the server may re-adopt a stale seat under our name — use its canonical id
          if (data.playerId && data.playerId !== getPid()) localStorage.setItem("hc_pid", data.playerId);
          return true;
        } catch { return false; }
      };
      if (!(await doJoin())) return;
      let inflight = false;
      let failures = 0;
      let delay = 100;
      let lastFp = "";
      let lastShownNow = 0;
      let lastRev = ""; // server fingerprint of the last state we hold
      let notFound = 0; // consecutive 404s — after 3, the server lost us (restart): re-join
      let polling = false;
      const wire = newWireCache(); // feed lines + far note text arrive once, then live here

      const handleSnap = (s: Snapshot, etag: string) => {
        if (!alive) return;
        failures = 0;
        notFound = 0;
        if (etag) lastRev = etag;
        d.snapRef.current = s;
        if (d.pendingInputRef.current) { const retry = d.pendingInputRef.current; d.pendingInputRef.current = null; void send(retry); }
        d.mainRef.current?.toggleAttribute("inert", !!(d.wardPanelRef.current?.isOpen || d.timePanelRef.current?.isOpen || d.settingsDialogRef.current?.isOpen || d.noteOpenRef.current));
        if (d.timePanelRef.current?.isOpen && (!s.self.hasTimepiece || s.phase !== "playing")) d.timePanelRef.current.close();
        d.wardPanelRef.current?.update(s.minigame, s.self.stamina, s.self.exhausted);
        // Skip the React re-render when nothing but the clock changed (idle players cost ~nothing then).
        const fp = JSON.stringify({ ...s, now: 0 });
        if (fp !== lastFp || s.now - lastShownNow >= 900) {
          lastFp = fp; lastShownNow = s.now;
          setSnap(s);
        }
        d.audioRef.current?.update(s);
        if (d.lastPhase.current === "lobby" && s.phase === "playing") {
          setRoleBanner(s.self.role === "hollow" ? "hollow" : "crew");
          setTimeout(() => setRoleBanner(null), 4500);
        }
        d.lastPhase.current = s.phase;
      };

      // Fallback path: the original adaptive poll (also used if SSE fails).
      const tick = async () => {
        if (inflight) return; // never stack overlapping state fetches
        inflight = true;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const revParam = lastRev ? `&rev=${encodeURIComponent(lastRev)}` : "";
          const r = await fetch(`/api/game/state?code=${code}&playerId=${getPid()}&c=1&f=${feedCursor(wire)}${revParam}`, { signal: controller.signal });
          if (r.status === 304) { failures = 0; return; } // unchanged — skip the payload entirely
          if (r.status === 404) {
            failures++;
            if (++notFound >= 3) { notFound = 0; await doJoin(); } // server restarted — reclaim the seat
            return;
          }
          if (!r.ok) { failures++; return; }
          const etag = r.headers.get("etag") ?? "";
          const s = expandSnapshot(await r.json() as WireSnapshot, wire);
          handleSnap(s, etag);
        } catch { failures++; } // retry with backoff below
        finally { clearTimeout(timeout); inflight = false; }
      };
      const startPolling = () => {
        if (polling) return;
        polling = true;
        timer = setInterval(() => {
          // adaptive: 100ms while healthy, up to 8s with jitter after repeated failures or when hidden
          const hidden = typeof document !== "undefined" && document.hidden;
          const base = failures >= 3 || hidden ? Math.min(1000 * 2 ** Math.min(Math.max(failures - 3, 0), 3), 8000) : 100;
          const want = Math.round(base * (0.8 + Math.random() * 0.4)); // jitter avoids thundering herd
          if (want !== delay) { delay = want; if (timer) clearInterval(timer); timer = setInterval(tick, delay); }
          void tick();
        }, 100);
        void tick();
      };

      // Preferred path: server push over SSE. If it never delivers (or dies),
      // close it and fall back to the adaptive poll above.
      let gotPush = false;
      es = new EventSource(`/api/game/state/stream?code=${encodeURIComponent(code)}&playerId=${encodeURIComponent(getPid())}&c=1`);
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { etag?: string; snap?: WireSnapshot; gone?: boolean };
          if (msg.gone) { void doJoin(); return; }
          if (msg.snap) { gotPush = true; handleSnap(expandSnapshot(msg.snap, wire), msg.etag ?? ""); }
        } catch { /* malformed frame — ignore */ }
      };
      const dropToPolling = () => {
        if (es) { es.close(); es = null; }
        startPolling();
      };
      es.onerror = dropToPolling;
      const watchdog = setTimeout(() => { if (!gotPush) dropToPolling(); }, 4000); // SSE unsupported/blocked → poll
      void watchdog;
    })();
    const bye = () => {
      if (d.leavingRef.current) return; // explicit leave already freed the seat
      try {
        navigator.sendBeacon(
          "/api/game/leave",
          new Blob([JSON.stringify({ code, playerId: getPid() })], { type: "application/json" })
        );
      } catch { /* noop */ }
    };
    window.addEventListener("pagehide", bye);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      es?.close();
      window.removeEventListener("pagehide", bye);
      if (!d.leavingRef.current) void send({ dir: 0, interactHeld: false, cartHeld: false });
      bye();
    };
  }, [code, send, getPid, setJoinError, setSnap, setRoleBanner, d.audioRef, d.lastPhase, d.leavingRef, d.mainRef, d.noteOpenRef, d.pendingInputRef, d.settingsDialogRef, d.snapRef, d.timePanelRef, d.wardPanelRef]);
}
