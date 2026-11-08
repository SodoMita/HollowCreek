# Frontend consolidation: React only on the landing page

## Decisions (human)

1. **Turn 47:** keep the standalone client (`static-src/` → `public/play/`, plain TypeScript, esbuild, no framework runtime) and rewrite the React UI in plain TypeScript.
2. **Turn 49:** remove the `/art` page. Never requested.
3. **Turn 50 (current):** the workspace requires Next.js, so some page must use it. **The landing page `/` keeps React, Next.js, and Tailwind.** Every other page moves to the standalone client. Next.js also keeps serving the API routes.

Consequence: HANDOFF §6.1–6.2 (client parity) no longer applies to the landing page. The standalone client is the only game UI.

## Current state

| Route | Where it lives now | Notes |
|---|---|---|
| `/` | React (`src/app/page.tsx`), Tailwind, `lucide-react` | Keeps React. It links to the Hall of Records (`/play/records.html`) and to the room and tutorial routes. |
| `/play/` | Standalone (`static-src/main.ts`, `index.html`) | Game menu and room play via `?room=CODE&server=`. Its "Hall of Records" link goes to `records.html`. |
| `/play/records.html` | Standalone (`static-src/records.ts`) | Done (turn 50). Reads `GET /api/game/stats`. |
| `/play/chronicle.html?code=` | Standalone (`static-src/chronicle.ts`) | Done (turn 50). Reads `GET /api/game/chronicle`, which is sealed (403) until the room ends. |
| `/room/[code]` | React (`src/app/room/[code]/*`, about 75 KB) | Still React. The standalone plays the same game, but has no minimap. |
| `/tutorial` | React (`src/app/tutorial/*`, about 60 KB) | Still React. Needs a port to `static-src/tutorial/`. |
| `/art` | Removed | Turn 49. |
| `/stats`, `/chronicle/[code]` | Removed | Turn 50. Replaced by the standalone pages above. |

## Remaining work

1. **Room.** Add the minimap to the standalone client. Point the landing's create and join redirects at `/play/?room=CODE`. Then delete `src/app/room/`.
2. **Tutorial.** Port the eight chapters, the ward surface, the overlay, and the snapshot and time helpers to `static-src/tutorial/`. Then delete `src/app/tutorial/`. Smoke: `smoke-tutorial` (rewrite its selectors for the standalone).
3. **Landing.** Keep React, Next.js, and Tailwind. Only retarget links.
4. **Verify.** Full smoke pass on the prod build (3100). Check that `public/play` still builds with `node scripts/build-static.mjs`. Measure code size against 581,079 B.
5. **Docs.** Update HANDOFF §6.1–6.2, CODE_MAP §4.10, DEPLOY.md, and the READMEs.

## Smokes

- `scripts/smoke-records.mjs` (new, turn 50): 7 checks, stubbed API, run against a static server over `public/play`. Passes.
- `smoke-art` (art paths, room layout, standalone copies): updated in turn 49.
- To rewrite, not just rerun: `smoke-time-room-ui` (6 React selectors), `smoke-browser` (3), `smoke-tutorial` (2), `smoke-time-browser` (2), `smoke-static` (2), `smoke-stats` (3, now for the standalone records page).

## Tutorial port: status (turn 51)

- **Done:** the framework-free logic moved to `static-src/tutorial/` (`chapters.ts`, `tutorial-snapshot.ts`, `tutorial-time.ts`, `tutorial-types.ts`). Commit `8de9010`. The React page imports them from there. An esbuild bundle of these modules contains no React or Next code.
- **Still React:** `src/app/tutorial/TutorialClient.tsx` (716 lines, about 50 state hooks), `TutorialOverlay.tsx` (347 lines, uses `next/link` and `lucide-react`), `WardJobSurface.tsx` (uses `useLayoutEffect`).
- **Plan:** port the state into one plain object with a fixed-step loop and a DOM overlay in `static-src/tutorial.ts` and `tutorial.html`. Keep the existing `Renderer`, `WardPanel`, `TimePanel`, `AudioDirector`, and `SettingsDialog` from `src/game`. Then point the standalone menu's "Singleplayer Tutorial" link at `tutorial.html` (no server URL) and delete `src/app/tutorial/`.
- **Verify:** rewrite `smoke-tutorial` for the standalone selectors. The 29 checks still define the behaviour.

## Tutorial port: done (turn 52)

- `static-src/tutorial.ts` and `static-src/tutorial.html` replace `src/app/tutorial/` (deleted). The controller keeps the old state, input, step loop, render loop, time-travel visit and practice workbench. It uses the same `src/game` modules.
- The standalone menu's "Singleplayer Tutorial" link is `tutorial.html` (no server URL). The landing page and the room overlay link to `/play/tutorial.html`.
- The tutorial bundle (`public/play/tutorial.js`) contains no React or Next code.
- Checks: `scripts/smoke-tutorial-static.mjs` (6 checks, offline: no `/api` calls, walking moves the player, chapter II unlocks, workbench opens and closes, no runtime errors). It passes against a static server over `public/play`.
- Replaced `scripts/smoke-tutorial.mjs` (it tested the React route). `smoke-art`, `smoke-browser` and `smoke-time-browser` now open `/play/tutorial.html`. They still need a run on the prod build with the database.
- Not yet covered by an automated check: the time-travel visit (timepiece, `M`, Return now) and the ward workbench from inside a house. Those paths are ported but untested.
