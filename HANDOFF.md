# Hollow Creek — Project Review & Agent Handoff

**Date:** 2026-11-06  
**Baseline commit reviewed:** `0a505d4` (`Merge pull request #5 from SodoMita/merge/velvet-dusk`)  
**Previous handoff replaced:** `2026-10-23` (`d6596e0`, obsolete)

---

## 1. Executive Summary & Delivery State

Hollow Creek is a 1D side-scrolling multiplayer social-deduction horror game set in a fictional Massachusetts mill town (`October, 1893`), built on **Next.js 16.2.6 (App Router) + React 19 + Tailwind CSS v4 + PostgreSQL (Drizzle ORM)** alongside a dependency-free standalone static client (`/play`, compiled from `static-src/`).

PR #5 (`merge/velvet-dusk` @ `818fe3f`) unified two parallel polish branches (`clover59/velvet-dusk-polish` @ `e969a3f` and `pippa/polish-pass` @ `7ee4f70`) onto `main` at `0a505d4`:

- **World & Landmarks:** Widened from `0…4200` (`-2800…7400` in earlier doors) to **`WORLD_MIN = -3600` … `WORLD_MAX = 8600`** (`WORLD_SPAN = 12200` units ≈ `432 m` at `FIGURE_H = 48` = `1.7 m`). Added two outer lockable hideouts (**Ferryman's Hut** at `-3120` and **Watchman's Lodge** at `7980`, with keys and interiors), two outdoor outer wards (`ferry-beacon` at `-3420`, `ridge-cairn` at `7300`), two indoor wards (`ferryman-hearth`, `lodge-clock`) bringing `STATIONS` to **17 total wards** (`min(9, 2 + 2×crew)` active in `room.pool` per match), and a metric white-clapboard meeting house (`MEETING_HOUSE` in `src/game/units.ts`, `8.5 m` nave + belfry + spire).
- **Netcode & Client Prediction:** Replaced full-snapshot 20 Hz SSE broadcasts (420 KB / 5 s idle) with per-viewer field-level delta/patch framing (`src/game/wire.ts`, `src/game/viewers.ts`), a 1 Hz slow-value beat (`stamina`, cooldowns, `nightT`, `danger`, `progress`, `time`), ≤10 Hz coalesced SSE, a `delta=1&wait=1` long-poll fallback used by both React and `/play`, steering-log RTT reconciliation (`useGameRender.ts`, `static-src/main.ts`), capped neighbour extrapolation, and HUD render throttling (~320 B / 5 s idle; ~110 B frames while walking).
- **Visuals, Audio & Camera:** Added `src/game/atmosphere.ts` (moon rays, fireflies, creek glints, foreground reed/cattail parallax, warm/cold soft-light grade, film grain), removed the 100-house backdrop strip (which had fired 100 missing-SVG 404s per load), fixed sprite moonwalking (`lastDrawnX` derives facing/gait from displayed motion), hid falling leaves under `reducedMotion`, reverted the road score to the original drone/pentatonic engine (`src/game/audio.ts`) with Clover's `MusicBox` (`src/game/music-box.ts`) waking only on ward work or past visits, replaced the home page's mock software window with a printed broadside, added a server-filtered `Minimap` (`src/app/room/[code]/minimap.tsx`), and implemented continuous spyglass zoom (`1×…4×` via wheel/pinch, `Z`, or button, with in-world inked page text, any-key dismiss, and a floating **"Lower the glass"** button on mobile without marking `<main>` `inert`).

### Delivery & Repository Status

- **`main` (`0a505d4`):** Up to date, clean `tsc`, clean `eslint .`, clean `next build`, `drizzle-kit push` synced, all 18 unit/DB suites passing.
- **`gh-pages` and itch.io/portal archives:** **Not yet updated** since `v1.2-static` (`f6ffd6a`). `public/play/` is built in `main`, but `SERVERS` in `static-src/main.ts` still points to three expired October 2026 E2B sandboxes.
- **Open GitHub PRs:** `#1` (`nightjar/ward-games -> main`) and `#2` (`nyx/nightwatch-doors -> main`) are stale pre-merge branches that now conflict with `main` and should be closed or rebased only if explicitly requested.
- **Remote Branches:** `main`, `merge/velvet-dusk`, `pippa/polish-pass`, `clover59/velvet-dusk-polish`, `gh-pages`, plus archived/older branches (`agent-hollow`, `develop-archive`, `builder/seamless-side-doors-20261027`, `gloamwing-wards`, `nightjar/ward-games`, `nyx/nightwatch-doors`).

---

## 2. Locked Decisions (`SYNC.md` — Do Not Relitigate)

Read `SYNC.md` and `AGENTS.md` before editing gameplay code. Summary of hard invariants:

1. **Single-process authoritative server:** Active rooms live in memory (`src/game/registry.ts`), backed by Postgres (`rooms`, `room_players`, `game_events`, `player_stats`) for persistence, restart hydration, and chronicle/stats. Never deploy as stateless serverless functions or multi-instance without external coordination.
2. **Last joined player is host:** Every lobby join takes the lantern; leaving/disconnecting promotes the newest remaining player.
3. **Presence = state poll/stream:** `snapshot()` refreshes `lastSeen`. Leave beacon handles tab close; 12 s stale-host handoff and 75 s lobby pruning are safety nets.
4. **No duplicate seats:** Rejoining with the same name after >8 s silence re-adopts the stale seat and returns the canonical `playerId`.
5. **Integer world coordinates (`ix`):** All authoritative positions (`x`, `cartX`, `keyX`, `supplyDrops`, `notes`, `cages`, `bodies`, `doors`) are integers for deterministic replay (`scripts/test-replay-determinism.mjs`). Client rendering interpolates smoothly in `displayX`.
6. **Server-side vision occlusion:** `snapshot.ts` omits/masks out-of-vision players (`VISION_CREW = 420`, `VISION_HOLLOW = 620`, `VISION_BLACKOUT = 190`, same `inside` house only), bodies, kits, keys, door states, loose timepieces, and pinned pages. Darkness mask is never optional in client settings.
7. **Shared ward pool & Vigor hysteresis:** `room.pool` holds `min(9, 2 + 2×crew)` shared wards; working drains `0.10/s`, slows below `0.30`, and `exhausted` locks ward work until idle regen reaches `0.20`. Actions (kill/bell/blackout/unlock) are not refused at 0 vigor.
8. **Chronicle sealed mid-match:** `/chronicle/[code]` refuses access while `playing` or `meeting` (`src/game/chronicle-access.ts`); no chronicle link in the in-game top bar.

---

## 3. Architecture & Module Map

### Core Engine (`src/game/`)
- `engine.ts` — Core interfaces (`Room`, `P`, etc.), barrel re-exports, `bindEngineHooks()`.
- `types.ts` — Wire contracts (`Snapshot`, `InputBody`, `PublicPlayer`, `SelfInfo`, `TaskView`, `Note`, `TimeView`), `STATIONS` (17 wards), `CAGE_XS`, `PLAYER_COLORS`. Note: `WORLD_W = 4200` is still exported here and used for lobby/match player spawn bounds (`300…3900` in `actions.ts`) and cage clamping (`rules.ts`).
- `balance.ts` — Authoritative speeds, cooldowns, ranges, vision radii, vigor costs, cart physics, timepiece timing (`TICK_MS = 50`).
- `units.ts` — Single spatial scale module (`FIGURE_H = 48` = `1.7 m`, `UNITS_PER_M ≈ 28.24`, `m()`, `units()`, `metres()`, `WORLD_MIN = -3600`, `WORLD_MAX = 8600`, `ZOOM_DEFAULT = 1`, `ZOOM_READ = 3.2`, `ZOOM_MAX = 4`, `NOTE_FAR`, `NOTE_NEAR`, `MEETING_HOUSE`, `TREE_SPACING`).
- `buildings.ts` — 6 enterable buildings (`ferryman`, `orchard`, `tollhouse`, `foreman`, `quarry`, `lodge`), `doorX()`, `treeX()` (`TREE_MIN = -11` to `TREE_MAX = 72`), `snapAnchor()`, `interactWithBuilding()`, `walkThroughBuildings()`, `dropBuildingKeys()`.
- `wards.ts` & `recovered-wards.ts` — 13 ward puzzle mechanics (`pumpkins`, `well`, `scarecrow`, `lantern`, `chapel`, `mill`, `graves`, `radio`, `silo`, `hearth`, `pantry`, `clock`, `fusebox`), deterministic seeding, server move validation.
- `actions.ts` & `rules.ts` & `tick.ts` — Room lifecycle (`createRoom`, `joinRoom`, `startGame`, `restartGame`, `leaveRoom`), `handleInput()`, 20 Hz simulation tick, supply cart, bodies, cages, meetings, voting, win conditions.
- `time-travel.ts`, `timepieces.ts`, `history.ts` — 500 ms history checkpoints, past visits (`TIME_VISIT_MS = 60_000`), nested time travel, command replay, historical echoes, note write-back from past to present.
- `snapshot.ts` & `fingerprint.ts` — Per-viewer vision-filtered snapshot builder, quantized slow fields (`nightT` to `0.001`, cooldowns to `1000 ms`, `progress` to `0.01`, `time.latest` to `5000 ms`), FNV-1a ETag caching (`roomEtag`).
- `wire.ts` & `viewers.ts` — Delta/patch wire protocol (`encodeView`, `diffView`, `applyFrame`, `frameTouchesPlayers`) and per-viewer state (`nextFrame`, `waitForFrame`, `SLOW_MS = 1000`, `FRAME_MS = 100`).
- `chronicle.ts`, `persistence.ts`, `registry.ts`, `stats.ts`, `chronicle-access.ts` — Write-behind DB flush (900 ms), room hydration on restart, event journaling, `player_stats` ledger.
- `voice.ts` & `voice-range.ts` — WebRTC peer-to-peer proximity voice with stereo panning, iron-cage muffling, and separate ghost realm.

### Rendering & Audio (`src/game/`)
- `render.ts` (**56,004 B — over 50 KB guideline**) — Main canvas `Renderer`: sky/night cycle, moon, hills, foreground trees, buildings, stations, cart, cages, players (with `lastDrawnX` moonwalk fix), in-world inked notes, darkness/lantern mask, vignette, `viewZoom` + `focusX` + `lift`.
- `atmosphere.ts` — Extracted decorative layers: `drawStreetDressing`, `drawMoonRays`, `drawFireflies`, `drawCreekGlints`, `drawForeground`, `drawGrade`, `makeGrainTile`.
- `house-art.ts`, `ward-art.ts`, `svg-assets.ts`, `town.ts` — Cutaway house interiors, broken ward overlays, cached SVG loader (`public/art/`), `public/art/town/houses.json` manifest.
- `audio.ts` & `music-box.ts` — Procedural WebAudio score (`AudioDirector`) + `MusicBox` (active on ward work or past visits).
- `settings.ts`, `settings-ui.ts`, `ward-ui.ts`, `time-ui.ts`, `focus-trap.ts` — Client preferences (`hc_settings_v1`) and vanilla DOM modal controllers shared between React and `/play`.

### App Routes & Clients (`src/app/` & `static-src/`)
- `src/app/page.tsx` — Landing page with 1893 printed broadside, create/join room, live open-towns list, Settings/Tutorial/Records/Art links.
- `src/app/room/[code]/` — `GameClient.tsx`, `useGameStream.ts`, `useGameInput.ts`, `useGameRender.ts`, `useGameOverlays.ts`, `bars.tsx`, `hud.tsx`, `midhud.tsx`, `minimap.tsx`, `overlays.tsx`, `chat.tsx`, `loading.tsx`.
- `src/app/tutorial/TutorialClient.tsx` (**53,471 B — over 50 KB guideline**) — 8-chapter offline singleplayer tutorial + Practice Any Ward modal.
- `src/app/stats/page.tsx` — Hall of Records leaderboard (`/api/game/stats`).
- `src/app/chronicle/[code]/page.tsx` — Town Chronicle event log (sealed mid-match).
- `src/app/art/page.tsx` — Editable SVG asset gallery (`/art`).
- `src/app/api/health/route.ts` — `GET /api/health` (`SELECT 1` + optional `ensurePolishWorker()`).
- `static-src/main.ts` & `static-src/index.html` — Standalone client compiled to `public/play/` via `node scripts/build-static.mjs`.

---

## 4. Verification Baseline on `main` (`0a505d4`)

All checks below were executed directly against `main @ 0a505d4` with PostgreSQL running:

| Check | Command | Outcome | Notes |
| --- | --- | --- | --- |
| Typegen & TypeScript | `npx next typegen && npm exec tsc -- --noEmit` | **PASS** | 0 errors |
| ESLint | `npm run lint` | **PASS** | 0 errors, 0 warnings |
| Production build | `npm run build` | **PASS** | All 8 pages + 13 API routes |
| Unit & DB suites (18) | `DATABASE_URL=… npm test` | **18/18 PASS** | Includes `test-notes`, `test-time-*`, `test-replay-determinism`, `test-house-wards`, `test-voice*` |
| Audio analysis | `node scripts/analyze-audio.mjs` | **PASS** | Peak `-9.5 dBFS`, RMS `-22 dBFS`, 0 clips |
| Wire delta protocol | `node scripts/test-wire.mjs` | **PASS** | 46/46 SSE + 33/33 long-poll ETag matches |
| Live API smokes | `smoke-doors` (33), `smoke-wards` (49), `smoke-cages` (29), `smoke-voice` (28), `smoke-time` (70), `smoke-stats` (47), `smoke-tutorial` (29), `smoke-random` (60 ticks), `smoke-replay-observation` | **ALL PASS** | Against `next start` |
| Room persistence | `PORT=3100 BASE=http://127.0.0.1:3100 node scripts/smoke-rooms.mjs` | **PASS** | Survives server restart + concurrent joins |
| Cross-origin static | `node scripts/smoke-static.mjs http://127.0.0.1:3000 8090 public/play` | **PASS** | CORS + full round on `public/play` |
| Browser smokes | `smoke-browser.mjs`, `smoke-art.mjs`, `qa-visual.mjs` | **PASS** | 0 console/page errors, 0 mobile overflow |
| **Time UI browser smoke** | `node scripts/smoke-time-room-ui.mjs http://127.0.0.1:3000` | **FAIL** | See Bug #1 below |
| **Time tutorial smoke** | `node scripts/smoke-time-browser.mjs http://127.0.0.1:3000` | **FAIL** | See Bug #2 below |
| **House asset provenance** | `node scripts/test-house-assets.mjs` | **FAIL** | Expects external `../../malye-korely/photos/` dir outside repo |

---

## 5. Known Bugs, Technical Debt & Priority Next Tasks

### Priority 1 — Fix the Two Failing Browser Smoke Scripts (Small, Immediate)
1. **`NoteReader` missing author in `.sr-only` text (`src/app/room/[code]/hud.tsx`):**
   - **Cause:** `NoteReader` puts `note.author` inside `aria-label`, while `<span className="sr-only">{note.text}</span>` omits the author. `scripts/smoke-time-room-ui.mjs:81` checks `reader.textContent()` for `noteRoom.name` (`"the page names its author"`) and fails.
   - **Fix:** Render `<span className="sr-only">{note.author ? `${note.text} — pinned by ${note.author}` : note.text}</span>` inside `NoteReader` in `src/app/room/[code]/hud.tsx`.
2. **Stale ward count regex in `scripts/smoke-time-browser.mjs`:**
   - **Cause:** `STATIONS` now has 17 wards (up from 13), so `TutorialClient` shows `Repaired Wards: 1 / 17`, failing `assert.match(..., /1\s*\/\s*13/)`.
   - **Fix:** Update the regex in `scripts/smoke-time-browser.mjs` to `/1\s*\/\s*17/` (or derive from `STATIONS.length`).

### Priority 2 — Split Files Exceeding the 50 KB Repo Rule (`AGENTS.md`)
`AGENTS.md` specifies: *"Avoid files bigger than 50Kb in repo."* Two source files currently exceed 50 KB:
1. **`src/game/render.ts` (`56,004 B`, 1,164 lines):** Extract `drawStation()` (~235 lines, lines 930–1163) into `src/game/station-art.ts` (matching `atmosphere.ts`, `house-art.ts`, `ward-art.ts`).
2. **`src/app/tutorial/TutorialClient.tsx` (`53,471 B`, 1,246 lines):** Extract the `CHAPTERS` data and tutorial simulated snapshot builder into `src/app/tutorial/chapters.ts`.

### Priority 3 — Finish the Metric Conversion (`src/game/units.ts`)
- `units.ts` defines `FIGURE_H = 48` (`UNITS_PER_M ≈ 28.24`), `m()`, `units()`, `metres()`, and `MEETING_HOUSE`, **but only the meeting house uses it**.
- Convert remaining raw pixel constants in `house-art.ts` (`WALL_HEIGHT = 112`, `ROOF_HEIGHT = 158`), `render.ts` (cages, bell tower, notes, tree heights), and `atmosphere.ts` (lantern posts, windmills, fences, gravestones, haystacks) to `m(...)` / `units(...)` in `units.ts`.
- Clarify `WORLD_W = 4200` in `src/game/types.ts` (e.g., alias or comment `TOWN_SPAWN_MAX = 4200` so future agents don't confuse it with `WORLD_SPAN = 12200`).

### Priority 4 — Client Parity, UI Token Adoption & Period Lore Polish
1. **Tutorial & Standalone parity:**
   - `TutorialClient.tsx` lacks the `Minimap` and the wheel/pinch/`Z` spyglass zoom that `GameClient.tsx` has.
   - `static-src/` (`/play`) lacks the `Minimap` strip. Also, `SERVERS` in `static-src/main.ts` lists three expired October 2026 E2B URLs — replace with a permanent backend URL before running `node scripts/build-static.mjs` and publishing to `gh-pages` / itch.io.
2. **UI token adoption (`src/app/globals.css`):**
   - Shared tokens (`bg-panel`, `border-line`, `text-parchment`, `text-amber`, `text-gold`, `bg-ember`, etc.) and `.hc-btn` / `.hc-panel` / `.hc-modal` / `.hc-input` / `.hc-toast` exist in `globals.css`, but `overlays.tsx` (74 raw hex values), `stats/page.tsx` (37 raw hex), `chronicle/[code]/page.tsx` (24 raw hex), `midhud.tsx`, `chat.tsx`, and `bars.tsx` still use hardcoded hex classes.
3. **Art Library completeness (`src/app/art/page.tsx`):**
   - Add the new facades (`house/facade-ferryman.svg`, `house/facade-lodge.svg`) and street props (`props/windmill.svg`, `props/gravestone.svg`, `props/haystack.svg`, `props/creek-bridge.svg`, `props/fence.svg`, `props/lantern-post.svg`, `props/woodpile.svg`) to the gallery groups.
4. **Period consistency (1893 Massachusetts vs. 18th-century lore):**
   - `town.ts` says *"fictional Massachusetts mill town"* and `page.tsx` / `static-src/index.html` say `October, 1893`, while `types.ts` still has a `"radio"` ward (`"Repair the radio tower"` — Marconi's wireless was post-1895) and `"fusebox"`. If the human confirms shifting to 18th-century or strict 1893 New England, replace `"radio"` / `"fusebox"` in `STATIONS`, `wards.ts`, `ward-ui.ts`, and `ward-art.ts` with period-fitting wards (e.g., semaphore/signal beacon, mill sluice/bell-pull).
5. **Wire optional-field cleanup (`src/game/wire.ts`):**
   - In `applyFrame()`, if an optional property on `PublicPlayer` or `TaskView` transitions from defined to `undefined`, `diffView` sends `null` and `{ ...it, ...part }` leaves the key set to `null`. Currently safe because all `PublicPlayer` fields are always emitted (nullable rather than omitted), and `room.temporalShadow` is immutable per room, but deleting keys on `null` for optional-undefined fields (or typing them explicitly nullable) makes `applyFrame` strictly round-trip arbitrary snapshots.
6. **Housekeeping:**
   - Remove leftover scratch dotfiles in `scripts/` (`.mobile-check.mjs`, `.mobile-check2.mjs`, `.mobile-shot.mjs`, `.mse.mjs`, `.shot-svg.mjs`, `.smoke-pages.mjs`, `.smoke-refactor.mjs`).
   - Update or gate `scripts/test-house-assets.mjs` so it does not require an external `../../malye-korely/` directory outside the repository.
   - Close stale GitHub PRs `#1` and `#2` (with human/maintainer approval).
