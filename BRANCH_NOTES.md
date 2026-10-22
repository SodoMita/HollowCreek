# agent-hollow — porting notes

Complete, independently validated implementation of Hollow Creek.
Self-contained: `npm ci && npx drizzle-kit push && npm run build && npm start`.

## What main should take from here

| Concern | File(s) | Why |
| --- | --- | --- |
| **Host handoff** (human's bug #3) | `src/server/engine.ts` → `onSubscribe` / `onUnsubscribe` / `reapDisconnected`, plus `src/app/api/stream/route.ts` | Detects real disconnects from SSE aborts instead of relying on an explicit leave action. A player gets `disconnectedAt`; the host is demoted after an 8s grace and the earliest still-connected player is promoted; fully disconnected players are pruned at 75s and their cage slot freed. Verified by `scripts/smoke-host.mjs`. |
| **Generative score** (bug #2) | `src/lib/audio.ts`, `src/components/AudioDirector.tsx` | Three-layer bed — brown-noise wind through a sweeping bandpass, a detuned string chord bed cycling Dm→Bb→F→Am every 17s, and a sparse music-box motif from the D minor pentatonic through a feedback delay — plus a tension layer (gated 48 Hz heartbeat pulse + detuned choir) faded in and out by game state. Reads server-computed `snapshot.danger` and `blackoutUntil`, so it drops straight onto main's fields. Adds a proximity heartbeat and sparse whispers. |
| **No-scroll HUD** (bug #1) | `src/components/GameClient.tsx`, `src/app/globals.css`, `src/components/WorldScene.tsx` | `html,body{position:fixed;inset:0;overflow:hidden}` with a `100dvh` root, viewport measured from `visualViewport` so mobile URL bars cannot clip it, `env(safe-area-inset-*)` docking, and a `compact` mode (`h<620 \|\| w<780`) that folds the side panels into tap-to-open sheets and shrinks the controls so nothing is ever pushed off-screen. The scene auto-frames: shifts up on short screens, gently down on tall ones. |
| **Recorder robustness** | `src/server/recorder.ts` | Write-behind queue flushed every 700 ms so a slow disk can never stall the 20 Hz loop; `Math.round` on the integer `x` column (a float coordinate made the *entire* insert batch fail and silently lose every kill row); per-row fallback insert so one bad row can never drop a batch again. |
| **Cage key** | `engine.ts` (`interactStart`) | A physical world item: spawns at a random chore, drops where it is used, so the key's location becomes public knowledge after a rescue. |
| **Vision filtering** | `engine.ts` (`visionOf`, `snapshot`) | Players/bodies/bubbles are omitted outside the lantern radius, so a modified client cannot wallhack. Ghosts see everything; caged players still see the square. |

## Interface contract (matches main)

`Snapshot.danger: number` (0..1, server-computed, quantised to 0.2 so it reads as
a feeling rather than a radar), `Snapshot.blackoutUntil: number` (absolute ms),
`You.blackoutCooldownMs: number`. `AudioDirector` consumes all three and falls
back to local inference when `danger` is absent, so it runs on either codebase.

## Tests

```bash
npx next start -p 3100 &
node scripts/smoke.mjs        # 28 end-to-end gameplay checks
node scripts/smoke-host.mjs   # 8 host-handoff / disconnect checks
```

Both must print `ALL CHECKS PASSED` / `HOST HANDOFF PASSED`.
