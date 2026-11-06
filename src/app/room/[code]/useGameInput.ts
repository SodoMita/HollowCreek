// Keyboard + pointer input for the game screen: movement keys, chat/interact
// binds, panel-aware Escape handling. Clients only ever send intent.
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { WardPanel } from "@/game/ward-ui";
import type { TimePanel } from "@/game/time-ui";
import type { SettingsDialog } from "@/game/settings-ui";
import { matchesControl, type BindableAction, type GameSettings } from "@/game/settings";
import type { VoiceChat } from "@/game/voice";

export interface GameInputDeps {
  send: (payload: Record<string, unknown>) => void;
  keys: RefObject<Set<string>>;
  lastDir: RefObject<number>;
  computeDir: () => void;
  ensureAudio: () => Promise<void> | void;
  releaseInputs: () => void;
  interactDown: () => void;
  interactUp: () => void;
  openChat: () => void;
  stopInteract: () => void;
  wardPanelRef: RefObject<WardPanel | null>;
  timePanelRef: RefObject<TimePanel | null>;
  settingsDialogRef: RefObject<SettingsDialog | null>;
  chatOpen: boolean;
  chatOpenRef: RefObject<boolean>;
  noteOpenRef: RefObject<boolean>;
  closeNote: () => void;
  getSettingsStore: () => { value: GameSettings };
  getVoice: () => Promise<VoiceChat>;
  pinOpen: boolean;
  setChatOpen: Dispatch<SetStateAction<boolean>>;
  setPinOpen: Dispatch<SetStateAction<boolean>>;
  setPinText: Dispatch<SetStateAction<string>>;
  activateTimepiece: () => void;
  toggleSpyglass: () => void;
}

export function useGameInput(d: GameInputDeps) {
  const { send, keys, lastDir, computeDir, ensureAudio, releaseInputs, interactDown, interactUp, openChat, stopInteract, chatOpen, pinOpen, setChatOpen, setPinOpen, setPinText, activateTimepiece, toggleSpyglass, chatOpenRef, noteOpenRef, closeNote, getSettingsStore, getVoice } = d;
  useEffect(() => {
    const unlockAudio = () => ensureAudio();
    const down = (e: KeyboardEvent) => {
      unlockAudio();
      if (d.settingsDialogRef.current?.isOpen || d.timePanelRef.current?.isOpen) return;
      if (noteOpenRef.current) {
        e.preventDefault(); closeNote(); return; // any key lowers the glass
      }
      if (d.wardPanelRef.current?.isOpen) {
        if (e.code === "Escape") { e.preventDefault(); void send({ action: "ward_cancel" }); }
        return; // Tab, Enter and Space belong to the focused puzzle buttons.
      }
      if (chatOpenRef.current) {
        if (e.key === "Escape") setChatOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
      const controls = getSettingsStore().value.controls;
      const bound = (action: BindableAction) => matchesControl(controls, action, e.code);
      if (bound("left")) { keys.current.add("left"); computeDir(); e.preventDefault(); }
      else if (bound("right")) { keys.current.add("right"); computeDir(); e.preventDefault(); }
      else if (e.code === "KeyM" && !e.repeat) { activateTimepiece(); e.preventDefault(); }
      else if (e.code === "KeyZ" && !e.repeat) { toggleSpyglass(); e.preventDefault(); }
      else if (e.code === "KeyL" && !e.repeat) { void send({ action: "door_lock" }); e.preventDefault(); }
      else if (e.code === "KeyN" && !e.repeat) { setPinOpen((v) => !v); e.preventDefault(); }
      else if (bound("interact") && !e.repeat) { interactDown(); e.preventDefault(); }
      else if (bound("ability") && !e.repeat) { void send({ action: "ability" }); e.preventDefault(); }
      else if (bound("blackout") && !e.repeat) { void send({ action: "blackout" }); e.preventDefault(); }
      else if (bound("push") && !e.repeat) { void send({ cartHeld: true }); e.preventDefault(); }
      else if (bound("drop") && !e.repeat) { void send({ action: "drop_supply" }); e.preventDefault(); }
      else if (bound("ruin") && !e.repeat) { void send({ action: "sabotage" }); e.preventDefault(); }
      else if (bound("chat") && !e.repeat) { openChat(); e.preventDefault(); }
      else if (bound("talk") && !e.repeat) {
        void getVoice().then((voice) => { if (voice.current.active) voice.stop(); else void voice.start(); });
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (d.settingsDialogRef.current?.isOpen || d.timePanelRef.current?.isOpen || d.wardPanelRef.current?.isOpen) return;
      const controls = getSettingsStore().value.controls;
      if (matchesControl(controls, "left", e.code)) { keys.current.delete("left"); computeDir(); }
      else if (matchesControl(controls, "right", e.code)) { keys.current.delete("right"); computeDir(); }
      else if (matchesControl(controls, "interact", e.code)) interactUp();
      else if (matchesControl(controls, "push", e.code)) void send({ cartHeld: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("blur", releaseInputs);
    return () => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", unlockAudio); window.removeEventListener("blur", releaseInputs);
    };
  }, [send, computeDir, ensureAudio, releaseInputs, interactDown, interactUp, openChat, stopInteract, chatOpen, pinOpen, d.wardPanelRef, d.timePanelRef, d.settingsDialogRef, keys, lastDir, setChatOpen, chatOpenRef, noteOpenRef, closeNote, getSettingsStore, getVoice, setPinOpen, setPinText, activateTimepiece, toggleSpyglass]);
}
