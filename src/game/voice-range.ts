// Server-owned spatial rules. Clients receive only gain and pan, never world
// coordinates through the voice API. Pure so range/realm behavior is testable.
export const VOICE_EARSHOT = 700;
const FULL_VOLUME_TO = 75;

export function voiceCanHear(listenerAlive: boolean, speakerAlive: boolean): boolean {
  return listenerAlive === speakerAlive; // ghost voices remain with the dead
}
export function voiceGainFor(distancePx: number, listenerCaged = false, speakerCaged = false): number {
  if (!Number.isFinite(distancePx) || distancePx < 0 || distancePx >= VOICE_EARSHOT) return 0;
  const fade = distancePx < FULL_VOLUME_TO ? 1
    : Math.pow((VOICE_EARSHOT - distancePx) / (VOICE_EARSHOT - FULL_VOLUME_TO), 2);
  const muffle = (listenerCaged ? 0.65 : 1) * (speakerCaged ? 0.65 : 1);
  return Math.round(fade * muffle * 1000) / 1000;
}
export function voicePanFor(dx: number): number {
  if (!Number.isFinite(dx)) return 0;
  return Math.round(Math.max(-1, Math.min(1, dx / 700)) * 1000) / 1000;
}
