# Frontend consolidation: React only on the landing page

## Decisions (human)

1. **Turn 47:** keep the standalone client (`static-src/` → `public/play/`, plain TypeScript, esbuild, no framework runtime) and rewrite the React UI in plain TypeScript.
2. **Turn 49:** remove the `/art` page. Never requested.
3. **Turn 50 (current):** the workspace requires Next.js, so some page must use it. **The landing page `/` keeps React, Next.js, and Tailwind.** Every other page moves to the standalone client. Next.js also keeps serving the API routes.

Consequence: HANDOFF §6.1–6.2 (client parity) no longer applies to the landing page. The standalone client is the only game UI.

## Current state (final, after the room port and merge)

| Route | Where it lives now | Notes |
|---|---|---|
| `/` | React (`src/app/page.tsx`), Tailwind, `lucide-react` | Keeps React, Next.js and Tailwind. Create and join hand off to `/play/?room=CODE`. Links to the Hall of Records (`/play/records.html`). |
| `/play/` | Standalone (`static-src/main.ts`, `index.html`) | Menu and room via `?room=CODE&server=`, with minimap (`static-src/minimap.ts`). End overlay links to `chronicle.html?code=…&server=…` and `records.html?server=…`. |
| `/play/tutorial.html` | Standalone (`static-src/tutorial.ts`, `static-src/tutorial/`) | Offline. Makes no server calls (`smoke-tutorial-static`, 85 same-origin requests). |
| `/play/records.html` | Standalone (`static-src/records.ts`) | Reads `GET /api/game/stats`. |
| `/play/chronicle.html?code=` | Standalone (`static-src/chronicle.ts`) | Reads `GET /api/game/chronicle`, which is sealed (403) until the room ends. |
| `/room/[code]` | Redirect (307) to `/play/?room=:code` | `next.config.ts`. The React room is deleted. |
| `/tutorial` | 404 (no redirect) | The React tutorial is deleted. Use `/play/tutorial.html`. A redirect was not requested. |
| `/art` | Removed | Turn 49. |
| `/stats`, `/chronicle/[code]` | Removed | Turn 50. Replaced by the standalone pages above. |

## Remaining work

1. **Landing.** Keep React, Next.js and Tailwind. Tailwind stays out of scope for unification (human, turn 50).
2. **Open verification.** Click through the end-overlay Chronicle and Records links in a real browser on a finished match. Code is checked; the browser run is not.
3. **Gap, not ported.** About 21 tooltip, aria-label and placeholder strings from the deleted React room. Low value; the behavior is the same.
4. **Release.** Push `main` and `mallow/code-map-hygiene` to `origin`. The merge with `origin/main` (`e4043cc`) is verified on the prod build.

## Smokes

- `scripts/smoke-records.mjs` (new, turn 50): 7 checks, stubbed API, run against a static server over `public/play`. Passes.
- `smoke-art` (art paths, room layout, standalone copies): updated in turn 49.
- All smokes listed in the verification sections now run against the standalone client and the API. `smoke-tutorial` (React) was replaced by `smoke-tutorial-static`.

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

## Room port: done (turn 53)

- The React room (`src/app/room/[code]/`, 13 files) is deleted. The standalone client plays the room at `/play/?room=CODE`. Its minimap is `static-src/minimap.ts` (plain DOM, drawn from the same snapshot, hidden while the spyglass is raised or in the past-time strip on phones). `index.html` has its CSS. The `#tasks` list moves down on phones so it does not sit under the strip.
- The landing page's create and join now navigate to `/play/?room=CODE` (`window.location.assign`). `/room/:code` redirects there (307, `next.config.ts`), so old links keep working.
- Fixed while porting: the standalone end-of-match "Chronicle" and "Records" links pointed at server routes removed in `a12fc98`. They now open `chronicle.html?code=…&server=…` and `records.html?server=…`.
- Checks: `tsc` 0, eslint 0, `npm test` 13/13 DB-free, `npm run build` 0 (no `/room` route; `/` and the API routes remain), `scripts/build-static.mjs` 0. `scripts/smoke-room-static.mjs` against a live prod server on 3100 (with the in-memory rooms, no DB): redirect 307; four-soul town started through the API; landing "Found a new town" and "Join CODE" reach the standalone room; minimap marks equal the snapshot (wards, cages, cart, bell, visible souls); spyglass hides and restores the strip; no cross-origin requests; no runtime errors. 7 + 2 landing checks pass.
- Code size: `src/**/*.ts(x)` is 412,323 bytes (79 files) against the 581,079 baseline at `450020e`. HEAD before this turn was 499,689 bytes (92 files). The "577,151" in earlier notes was stale. `static-src/**/*.ts` adds about 99 KB, so the total is still under the baseline.
- Copy gap (not ported, low value): about 20 tooltip, aria-label and placeholder strings from the React room (for example "Copy town code", "Lower the spyglass (Z, any key, or tap the scene)", the vigor tooltip, the verdict note). The behavior is the same; only the wording differs.
- Still open: `scripts/smoke-time-room-ui.mjs` (React selectors, `/room/` URLs) and `scripts/qa-visual.mjs` (parses `/room/` from the URL) are not rewritten. Both fail against the new routes until ported to `/play/?room=`. The time-travel visit and the ward workbench inside a house are still unverified on the prod build.

## Verification on the production build (turn 53, after the room port)

Run with Postgres 17 (role and DB `hollow`, `drizzle/0000_smart_mongu.sql` applied) and `next build && next start` on port 3000.

- Browser smokes against the standalone client: `smoke-room-static` (new, 9 checks incl. landing create/join), `smoke-time-room-ui` (rewritten: standalone only, 3 sections), `smoke-browser` (includes house puzzles in the practice workbench), `smoke-time-browser` (tutorial timepiece, slider, past repair, consumed item), `smoke-art`, `smoke-replay-observation`, `smoke-voice` (28), `smoke-tutorial-static` (offline, 85 requests all same-origin).
- API smokes: `smoke-static` (CORS, Hall of Records cross-origin), `smoke-doors` (33), `smoke-time` (70), `smoke-wards` (49), `smoke-cages`, `smoke-stats` (rewritten for `/play/records.html` and `/api/game/chronicle`; 39/39), `smoke-random`, `smoke-rooms` (persistence across a server restart; it kills every Next server, so run it last).
- The two previously unverified paths are now covered on the prod build: the timepiece visit (`smoke-time-browser`, `smoke-time-room-ui`) and the ward workbench inside a house (`smoke-browser`).
- **Bug found and fixed (snapshot.ts):** for the first five seconds of a match (until the history crossed a five-second step), `time.latest` was below `time.earliest`. `TimePanel.open()` then returned silently, so the timepiece did nothing. `latest` is now clamped to `earliest`. `smoke-time-room-ui` asserts this right after the start.
- `smoke-qa-visual` (`scripts/qa-visual.mjs`) now reads `?room=` and the standalone settings and tutorial ids. It is not run in this batch.
- Known gap: the soul marks on the minimap were checked with one visible soul in one run only; the test sets exact counts, so it fails if a mark is missing.

## Merge with origin/main (final)

- `origin/main` (`db56696`, Pippa Thistlehop 83: HANDOFF.md review and a `units.ts` change) was merged into `mallow/code-map-hygiene` as `e4043cc`. The merge was clean.
- On the merged tree: `tsc` 0, eslint 0, `npm test` 13/13 DB-free, `next build` 0 (13 API routes, `/` and `/api/game/rooms`; no `/room` route), `scripts/build-static.mjs` 0.
- Preview rebuilt and restarted on port 3000 after the merge. `smoke-room-static` passes; `smoke-time-room-ui` passes; `smoke-stats` 47/47.
- Local `main` fast-forwarded to `e4043cc`.
- Security: the polish channel key remains in git history (Pippa's review). Its owner must rotate it. The GitHub PAT used for the push must be revoked after use.
