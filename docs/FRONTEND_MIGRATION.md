# Frontend consolidation: one client, no framework

**Decision (human, Mayfly turn 47):** keep the standalone client (`static-src/` → `public/play/`, plain TypeScript, bundled by esbuild, no framework runtime). Remove the React/Next UI under `src/app/` (pages only). Keep Next.js for the API routes and the database.

This overrides HANDOFF §6.1–6.2 (both clients must agree on movement and prediction) and the React-fallback notes. Once the React UI is gone, that parity rule no longer applies. HANDOFF and CODE_MAP must be updated when the migration lands.

## Current state (measured at `6c25507`)

| Piece | Files | Size | Notes |
|---|---|---|---|
| Standalone client | `static-src/main.ts`, `static-src/index.html` | 44,279 + 22,675 B | Keeps the room game, menu, settings, voice, time, wards, notes. Imports the shared engine from `src/game/*`. |
| Standalone build | `public/play/game.js` | 135,225 B | Committed build output. |
| React UI | `src/app/**/*.tsx`, `*.ts` (pages and components) | 148,808 B of TSX | Six routes plus shared components. |
| Global CSS | `src/app/globals.css` | 5,781 B | Tailwind v4 entry. |
| API | `src/app/api/**/route.ts` | 12 routes | Keep. |

Shared engine (`src/game/*`, `src/game/render/*`, `wards.ts`, `settings.ts`, `time-ui.ts`, `ward-ui.ts`) is framework-free and stays.

## Route inventory

| Route | React source | Standalone today | Plan |
|---|---|---|---|
| `/` | `app/page.tsx` (19.8 KB): lore, rooms list, name field, settings, links to tutorial, stats, art | Has its own menu (`#menu`, `#rooms`, `#tutorial` link) | Merge the React landing's content (lore, rooms list, notice text) into the standalone menu. Decision needed on the look. |
| `/room/[code]` | `GameClient.tsx`, `bars.tsx`, `hud.tsx`, `midhud.tsx`, `minimap.tsx`, `overlays.tsx`, `chat.tsx`, `useGame*.ts` (about 75 KB) | Full game, with no minimap | Add the minimap to the standalone. Check the other HUD pieces against `static-src/main.ts`. |
| `/tutorial` | `TutorialClient.tsx` (29 KB), `TutorialOverlay.tsx`, `WardJobSurface.tsx`, `chapters.ts`, `tutorial-snapshot.ts`, `tutorial-time.ts`, `tutorial-types.ts` (about 60 KB) | Not present; the standalone links to `/tutorial` | Port to `static-src/tutorial/`. Reuse `src/game/wards.ts`, `ward-ui.ts`, `time-ui.ts`, `render`. |
| `/stats` | `stats/page.tsx` (7.4 KB), server-rendered from `db` | Not present | Add the page as static HTML plus a fetch of `GET /api/game/stats` (JSON already exists). |
| `/chronicle/[code]` | `chronicle/[code]/page.tsx` (5.9 KB), server-rendered from `gameEvents` | Not present | Add `GET /api/game/chronicle?code=` (new route, using `chronicleIsOpen`), then a static page that fetches it. |
| `/art` | `art/page.tsx` (4.9 KB) | Not present | **Removed** (human, turn 49): the art library page was never requested. The SVG files stay in `public/art`. |

## Phases

1. **Data endpoints.** DONE: `GET /api/game/chronicle?code=` (`src/app/api/game/chronicle/route.ts`). 400 for a bad code, 403 `{sealed:true}` while the room is live or unknown, 503 `{dbDown:true}` when the DB is unreachable, 200 with events oldest first. Checked by hand on the prod build against a seeded finished room. No automated smoke yet. `GET /api/game/stats` is kept as is.
2. **Stats and chronicle pages** as static pages in `static-src/` that fetch the JSON. Smokes: `smoke-stats`.
3. **Art page** removed (done in turn 49). `smoke-art` no longer checks the library page.
4. **Room HUD parity.** Add the minimap. Walk the React HUD for anything the standalone lacks. Smokes: `smoke-browser`, `smoke-time-room-ui`.
5. **Tutorial.** Port the eight chapters, the ward surface, and the overlay. Smoke: `smoke-tutorial` (29 checks, rewritten for the standalone's selectors).
6. **Landing.** Merge the React landing into the standalone menu. Smoke: `smoke-static`.
7. **Remove the React UI.** Delete `src/app/**/*.tsx`, `globals.css`, the Tailwind and `lucide-react` deps, and `react`/`react-dom` (if nothing else uses them). Keep `src/app/api/**`. Check whether Next still needs `src/app/layout.tsx`. Decide how `/` is served (Next static from `public/`, or a route handler).
8. **Verify.** Full smoke pass on the prod build (3100). Measure code size against 581,079 B. Update HANDOFF §6.1–6.2, CODE_MAP §4.10, DEPLOY.md, and the README files.

## Smokes that touch React UI (must be rewritten, not just rerun)

`smoke-art` (11 references), `smoke-time-room-ui` (6), `smoke-stats` (3), `smoke-browser` (3), `smoke-tutorial` (2), `smoke-time-browser` (2), `smoke-static` (2). Also `test-art-manifest` (3) and `test-render-pixels` (3) reference art paths and may need updating.

## Open questions for the human

- Landing look: keep the React landing layout, or the standalone menu's current design? The React page has lore text and a "Notice" panel.
- `/` routing after removal: serve the standalone `index.html` at `/`, or keep a thin Next route that redirects to `/play`?
