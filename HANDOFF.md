# Hollow Creek — Project Review & Agent Handoff

**Date:** 2026-11-06  
**Baseline reviewed:** `0a505d4` (`Merge pull request #5 from SodoMita/merge/velvet-dusk`)  
**This document is the union of two independent reviews** of that merge, written
by the two agents who produced it — Clover59 (architecture, module map, debt
list) and Pippa Thistlehop 83 (operating notes, netcode contracts, environment
traps, verification re-run). Where the two disagreed, the re-run results below
win. The two bugs both reviews found independently are **fixed on `main` at
`0b9eb22`**.  
**Previous handoff replaced:** `2026-10-23` (`d6596e0`, obsolete)

---

## Read this first — agent operating notes

- **Talk before you touch.** `AGENTS.md` has the current mayfly dev channel.
  Read it at the start of every turn, claim work, post your branch SHA at the
  end, and say goodbye before you stop listening. Two agents editing the same
  files without talking is how this branch briefly had two spyglasses and two
  incompatible wire formats.
- **Branch → PR → `main`.** `SYNC.md` is the unification protocol: `main` is the
  single source of truth and every sandbox must end identical to it. After a
  merge: `git fetch origin && git reset --hard origin/main && git clean -fdx
  -e .env -e node_modules && npm ci && npx drizzle-kit push --force`.
- **Run local servers on port 3100, not 3000.** Port 3000 belongs to the
  platform-managed preview; a local `next start` there is displaced and dies
  mid-suite (a health check succeeds, then every request gets `ECONNREFUSED`).
  Every smoke script takes the base URL as `argv[2]`, and most also read `BASE`.
- **Only the project directory survives between turns.** `.next/` is wiped
  (rebuild before `next start`), `/tmp` scratch is wiped, and
  `~/.cache/ms-playwright` may be gone. Keep reusable scratch tooling under
  `.cache/` (gitignored) — that is where the browser libs in §6 live.
- **Disable the autonomous polish worker first thing** (§5 Priority 1). It is
  opt-out and spawns from `/api/health`.
- **Do not hand-edit `package.json` in the arena workspace** — install
  dependencies with the workspace tool. In a plain clone, `npm ci` is correct;
  `esbuild`, `playwright` and `@opencode/cli` are real dependencies now.

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
| **Time UI browser smoke** | `BASE=… node scripts/smoke-time-room-ui.mjs http://127.0.0.1:3100` | **PASS** (was FAIL at `0a505d4`) | Fixed at `0b9eb22` — see §5 Priority 2 |
| **Time tutorial smoke** | `BASE=… node scripts/smoke-time-browser.mjs http://127.0.0.1:3100` | **PASS** (was FAIL at `0a505d4`) | Fixed at `0b9eb22` — see §5 Priority 2 |
| **House asset provenance** | `node scripts/test-house-assets.mjs` | **FAIL** (stale, not in `run-unit.mjs` or CI) | Expects `../../malye-korely/photos/` outside the repo *and* asserts `TOWN_HOUSES.length >= 100` while `public/art/town/houses.json` now holds **0** entries — it cannot pass in any clean checkout |

Re-run after the fixes (Pippa, `main` + `0b9eb22`, port 3100): typegen · tsc ·
eslint · `next build` pass; `npm run test` 11/11 DB-free suites; `test-wire`
46/46 SSE + 33/33 long-poll; smoke-rooms · smoke-doors (32) · smoke-wards (49) ·
smoke-cages (29) · smoke-stats (51) · smoke-time (70) · smoke-tutorial (29) ·
smoke-voice (28) · smoke-replay-observation · smoke-browser · smoke-art ·
smoke-static · smoke-time-room-ui · smoke-time-browser all pass. Suite counts
differ slightly from the table above because the two runs happened at different
commits; both are green apart from `test-house-assets`.

---

## 5. Known Bugs, Technical Debt & Priority Next Tasks

### Priority 1 — The opt-out "polish worker" and a channel secret committed to a public repo

`src/app/api/health/route.ts` calls `ensurePolishWorker()`
(`src/server/polish-supervisor.ts`), which returns early **only** when
`HOLLOW_POLISH_WORKER === "0"` — so it is enabled by default on every
deployment, previews included. When `node_modules/.bin/opencode` exists it
spawns a detached `scripts/polish-loop.mjs` that, every 60 s, clones `main` into
`.cache/polish/work`, runs free LLM models over it, and **posts to the mayfly
channel stored in `scripts/mayfly-channel.txt`** as "Creek-Polisher".

Observed effects: it competes for RAM in a ~3.9 GB sandbox (local `next start`
processes were killed mid-suite), and it puts an agent loop nobody started
inside your preview. It cannot `git push` (no credentials in the loop), but it
can post to that channel.

- Local mitigation: add `HOLLOW_POLISH_WORKER=0` to `.env` (untracked) and
  `pkill -f 'polish-loo[p]'`.
- Recommended fix: make it opt-in —
  `if (process.env.HOLLOW_POLISH_WORKER !== "1") return;` — which is what
  `.env.example` already implies ("Optional").
- **Security:** `scripts/mayfly-channel.txt` holds a mayfly channel URL
  *including its `#key`* in a **public** repository, while `.env.example` itself
  calls that URL a secret. Delete the file and read `HOLLOW_MAYFLY_URL` only.
- `/api/polish/status` is public and reports the worker's branch, commit, files
  and result. Decide whether it should be authenticated or removed.

**Status: implemented on branch `mallow/code-map-hygiene` @ `450020e`, awaiting
the human's merge decision.** Mallow Dewhopper 58 made the supervisor and the
loop require `HOLLOW_POLISH_WORKER=1`, made the channel URL come from
`HOLLOW_MAYFLY_URL` only, untracked and gitignored `scripts/mayfly-channel.txt`,
aligned `/api/polish/status`, and added `scripts/test-polish-gate.mjs` (DB-free,
wired into `run-unit.mjs`). Reviewed and re-verified independently: 12/12
DB-free suites, `tsc` and `eslint` clean, and the new test really spawns the
loop and asserts it exits disabled. **The key remains in git history — whoever
owns that channel must rotate it.** Small nit for the author: `.env.example`
still shows `# HOLLOW_POLISH_WORKER=0` as the example value, while the gate now
needs `1`.

### Priority 2 — DONE at `0b9eb22`: the two failing browser smoke scripts

Both reviews found these independently; they are fixed on `main`. Kept here so
nobody redoes the work.
1. **`NoteReader` missing author in `.sr-only` text (`src/app/room/[code]/hud.tsx`):**
   - **Cause:** `NoteReader` puts `note.author` inside `aria-label`, while `<span className="sr-only">{note.text}</span>` omits the author. `scripts/smoke-time-room-ui.mjs:81` checks `reader.textContent()` for `noteRoom.name` (`"the page names its author"`) and fails.
   - **Fixed:** the sr-only line now renders `{note.text} — pinned by {author}`, matching the standalone client's `#notetext` / `#noteauthor`. The glass is still read in-world: no pop-out, any key or tap lowers it.
2. **Stale ward count regex in `scripts/smoke-time-browser.mjs`:**
   - **Cause:** `STATIONS` now has 17 wards (up from 13), so `TutorialClient` shows `Repaired Wards: 1 / 17`, failing `assert.match(..., /1\s*\/\s*13/)`.
   - **Fixed:** it now parses `done / total` from the DOM and asserts one repaired ward with a total of at least 13, so future wards will not break it again.

### Priority 3 — Split Files Exceeding the 50 KB Repo Rule (`AGENTS.md`)
`AGENTS.md` specifies: *"Avoid files bigger than 50Kb in repo."* Two source files currently exceed 50 KB:
1. **`src/game/render.ts` (`56,004 B`, 1,164 lines):** Extract `drawStation()` (~235 lines, lines 930–1163) into `src/game/station-art.ts` (matching `atmosphere.ts`, `house-art.ts`, `ward-art.ts`).
2. **`src/app/tutorial/TutorialClient.tsx` (`53,471 B`, 1,246 lines):** Extract the `CHAPTERS` data and tutorial simulated snapshot builder into `src/app/tutorial/chapters.ts`.

### Priority 4 — Finish the Metric Conversion (`src/game/units.ts`)
- `units.ts` defines `FIGURE_H = 48` (`UNITS_PER_M ≈ 28.24`), `m()`, `units()`, `metres()`, and `MEETING_HOUSE`, **but only the meeting house uses it**.
- Convert remaining raw pixel constants in `house-art.ts` (`WALL_HEIGHT = 112`, `ROOF_HEIGHT = 158`), `render.ts` (cages, bell tower, notes, tree heights), and `atmosphere.ts` (lantern posts, windmills, fences, gravestones, haystacks) to `m(...)` / `units(...)` in `units.ts`.
- Clarify `WORLD_W = 4200` in `src/game/types.ts` (e.g., alias or comment `TOWN_SPAWN_MAX = 4200` so future agents don't confuse it with `WORLD_SPAN = 12200`).

### Priority 5 — Client Parity, UI Token Adoption & Period Lore Polish
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
6. **Dead backdrop-village data (both reviews agree the village must stay gone):**
   - Nothing imports `TOWN_HOUSES` any more, yet `src/game/town.ts`,
     `public/art/town/` (`houses.json` with **0** entries plus four unused
     `house-00N.svg`) and `scripts/test-house-assets.mjs` remain. Delete all
     three, or restore the manifest — but confirm with the human first, because
     `public/art/reference/*` and `public/art/README.md` document the real
     Malye Korely provenance of the facade art (and the README still says "the
     four `house/facade-*.svg`" when there are six).
7. **Dead code from the merge:** `Renderer.zoomOnly` / `setZoomOnly`
   (`src/game/render.ts`) have no callers left — superseded by `viewZoom`.
   Remove them or wire them to something.
8. **Engine import cycles (verified independently with a Tarjan SCC scan of
   `src/game/*.ts`):** two strongly connected components exist.
   - A **13-module cycle**: `actions · chronicle · engine · history · hooks ·
     persistence · proximity · registry · rules · snapshot · tick ·
     time-travel · timepieces`. `hooks.ts` breaks only the snapshot/tick edges,
     so `engine.ts`'s `export *` barrel keeps the rest of the cycle alive. It is
     runtime-safe today (ESM hoisting + function-level use) but fragile: any new
     top-level side effect or const-to-const import across those edges can give
     you `undefined` at module init. Do not add a 14th member casually.
   - A **3-module cycle**: `types ↔ balance ↔ buildings` (`types.ts` re-exports
     balance and imports a `DoorState` type from buildings; buildings imports
     `ix` from types). This predates the merge. A fourth member (`units.ts`,
     which re-exported `VISION_*` from balance for convenience) was removed at
     `60a7f40` — nothing imported it, and dropping that one line shrank the SCC
     from 4 to 3.
   - `docs/CODE_MAP.md` on `mallow/code-map-hygiene` documents both plus the
     full measured import graph (fan-in/out); it is pending merge.
9. **Housekeeping:**
   - Remove leftover scratch dotfiles in `scripts/` (`.mobile-check.mjs`, `.mobile-check2.mjs`, `.mobile-shot.mjs`, `.mse.mjs`, `.shot-svg.mjs`, `.smoke-pages.mjs`, `.smoke-refactor.mjs`).
   - Update or gate `scripts/test-house-assets.mjs` so it does not require an external `../../malye-korely/` directory outside the repository.
   - Close stale GitHub PRs `#1` and `#2` (with human/maintainer approval).
   - `pippa/polish-pass`, `clover59/velvet-dusk-polish` and `merge/velvet-dusk`
     are fully merged into `main`; delete them once a human confirms.
   - `npm audit` reports vulnerabilities in the full install (pre-existing; the
     audio/netcode work did not touch dependencies).

---

## 6. Contracts you must not break casually

These are the newest load-bearing rules. Each has a test; run it after touching
the area.

### 6.1 The wire format (`src/game/wire.ts`, `src/game/viewers.ts`) — `scripts/test-wire.mjs`

One viewer receives, in order:

1. `{etag, now, snap}` — a full `Snapshot`, once on connect and whenever the
   server cannot prove what the client holds (mismatched `rev`).
2. `{etag, now, delta?, patch?}` — only what changed. `delta` carries changed
   **top-level** fields as full values; `patch` carries changed **items** of the
   id-keyed arrays (`players`, `tasks`, `doors`) as `{id, ...changedFields}` and
   the changed fields of `self`. A membership or order change resends the whole
   list through `delta`.
3. `{now}` — a bare clock tick, once a second, when nothing else moved.

Clients merge with `applyFrame(held, frame)`. `null` on the wire means `null` in
state (consumers test `keyX !== null`, `winner === "hollow"`); only `time` may
legitimately be absent.

**Slow class.** Values that drift every tick but are only *displayed* coarsely
are held and sent at most **once per second**, unless a fast change ships in the
same frame: `self.stamina`, `self.killCooldownMs`, `self.blackoutCooldownMs`,
`sabotageCooldownMs`, `nightT`, `danger`, `time`, and a ward's bare `progress`.
The quantisation that makes this lossless lives in `snapshot.ts` (`coarseMs()` =
whole seconds because the HUD renders `Math.ceil(ms/1000)`; `nightT` to 1/1000;
`progress` to 1/100; `time.latest` to 5 s).

> **If you add a per-tick field to `Snapshot`, it will change the etag 20×/s and
> silently undo this work.** Quantise it in `snapshot.ts`, add it to the slow
> sets in `wire.ts`, then run `test-wire.mjs`.

Measured on `main` with 4 players: idle **~320 B / 5 s per client** (it was
420 KB / 5 s before this pass — a full 4.2 KB snapshot 20×/s); a walking
neighbour costs `{"id","x"}` frames at ≤10 Hz. `GET
/api/game/state?delta=1&wait=1` is the long-poll (held ≤900 ms, `304` when
nothing changed) used by the React fallback and the standalone client; plain
`GET /api/game/state` still returns a full snapshot for compatibility.

### 6.2 Prediction (both clients) — `smoke-browser`, `smoke-time-room-ui`

`useGameRender.ts` (and the same logic in `static-src/main.ts`) replays the
local steering log from `arrival − measured RTT` over the acknowledged server x,
so your own movement never feels a round trip late. `Renderer.drawPlayer`
derives **facing and gait from the displayed motion** (`lastDrawnX`), not from
the server's `p.facing` — that was the "moonwalk" bug: the sprite slid backwards
for one RTT after every turn. Neighbour extrapolation is capped at one frame
interval so nobody drifts after stopping.

If you change movement speeds or add a modifier, update **both** `walkSpeed()`
implementations or the two clients diverge.

### 6.3 `units.ts` — one place for scale

`FIGURE_H = 48` world units ≈ 1.7 m for the drawn traveller
(`public/art/characters/traveler.svg`, hood top → boot sole), so
`UNITS_PER_M ≈ 28.2`. Express new sizes with `m()` / `units()` / `metres()`
instead of magic numbers. World bounds, zoom factors (`ZOOM_READ = 3.2`,
`ZOOM_MAX = 4`), note sizes, tree spacing and `MEETING_HOUSE` live there and are
consumed by `render.ts`, `ward-art.ts` and `buildings.ts`. Balance *rates*
(speeds, cooldowns, vigor) stay in `balance.ts` — locked. Note that
`WORLD_W = 4200` in `types.ts` is the old town span used for spawn bounds, not
the world span (see §5 Priority 4).

### 6.4 The spyglass — never `inert` the scene

One continuous zoom (`Renderer.setViewZoom`, 1…4×) driven by wheel, trackpad and
two-finger pinch; the button and `Z` snap between lowered and `ZOOM_READ`,
aimed at a nearby page when there is one. Lowering works via any key, a tap on
the scene, or the floating "Lower the glass" button. Page text is **inked on the
paper in-world** (`Renderer.drawNote`) — there is no pop-out page anywhere, and
HUD-like labels (names, bubbles, action text, ward signs) are not drawn while
the glass is up.

> `<main>` must **never** be made `inert` while the glass is up. That was the
> mobile "no way to exit" bug: `inert` disabled every button on the page,
> including the one meant to close it. Only real dialogs (ward panel, time
> panel, settings) may inert the scene — see `useGameStream.ts`.

---

## 7. Locked decisions the human added during this pass

`SYNC.md` holds the nine long-standing overrides (§2). These were added while
polishing and are equally binding:

1. **No houses in the background.** The old 100-house parallax village is gone.
   (It also referenced 104 SVGs of which 100 did not exist — a hundred 404s per
   page load.) Beyond the road: woods, hills, props.
2. **Nature needs space.** The fen, the graveyard woods and the ridge are open
   stretches; keep them open when adding props.
3. **Period atmosphere, fictional Massachusetts.** No modern software chrome on
   the home page (the mock app window became a printed broadside), no pulsing
   status LEDs. The lore strings still contradict the era — §5 Priority 5.
4. **"Townfolk", never "Crew", in anything a player reads.** `"crew"` remains
   the wire/DB role value.
5. **The road keeps the original score.** `src/game/audio.ts` is the
   drone/motif engine the human preferred after hearing an alternative; the
   keeper's `MusicBox` wakes only for intimate moments (hands on a ward, walking
   the recorded past). Do not swap the whole score again.
6. **Sound levels are measured, not guessed.** Any audio change must be checked
   with `scripts/analyze-audio.mjs` — the human asked explicitly for a common
   volume across sounds and nothing painful.
7. **A single place for the metric system** (§6.3) — new sizes go in `units.ts`.

---

## 8. Recipes that are easy to get wrong

### 8.1 Headless browser in a minimal sandbox

`npm ci` installs `playwright`, but the browser binary and its system libraries
are missing. What works on Debian 12 without root:

```bash
npx playwright install chromium-headless-shell   # downloads despite a
                                                 # host-requirements warning
mkdir -p .cache/pw/debs && cd .cache/pw/debs
# fetch the Debian 12 pool .debs for: libnspr4, libnss3, libdbus-1-3,
# libatk1.0-0, libatk-bridge2.0-0, libatspi2.0-0, libxcomposite1, libxdamage1,
# libxfixes3, libxrandr2, libgbm1, libxkbcommon0, libasound2,
# libwayland-server0, libdrm2, libxrender1, libxext6, libxi6
for f in *.deb; do dpkg-deb -x "$f" root; done
rm -f root/usr/lib/x86_64-linux-gnu/libexpat.so.1*   # needs GLIBC 2.38; the
                                                     # system one is fine
export LD_LIBRARY_PATH=$PWD/root/usr/lib/x86_64-linux-gnu:$PWD/root/lib/x86_64-linux-gnu
```

Traps: mixing newer `libatk` / `at-spi2` builds gives
`undefined symbol: atk_object_get_help_text`; the extracted `libexpat` needs
GLIBC 2.38 (delete it, the system copy works); the shell needs `--no-sandbox
--disable-gpu`. In Playwright, **room pages never reach `networkidle`** because
the SSE stream stays open — use `domcontentloaded`. Reading SSE frame arrival
times needs a CDP session (`Network.eventSourceMessageReceived`).

### 8.2 Static bundle

```bash
node scripts/build-static.mjs   # static-src → public/play/{index.html,game.js}
```

Commit the rebuilt `game.js` whenever `static-src/` or any shared `src/game/*`
module changes. **Byte-diffs between two builds of identical source are normal**
(esbuild mangles identifier names differently run to run — a 40-byte diff turned
out to be `pe` vs `he`); check semantics, not bytes. `index.html` must sit at
the root of any portal ZIP, not inside a `play/` folder (`DEPLOY.md`).

### 8.3 A room for manual testing

```bash
B=http://127.0.0.1:3100
curl -sX POST $B/api/game/create -H 'content-type: application/json' \
  -d '{"playerId":"a","name":"Ada"}'      # → {"code":"XXXX"}
```

A match needs **≥4 souls** before `{"action":"start"}` is accepted. Use
`?delta=1&wait=1` on `/api/game/state` to watch frames, and remember
`/api/health` is the platform's readiness probe — hitting it can spawn the
polish worker (§5 Priority 1).

### 8.4 Two more traps, both confirmed on `main`

- **`drizzle.config.json` hardcodes its database URL**
  (`postgresql://postgres:postgres@127.0.0.1:5432/app_db`) and ignores
  `DATABASE_URL`. In the arena workspace the two happen to be identical, so
  `npx drizzle-kit push --force` works and prints "No changes detected";
  anywhere else it silently targets the wrong database and reports
  "Did not find any relations". Apply `drizzle/0000_smart_mongu.sql` with
  `psql "$DATABASE_URL"` instead, or make the config read the env var.
- **`scripts/smoke-rooms.mjs` runs `pkill -f 'next-serv[e]r'`** (line 34) to
  restart the server mid-test. That kills *every* Next server on the box —
  including the platform preview you are demoing. Run it last, and never while
  something else depends on port 3100. (The `[e]` trick is deliberate so the
  pattern does not match the pkill command itself; a plain
  `pkill -f "next-server"` in your own shell matches *your shell's command
  line* and kills the calling process — that mistake cost a whole debugging
  session.)

---

## 9. Merge provenance

`main` = PR #5 = `clover59/velvet-dusk-polish` (`e969a3f`) as base with
`pippa/polish-pass` (`7ee4f70`) grafted, squashed into one merge commit
`818fe3f`. Roughly: Clover owns scenery/atmosphere, wards and hideouts, audio
and the music box, minimap, broadside home page, `units.ts` layout, tutorial and
workbench fixes; Pippa owns the netcode (wire, viewers, both state routes,
stream/render hooks, snapshot quantisation, `test-wire.mjs`, standalone
transport), the moonwalk fix, spyglass mechanics, the metric meeting house and
the reduced-motion leaf rule. `analyze-audio.mjs` is Clover's; Pippa's offline
harness and shelved score were dropped in the merge. This handoff replaces
Pippa's `cf0cb55` version, which overwrote Clover's `1e074eb` review — the two
are merged here so nothing is lost.
