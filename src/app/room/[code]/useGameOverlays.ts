// Overlay chrome for the game screen: settings dialog, ward/time panels, and
// the voice pagehide lifecycle. Callbacks stay in GameClient and arrive as deps.
import { useEffect, type RefObject } from "react";
import { applyDocumentPreferences, type SettingsStore } from "@/game/settings";
import { SettingsDialog } from "@/game/settings-ui";
import { WardPanel } from "@/game/ward-ui";
import { TimePanel } from "@/game/time-ui";
import type { VoiceChat } from "@/game/voice";
import type { AudioDirector } from "@/game/audio";

export interface GameOverlaysDeps {
  send: (payload: Record<string, unknown>) => void;
  getSettingsStore: () => SettingsStore;
  releaseInputs: () => void;
  setSettings: (s: import("@/game/settings").GameSettings) => void;
  setMuted: (m: boolean) => void;
  chatOpen: boolean;
  chatOpenRef: RefObject<boolean>;
  settingsDialogRef: RefObject<SettingsDialog | null>;
  wardPanelRef: RefObject<WardPanel | null>;
  timePanelRef: RefObject<TimePanel | null>;
  voiceRef: RefObject<VoiceChat | null>;
  voiceInitRef: RefObject<Promise<VoiceChat> | null>;
  audioRef: RefObject<AudioDirector | null>;
}

export function useGameOverlays(d: GameOverlaysDeps) {
  const { send, getSettingsStore, releaseInputs, setSettings, setMuted, chatOpen, chatOpenRef, settingsDialogRef, wardPanelRef, timePanelRef, voiceRef, voiceInitRef, audioRef } = d;
  useEffect(() => {
    const goodbye = () => { void voiceRef.current?.stop(); };
    const init = voiceInitRef.current; // captured: refs may change before cleanup runs
    window.addEventListener("pagehide", goodbye);
    return () => {
      window.removeEventListener("pagehide", goodbye);
      init?.then((v) => { v.destroy(); }).catch(() => {});
      voiceRef.current = null;
    };
  }, [voiceRef, voiceInitRef]);

  useEffect(() => {
    const panel = new TimePanel(document.body, { travel: (targetAt) => { void send({ action: "time_travel", targetAt }); }, opened: releaseInputs });
    timePanelRef.current = panel;
    return () => { panel.destroy(); timePanelRef.current = null; };
  }, [releaseInputs, send, wardPanelRef, timePanelRef]);

  useEffect(() => {
    const panel = new WardPanel(document.body, {
      move: (wardId, move) => { void send({ action: "ward_move", wardId, move }); },
      close: () => { void send({ action: "ward_cancel" }); },
      opened: () => releaseInputs(),
    });
    wardPanelRef.current = panel;
    return () => { panel.destroy(); wardPanelRef.current = null; };
  }, [releaseInputs, send, wardPanelRef, timePanelRef]);

  useEffect(() => {
    const store = getSettingsStore();
    setSettings(store.value);
    setMuted(store.value.audio.muted);
    applyDocumentPreferences(store.value);
    const unsubscribe = store.subscribe((next) => {
      setSettings(next);
      setMuted(next.audio.muted);
      applyDocumentPreferences(next);
      voiceRef.current?.applyMix();
    });
    const dialog = new SettingsDialog(store, document.body, { onOpen: releaseInputs });
    settingsDialogRef.current = dialog;
    return () => {
      unsubscribe();
      dialog.destroy();
      settingsDialogRef.current = null;
      audioRef.current?.destroy();
      audioRef.current = null;
    };
  }, [getSettingsStore, releaseInputs, setSettings, setMuted, settingsDialogRef, audioRef, voiceRef]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen, chatOpenRef]);

}
