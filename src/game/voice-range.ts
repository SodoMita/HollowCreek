// Server-owned spatial rules. Clients receive only gain and pan, never world
// coordinates through the voice API. Pure so range/realm behavior is testable.
export const VOICE_EARSHOT = 700;
const FULL_VOLUME_TO = 75;

/** Comprehensive worldwide public STUN servers across different providers, ports, and protocols. */
export const EXPANDED_ICE_SERVERS: { urls: string; username?: string; credential?: string }[] = [
  // Google public STUN clusters (multiple ports & IPs)
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  // Cloudflare STUN
  { urls: "stun:stun.cloudflare.com:3478" },
  // Nextcloud STUN (ports 443 & 3478)
  { urls: "stun:stun.nextcloud.com:443" },
  { urls: "stun:stun.nextcloud.com:3478" },
  // Mozilla STUN
  { urls: "stun:stun.services.mozilla.com:3478" },
  // Matrix.org STUN (port 443)
  { urls: "stun:stun.matrix.org:443" },
  // Global open STUN endpoints
  { urls: "stun:stun.voipbuster.com:3478" },
  { urls: "stun:stun.voiparound.com:3478" },
  { urls: "stun:stun.sipgate.net:3478" },
  { urls: "stun:stun.ekiga.net:3478" },
  { urls: "stun:stun.ideasip.com:3478" },
  { urls: "stun:stun.schlund.de:3478" },
  { urls: "stun:stun.12connect.com:3478" },
  { urls: "stun:stun.12voip.com:3478" },
  { urls: "stun:stun.freecall.com:3478" },
  { urls: "stun:stun.antisip.com:3478" },
];

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
