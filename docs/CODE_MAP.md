# Hollow Creek — nested code map

> Written by **Mallow Dewhopper 58** on branch `mallow/code-map-hygiene`, based on
> `main @ 8eec5b2`. Companion to `HANDOFF.md` (review + debt list), `SYNC.md`
> (locked decisions) and `AGENTS.md` (rules). This file is a *map*, not a spec:
> it says what each file is for, what it exports, and what depends on what.
> Where a claim comes from a measurement, the measurement is stated. Keep this
> file under 50 KB (AGENTS.md rule) and refresh the import numbers in §7 when the
> graph changes.

Contents

1. [Reading guide](#1-reading-guide)
2. [Nested tree](#2-nested-tree)
3. [HTTP surface](#3-http-surface)
4. [Layers and modules (`src/game/`)](#4-layers-and-modules-srcgame)
5. [Data flows](#5-data-flows)
6. [Invariants and where they live](#6-invariants-and-where-they-live)
7. [Dependency graph facts](#7-dependency-graph-facts)
8. [Scripts and test suites](#8-scripts-and-test-suites)
9. [Polish worker subsystem](#9-polish-worker-subsystem)
10. [Traps and debt found while mapping](#10-traps-and-debt-found-while-mapping)

---

## 1. Reading guide

- **Authoritative server** = `src/game/*` + `src/app/api/game/*`. One long-lived
  Node process owns every room in memory (`registry.ts`). Postgres is for
  persistence, hydration and the chronicle only (`persistence.ts`, `db/`).
- **Two clients, one protocol.** The React game screen (`src/app/room/[code]/`)
  and the standalone static client (`static-src/main.ts` → `public/play/game.js`)
  both speak the same HTTP/SSE API and both reuse the pure modules in
  `src/game/` (render, wards UI, time UI, audio, settings, voice, wire).
- **Clients send intent, never positions.** Movement is `dir` (-1/0/1). Every
  other mutation is an `action` from `INPUT_ACTIONS` (`input.ts`).
- **Integers only for world coordinates** (`ix()` in `types.ts`). Replays must be
  byte-identical (`scripts/test-replay-determinism.mjs`).
- **Scale lives in `units.ts`.** `balance.ts` owns rates (speeds, cooldowns, vigor)
  and is locked by SYNC.md. Do not change balance numbers to fix a visual problem.

Legend: `→` imports from. `[DB]` needs Postgres. `[client]` runs in the browser.

---

## 2. Nested tree

Only tracked files are listed. Generated output (`.next/`, `public/play/game.js`
as a build artifact, `node_modules/`) is omitted except where it is committed.

```
HollowCreek/
├── AGENTS.md ............ rules for agents (50 KB file limit, mayfly, polish worker)
├── SYNC.md .............. locked decisions + the unification protocol
├── HANDOFF.md ........... review, debt list, contracts (§6), environment traps (§8)
├── DEPLOY.md ............ running it, E2B / permanent hosting, validation commands
├── docs/
│   ├── CODE_MAP.md ...... this file
│   ├── notes.md ......... pinned pages (walls and trees), engine module map
│   └── time-travel.md ... timepiece / command-replay design
├── release/ ............. short + full store descriptions and release README
├── .github/workflows/
│   └── ci.yml ........... typecheck, lint, DB-free suites; DB suites if DATABASE_URL secret
├── drizzle/ ............. SQL migrations (0000_smart_mongu.sql: 4 tables) + meta snapshot
├── drizzle.config.json .. drizzle-kit config (see trap T1: ignores DATABASE_URL)
├── next.config.ts · next-env.d.ts · postcss.config.mjs · eslint.config.mjs · tsconfig.json
├── package.json ......... scripts: dev, build, start, lint, typecheck, test, check
├── .env.example ......... DATABASE_URL, voice TURN (optional), polish worker (opt-in)
│
├── public/
│   ├── icon-*.png · favicon.ico · icon.png ........ app icons (canonical ladder)
│   ├── art/ ............. SVG art library served to both clients (Next + /play)
│   │   ├── characters/ · furniture/ · house/ · props/ · scenery/
│   │   ├── reference/ ... reference drawings + houses.json (provenance: public/art/README.md)
│   │   ├── rooms.json ... interior layouts for house art
│   │   └── town/ ........ houses.json has 0 entries; 4 unused house-00N.svg (dead, trap T7)
│   └── play/ ............ BUILD OUTPUT of scripts/build-static.mjs (committed)
│       ├── index.html · game.js (≈126 KB minified) · art/ · icons
│
├── static-src/ .......... standalone client source (NOT in the Next bundle)
│   ├── index.html ....... markup + CSS for the menu, lobby, HUD (22.7 KB)
│   └── main.ts .......... state machine, SSE/long-poll, prediction, SERVERS list (44.3 KB)
│
├── scripts/ ............. build helpers, tests, smokes, the polish worker
│   ├── build-static.mjs · run-unit.mjs · analyze-audio.mjs · qa-visual.mjs
│   ├── polish-loop.mjs · polish-prompt.md · mayfly-client.mjs   (opt-in worker, §9)
│   ├── test-*.mjs ....... unit + DB suites (run by run-unit.mjs / CI)
│   └── smoke-*.mjs ...... end-to-end checks against a running server (take BASE/argv)
│
└── src/
    ├── proxy.ts ......... CORS headers + OPTIONS 204 for /api/* (Next middleware)
    ├── db/
    │   ├── index.ts ..... pg Pool + drizzle client; throws only in production without URL
    │   └── schema.ts .... gameEvents · roomRows · roomPlayers · playerStats (Drizzle tables)
    ├── server/
    │   ├── polish-supervisor.ts ... ensurePolishWorker(): spawns the worker only when opted in (§9)
    │   └── rate-limit.ts .......... in-memory token bucket allow(key, max, windowMs), clientKey()
    │
    ├── app/                             (Next.js App Router pages + API)
    │   ├── layout.tsx · globals.css ... root layout, viewport, design tokens (.hc-btn/.hc-panel/...)
    │   ├── page.tsx ................... home: town list, settings, "parchment broadside"
    │   ├── art/page.tsx ............... asset gallery (ArtLibrary)
    │   ├── stats/page.tsx ............. Hall of Records (player_stats) [DB]
    │   ├── chronicle/[code]/page.tsx .. town ledger; sealed while playing/meeting [DB]
    │   ├── tutorial/
    │   │   ├── page.tsx · loading.tsx
    │   │   └── TutorialClient.tsx ..... practice board, 1,246 lines, 53 KB (trap T5)
    │   ├── room/[code]/                ← the game screen
    │   │   ├── page.tsx · loading.tsx ........ route entry (renders GameClient)
    │   │   ├── GameClient.tsx ................ orchestrator: owns hooks, renderer, settings
    │   │   ├── useGameStream.ts .............. join + SSE/long-poll → snapshot state
    │   │   ├── useGameRender.ts .............. canvas loop, DPR resize, local prediction
    │   │   ├── useGameInput.ts ............... keys/pointer → InputBody (intent only)
    │   │   ├── useGameOverlays.ts ............ settings/ward/time panels, voice pagehide
    │   │   ├── bars.tsx ...................... TopBar, BottomControls
    │   │   ├── midhud.tsx .................... MidHud (meeting / phase strip)
    │   │   ├── hud.tsx ....................... Toast, NoteReader (pinned page), RoleBanner
    │   │   ├── chat.tsx ...................... PinPanel, ChatBox
    │   │   ├── minimap.tsx ................... server-filtered valley strip
    │   │   └── overlays.tsx .................. LobbyOverlay, EndOverlay, VoiceCallbacks
    │   └── api/
    │       ├── health/route.ts ............... GET: DB ping + ensurePolishWorker() (opt-in)
    │       ├── polish/status/route.ts ........ GET: worker status (disabled unless opted in)
    │       └── game/
    │           ├── create/route.ts · join/route.ts · leave/route.ts · input/route.ts
    │           ├── rooms/route.ts ............ GET: town list for the menu
    │           ├── state/route.ts ............ GET: snapshot / etag 304 / delta long-poll
    │           ├── state/stream/route.ts .... GET: SSE push (one full frame, then deltas)
    │           ├── stats/route.ts ........... GET: lifetime stats JSON [DB]
    │           ├── log/route.ts ............. GET: chronicle for a town [DB] (sealed rules)
    │           └── voice/route.ts ........... GET/POST: proximity voice signalling + PCM relay
    │
    └── game/                            (see §4 for layers)
        ├── types.ts · balance.ts · units.ts · input.ts       ← contracts and constants
        ├── engine.ts ............................. hub: Room/P types, barrel re-exports
        ├── registry.ts · persistence.ts · chronicle.ts ... in-memory rooms, DB write-behind, journal
        ├── actions.ts · tick.ts · rules.ts ...... lifecycle, intent handling, the 50 ms loop, win rules
        ├── snapshot.ts · fingerprint.ts · wire.ts · viewers.ts ... per-viewer views and deltas
        ├── history.ts · time-travel.ts · timepieces.ts ........... night checkpoints, time travel
        ├── wards.ts · recovered-wards.ts · ward-ui.ts · ward-art.ts ... repair games
        ├── buildings.ts · house-art.ts ............................. houses, doors
        ├── proximity.ts · voice-range.ts · voice.ts ............... range queries, voice
        ├── stats.ts · chronicle-access.ts ....................... stats bump, sealed-ledger rule
        ├── hooks.ts ............................................ engine↔module bridge (cycle breaker)
        ├── rng.ts · fingerprint.ts · focus-trap.ts .............. utilities
        ├── render/ (16 modules: index, station, landmarks, player, env, …) · structures.ts
        ├── atmosphere.ts · svg-assets.ts ........................ canvas drawing (no logic), SVG loader
        ├── audio.ts · music-box.ts ............................. generative score (browser)
        └── settings.ts · settings-ui.ts · time-ui.ts ........... client prefs + dialogs
```

---

## 3. HTTP surface

All routes are `force-dynamic`. `/api/*` gets CORS from `src/proxy.ts`.
Identity is an explicit `playerId` in the body or query. There are no cookies.

| Route | Method | Handler module(s) | Rate limit (per client key, per 60 s) | Notes |
|---|---|---|---|---|
| `/api/game/create` | POST | `actions.createRoom` | 20 | Returns a town `code`. Refuses with "Too many towns" when throttled. |
| `/api/game/join` | POST | `actions.joinRoom` | 90 | Same name after >8 s silence re-adopts the seat (SYNC §3). |
| `/api/game/leave` | POST | `actions.leaveRoom` | — | Also used by `sendBeacon` on tab close. |
| `/api/game/input` | POST | `actions.handleInput` → `input.canonicalInput` | 600 | Intent only: `dir`, `action`, `ward_move`, `pin_note`, ... |
| `/api/game/state` | GET | `snapshot` + `viewers` + `wire` | 1200 | Plain = full snapshot (304 on etag). `delta=1&wait=1` = long-poll wire frames, held ≤900 ms. |
| `/api/game/state/stream` | GET | `viewers` + `wire` (SSE) | 20 (connects) | One full frame, then `{etag,delta?,patch?}` ≤10 Hz and `{now}` once a second. |
| `/api/game/rooms` | GET | `actions.listRooms` (via `engine`) | — | Menu list; towns from memory plus parked seats. |
| `/api/game/log` | GET | `chronicle-access` + `db` | — | Refuses while `playing`/`meeting` (SYNC §8). [DB] |
| `/api/game/stats` | GET | `db` + `player_stats` | — | JSON for `/stats`. [DB] |
| `/api/game/voice` | GET/POST | `voice-range` | — | Returns gain and pan only, never world x. Raw PCM relay is rate-limited. |
| `/api/health` | GET | `db` + `polish-supervisor` | — | `{ok:true}` when ready. Only route that can spawn the worker, and only if opted in. |
| `/api/polish/status` | GET | (self-contained) | — | `{enabled:false}` unless `HOLLOW_POLISH_WORKER=1`. |

Pages: `/` (home), `/room/[code]` (game), `/tutorial`, `/stats`,
`/chronicle/[code]`, `/art`, `/play` (static client, served from `public/play`).

---

## 4. Layers and modules (`src/game/`)

Layers are listed bottom-up. "Imports" lists the *local* modules each file
depends on. "Used by" lists the main consumers. Counts are from §7.

### 4.1 Contracts and constants (no I/O)

| Module | Lines | What it is | Imports | Used by |
|---|---:|---|---|---|
| `balance.ts` | 62 | All gameplay rates: speeds, cooldowns, vision radii, vigor costs, cart physics, `TICK_MS = 50`. Locked by SYNC.md. | — | types, units, actions, tick, … |
| `units.ts` | 80 | Single spatial scale: `FIGURE_H = 48` (≈1.7 m), `UNITS_PER_M ≈ 28.2`, `m()`, `units()`, `metres()`, `toMetres()`, `WORLD_MIN/MAX/SPAN`, zoom factors, note sizes, `MEETING_HOUSE`, `TREE_SPACING`. | balance | render, buildings, ward-art, house-art |
| `types.ts` | 279 | Wire contracts (`Snapshot`, `SelfInfo`, `PublicPlayer`, `TaskView`, `TimeView`, `InputBody`, `RoomListing`), `STATIONS` (17 wards), `CAGE_XS`, `PLAYER_COLORS`, `ix()`. Re-exports balance. `WORLD_W = 4200` is the *old town span* used for spawn bounds (trap T4). | balance, buildings, wards | 34 modules (highest fan-in) |
| `input.ts` | 21 | `INPUT_ACTIONS` whitelist and `canonicalInput()`. The single source of truth for what a client may send. | types | actions, chronicle, engine |
| `rng.ts` | 27 | Unbiased Fisher–Yates with crypto randomness (`randInt`, `shuffle`). | — | actions (seat draw) |
| `fingerprint.ts` | 17 | `fnv1a`, `snapshotEtag` (excludes `now`). | — | snapshot, engine, viewers |
| `focus-trap.ts` | 20 | Tab focus trap for innerHTML dialogs. | — | ward-ui, time-ui, settings-ui |
| `voice-range.ts` | 49 | Pure proximity rules: `VOICE_EARSHOT`, `voiceCanHear`, `voiceGainFor`, `voicePanFor`, ICE list. | — | voice, voice route |

### 4.2 Authoritative engine (server)

| Module | Lines | What it is | Imports (local) |
|---|---:|---|---|
| `engine.ts` | 190 | **The hub.** Declares `Room`, `P`, `TaskState`, `HistoryFrame`, `JournalEntry`, `TimeVisit`. Owns the `globalThis` singleton state and re-exports the barrel of every module below. Calls `bindEngineHooks()`. | 19 local modules (fan-out 21) |
| `registry.ts` | 53 | In-memory `rooms` map (survives HMR via `globalThis`), `roomLoads` for one-flight hydration, `makeCode()`, `getRoom()`, `listRoomsSync()`. | engine (type), types |
| `persistence.ts` | 182 | Write-behind flush of rooms and players to Postgres on an interval, `loadRoom()` hydration, chronicle retention prune. [DB] | buildings, chronicle, engine, registry, stats, types, db |
| `chronicle.ts` | 96 | Journal and event feed: `record()` (fire-and-forget DB insert into `game_events`), `journal`, `seeded`, `kitId`, `emitRoom`, `markDirty`, `onRoomEvent`. Wall clocks may move backwards; journal order must not. | db, engine, input, types |
| `actions.ts` | 681 | Lifecycle and intent: `createRoom`, `joinRoom`, `leaveRoom`, `startGame`, `restartGame`, `listRooms`, and **`handleInput`**, which dispatches every `action`. Largest engine file after render/time-travel. | 16 local modules (fan-out 16) |
| `tick.ts` | 186 | Authoritative loop: `tick()` advances every live room each `TICK_MS`, captures history checkpoints, resolves meetings, reconciles time-travel futures, drops building keys, emits room change events for SSE, and GCs dead rooms (per the file header). `advanceRoomForTest()` is the test seam. | 11 local modules |
| `rules.ts` | 221 | Rule effects: `dropKey`, `dropTimepiece`, `dropSupply`, `tryDeliverSupply`, `cagePlayer`, `freePlayer`, `canRepair`, `beginRepair`, `beginMeeting`, `doKill`, `checkWin`, `resolveMeeting`. | buildings, chronicle, engine, proximity, stats, time-travel, timepieces, types, wards |
| `proximity.ts` | 39 | Pure "what is near me" queries: `inMeetingArea`, `nearestOccupiedCage`, `nearestBody`, `killTarget`, `stationNear`. A key targets the closest occupied lock within reach. | engine (type), types |
| `timepieces.ts` | 22 | Pure queries over timepieces: `loosePieces`, `heldPiece`, `usedPieces`, `nearestTimepiece`, `nearTimepiece`. | engine, types |
| `history.ts` | 50 | Night checkpoints: `captureHistory`, `frameAt`, `restoreFrame`. Keeps the whole night selectable while thinning older samples. | engine, types |
| `snapshot.ts` | 243 | **Per-viewer view.** `snapshot(room, playerId)` applies vision (`VISION_CREW 420`, `VISION_HOLLOW 620`, `VISION_BLACKOUT 190`, same house only), masks bodies, kits, keys, doors, timepieces and pages outside view, and quantises slow values. `roomEtag()` caches per-player etags keyed by `room.rev`. | 10 local modules |
| `wire.ts` | 150 | **Delta protocol.** `encodeView`, `diffView`, `applyFrame(held, frame)`, `frameTouchesPlayers`. `ID_ARRAYS` = players/tasks/doors patch by id. `null` on the wire means `null` in state. | types |
| `viewers.ts` | 104 | Per-viewer stream state outside the Room: `nextFrame`, `waitForFrame` (long-poll), `slowDueIn` (1 Hz beat for slow values), `FRAME_MS`, `SLOW_MS`. | chronicle, engine, snapshot, wire |
| `hooks.ts` | 17 | Function-pointer bridge: `bindEngineHooks()` is called once by engine; `snapshot()` and `tickRoom()` then dispatch through it, so time-travel can re-enter the loop without a static import cycle. | engine (type), types |
| `stats.ts` | 45 | `newMatchStats()`, `bumpStats()`: atomic fire-and-forget increments of `player_stats`. A bad write can never break a match. [DB] | db, schema, types |
| `chronicle-access.ts` | 20 | `chronicleIsOpen()`: the sealed-ledger rule (no reading while a night is live). | db, engine |

### 4.3 Time travel (server)

| Module | Lines | What it is | Imports (local) |
|---|---:|---|---|
| `time-travel.ts` | 395 | Replay of recorded nights: `startTimeVisit`, `endTimeVisit`, `handlePastInput`, `pastSnapshot`, `replayRecordedState`, `simulatePast`, `replayFuture`, `reconcileFuture`, `mergeMatch`, `timelineItems`. One temporary past layer per room. | actions, buildings, chronicle, engine, history, hooks, input, proximity, rules, stats, timepieces, types (fan-out 12) |
| `time-ui.ts` | 84 | `TimePanel`: the accessible time-selection dialog shared by both clients. [client] | focus-trap, types |

See `docs/time-travel.md` for the design.

### 4.4 Wards, buildings and doors (server rules + data)

| Module | Lines | What it is | Imports |
|---|---:|---|---|
| `wards.ts` | 315 | Nine physical structures and 13 named jobs. `createWardPuzzle`, `validWardMove`, `applyWardMove`, `wardSolved`, `wardProgress`, `wardView`. The server owns every move. | recovered-wards |
| `recovered-wards.ts` | 111 | Pure deterministic mechanics recovered from the Gloamwing experiments (Lantern Rites, The Long Draw, Nine Candles, Crow Call, The Furrow). No timers, no client-claimed positions. | — |
| `buildings.ts` | 147 | Houses (`BUILDINGS`), doors (`DoorState`, `doorX`, `newDoors`), trees (`treeX`, `TREE_MIN/MAX`), `snapAnchor` for pinned pages, `interactWithBuilding`, `walkThroughBuildings`, `clampWorld`. | types, units |
| `house-art.ts` | 128 | `drawHouseExterior`, `drawHouseInterior`. Data-driven from `public/art/rooms.json` and SVGs. [client] | buildings, svg-assets, types |

### 4.5 Presentation (browser only; pure drawing, no game logic)

| Module | Lines | What it is | Imports |
|---|---:|---|---|
| `render/index.ts` | 164 | `Renderer`: the canvas orchestrator. Sky, street, stations, cages, bodies, players, notes, spyglass zoom (`setViewZoom`). Each layer is a module in `render/` (env (incl. palettes), frame, sky, tree, horizon, ground, note, houses, station (incl. chapel, stations, cart, kits), marker, landmarks, player (incl. speech bubble), figure, effects, structures); every file is under 10 KB. Split from the old 56 KB `render.ts` (trap T5, `5e86fd6`). | atmosphere, buildings, house-art, settings, svg-assets, types, units, ward-art, structures |
| `render/structures.ts` | 27 | `STRUCTURE_BOX` and `drawStructure(ctx, name, variant?)`: places `public/art/structures/<name>[-broken\|-trim].svg` in world units. | svg-assets, units |
| `render/station.ts` | 149 | Ward stations, chapel, supply cart and kits. Places the structure art and draws only state-driven parts in code: lit windows, lantern glow, radio lamp, turning mill sails. | ward-art, structures, chapel, marker |
| `atmosphere.ts` | 179 | Pure layers: moon rays, fireflies, creek glints, parallax reeds, grade, grain, street dressing. | buildings, svg-assets |
| `ward-art.ts` | 54 | `drawKit`, `drawSupplyCart`. The broken-ward damage overlays moved into `public/art/structures/*-broken.svg` (`drawBrokenWard` removed). | svg-assets |
| `svg-assets.ts` | 94 | Same-origin SVG loader with a cache; `drawSvg`, `drawTraveler`, `roomItems`. Static exports set `hc-art-base`. | — |

### 4.6 Repair workbench UI (shared by both clients)

| Module | Lines | What it is | Imports |
|---|---:|---|---|
| `ward-ui.ts` | 333 | `renderWardJob`, `WardPanel`, `morphHtml`. Renders the exact authoritative board; sends one numbered physical action. | focus-trap, wards |

### 4.7 Client-only services

| Module | Lines | What it is | Imports |
|---|---:|---|---|
| `audio.ts` | 507 | `AudioDirector`: a generative WebAudio score that follows snapshot state (`danger`, blackout, bell). No audio files. | music-box, settings, types |
| `music-box.ts` | 116 | `MusicBox`: the keeper's music box, woken only by ward work or walking the past. | — |
| `voice.ts` | 759 | `VoiceChat`: opt-in proximity voice over WebRTC with a server PCM relay fallback. Largest client module. | settings, voice-range |
| `settings.ts` | 235 | Client-only prefs: `SettingsStore`, `normalizeSettings`, key bindings, `applyDocumentPreferences` (reduced motion). Never changes gameplay. | — |
| `settings-ui.ts` | 303 | `SettingsDialog`, dependency-free, shared by React and `/play`. | focus-trap, settings |

### 4.8 Server utilities

| Module | Lines | What it is |
|---|---:|---|
| `src/server/rate-limit.ts` | 38 | In-memory token bucket `allow(key, max, windowMs)` and `clientKey(req)`. Resets on restart by design. |
| `src/server/polish-supervisor.ts` | 59 | `ensurePolishWorker()`: opt-in spawner for the maintenance worker (§9). |

### 4.9 React room screen (`src/app/room/[code]/`) — client wiring

`GameClient.tsx` (414 lines, fan-out 19) is the only component that knows all
the hooks. The hooks split responsibilities so nothing else must:

```
GameClient.tsx
 ├─ useGameStream.ts ───→ useGameRender.ts (reconciles RTT, shares NetState)
 │                   └──→ game/wire (applyFrame), game/audio, game/ward-ui, game/time-ui, game/types
 ├─ useGameRender.ts ───→ game/render (Renderer), game/settings
 ├─ useGameInput.ts ────→ game/settings, settings-ui, time-ui, voice, ward-ui   (intent only)
 ├─ useGameOverlays.ts ─→ game/audio, settings, settings-ui, time-ui, voice, ward-ui
 └─ panels: bars · midhud · hud · chat · minimap · overlays (presentational, props only)
```

`overlays.tsx` is imported by `hud.tsx` and `chat.tsx` (fan-in 3) and holds
`VoiceCallbacks`, `LobbyOverlay`, `EndOverlay`.

### 4.10 Static client (`static-src/` → `public/play/`)

- `main.ts` (44 KB) is a self-contained state machine. It imports the shared
  modules directly from `../src/game/…`: `render`, `ward-ui`, `time-ui`, `audio`,
  `voice`, `settings`, `settings-ui`, `types`, `buildings`, `wire`.
- `SERVERS` (`main.ts` line 19) is an **ordered list of E2B sandboxes**, which
  expire. The Singleplayer link on the published build is therefore dead (trap T3).
- `scripts/build-static.mjs` bundles `main.ts` to `public/play/game.js` (IIFE,
  minified, es2020) and copies `index.html`, `art/` and icons. It is committed.

### 4.11 Database (`src/db/`)

| Table (`schema.ts`) | Purpose | Written by |
|---|---|---|
| `game_events` | Chronicle: every player action, `jsonb data` | `chronicle.record()` |
| `rooms` | Town row: code, phase, round, timestamps | `persistence.flushRooms()` |
| `room_players` | Roster and parked seats (re-adopted by name) | `persistence.flushRooms()` |
| `player_stats` | Lifetime counters (games, kills, tasksDone, …) | `stats.bumpStats()` |

Migrations: `drizzle/0000_smart_mongu.sql` creates all four. Apply it with `psql`
(see trap T1 for why `drizzle-kit push` may not do that).

---

## 5. Data flows

### 5.1 Join, then state

```
browser                    Next route                 src/game
───────                    ──────────                 ────────
POST /api/game/create ───► create/route ───────────► actions.createRoom ──► registry.rooms
POST /api/game/join   ───► join/route   ───────────► actions.joinRoom     (lantern → newest joiner)
GET  /state/stream    ───► stream/route ───────────► viewers ─ snapshot.snapshot(room, pid)
                          (SSE: full frame,            └─ wire.diffView → {delta?, patch?}
                           then deltas ≤10 Hz,
                           {now} once a second)
browser applyFrame(held, frame) → render, HUD, audio, prediction
```

### 5.2 Input → tick → view

```
POST /api/game/input {dir | action}
  → input/route (rate limit 600/min)
  → actions.handleInput → input.canonicalInput (whitelist)
  → sets p.dir / runs the action (rules.*, wards.applyWardMove, time-travel.*)
  → markDirty(room)  (bumps room.rev; invalidates etags)
tick() every TICK_MS (50 ms):
  → advances the room state (see tick.ts); resolveMeeting when a meeting ends
  → reconcileFuture for any time-travel visit; captureHistory (sampled checkpoints)
  → emitRoom(code)  → viewers wake → SSE/long-poll send the next frame
```

### 5.3 Persistence

```
mutation ─► chronicle.record() ─► INSERT game_events (fire-and-forget)
markDirty ─► dirtyRooms ─► persistence.flushRooms() (interval) ─► UPSERT rooms, room_players
process start / first request for an unknown code ─► registry.roomLoads ─► loadRoom() (one flight)
```

### 5.4 Time travel (summary; see docs/time-travel.md)

(Summarised from export names and docs/time-travel.md. Verify details there.)

A timepiece holder calls `startTimeVisit`. The server replays the recorded night
from `history` into a *temporary past layer* (`room.timeVisit`). `handlePastInput`
applies the visitor's inputs there, while `pastSnapshot` shows that layer to
the visitor. On return, `endTimeVisit` writes the revision back, using
`reconcileFuture` and `mergeMatch` for any conflicts with the present.

### 5.5 Polish worker (opt-in; §9)

```
GET /api/health ─► ensurePolishWorker(): returns unless HOLLOW_POLISH_WORKER=1 and HOLLOW_MAYFLY_URL is set
                     └─ spawn scripts/polish-loop.mjs (flock, detached)  — never pushes or deploys
```

---

## 6. Invariants and where they live

Full text is in `SYNC.md` (locked) and `HANDOFF.md` §2 and §6. Enforcing code and tests:

| Invariant | Enforced in | Tested by |
|---|---|---|
| Last joined player is host; newest remaining is promoted | `actions.ts` (join/leave), tick (host guarantee per SYNC §1) | `smoke-rooms` (lantern held after restart) |
| No duplicate seats (same name re-adopts after 8 s) | `actions.joinRoom`, `registry`, `persistence` | `smoke-rooms` |
| Integer world coordinates | `types.ix()`, `rules.ts`, `snapshot.ts` | `test-replay-determinism`, `test-command-replay` |
| Server-side vision occlusion | `snapshot.ts` (`VISION_*`, same-house rule) | `smoke-doors`, `smoke-cages` cover door and cage states; no direct vision-radius test found |
| Shared wards and vigor hysteresis | `wards.ts`, `balance.ts`, `actions.ts` | `test-wards`, `smoke-wards` |
| Chronicle sealed mid-match | `chronicle-access.ts`, `api/game/log` | none found automated (manual check) |
| Wire: ≤10 frames/s (`FRAME_MS = 100`), slow values ≤1 Hz (`SLOW_MS = 1000`); merged state equals the server etag | `snapshot.ts` (quantisation), `wire.ts` (slow set), `viewers.ts` | `test-wire` (45 SSE + 33 long-poll checks) |
| Clients send intent only; server never trusts positions | `input.canonicalInput`, `actions.handleInput` | `test-input` |
| Scale only from `units.ts` | `units.ts`, consumers in render/buildings/ward-art | (review) |
| Standalone and React clients agree on movement speed | `walkSpeed()` in both clients (HANDOFF §6.2) | none found automated (manual check) |
| The spyglass never sets `inert` on the scene | `GameClient.tsx`, `render.setViewZoom` | none found automated (`qa-visual.mjs` is the visual check) |
| Randomness is unbiased | `rng.shuffle` | `test-rng` |
| Polish worker never auto-deploys, never edits `/app` | `polish-loop.mjs` (isolated clone, validation) | `test-polish-gate` (opt-in gate) |

---

## 7. Dependency graph facts

Measured with a regex import scan of `src/**/*.{ts,tsx}` (relative and `@/`
imports) on `main @ 8eec5b2`. The scan does not follow `export *` barrels in
depth. Counts are for local modules only.

**Fan-in (how many files import it) — top of the list**

| Module | Fan-in | Fan-out | Lines | Reading |
|---|---:|---:|---:|---|
| `game/types.ts` | 34 | 3 | 279 | Contract hub. Changing it touches almost everything. |
| `game/engine.ts` | 22 | 21 | 190 | Engine hub and barrel. Most engine code imports it. |
| `game/buildings.ts` | 19 | 2 | 147 | Building and door geometry. |
| `game/settings.ts` | 15 | 0 | 235 | Client prefs, leaf module. |
| `db/index.ts` | 11 | 0 | 27 | Pool, leaf. |
| `db/schema.ts` | 10 | 0 | 57 | Tables, leaf. |
| `game/chronicle.ts` | 8 | 5 | 96 | Journal and events. |
| `game/voice.ts` | 8 | 2 | 759 | Client voice. |

**Fan-out (what a file depends on) — top of the list**

| Module | Fan-out | Lines |
|---|---:|---:|
| `app/tutorial/TutorialClient.tsx` | 9 | 1246 |
| `game/actions.ts` | 16 | 681 |
| `game/tick.ts` | 11 | 186 |
| `game/time-travel.ts` | 12 | 395 |
| `game/persistence.ts` | 8 | 182 |
| `game/engine.ts` | 21 | 190 |
| `game/render/index.ts` | 8 | 164 |
| `app/room/[code]/GameClient.tsx` | 19 | 414 |

**Cycles.** A strongly connected component (SCC) scan finds two cycles:

1. **13-module SCC** (import cycle, runtime-safe but fragile):
   `actions ↔ chronicle ↔ engine ↔ history ↔ hooks ↔ persistence ↔ proximity ↔ registry ↔ rules ↔ snapshot ↔ tick ↔ time-travel ↔ timepieces`.
   `hooks.ts` was meant to break cycles (its header says "no import cycles"). It
   breaks only the `snapshot`/`tickRoom` edges. The engine barrel re-exports
   everything, so the rest of the cycle is still there. **Treat engine's barrel
   as a cycle, not a DAG.** Any new import from a cycle member into `engine.ts`
   can create a module-initialisation order bug.
2. **`buildings.ts ↔ types.ts`** (2-module SCC): `types` imports `buildings` for
   station and door constants, and `buildings` imports `types` for world constants.

**Leaves** (no local imports, safe to reason about alone): `balance`, `input`
(imports types only), `rng`, `fingerprint`, `focus-trap`, `voice-range`,
`settings`, `music-box`, `recovered-wards`, `svg-assets`, `db/*`, `rate-limit`.

---

## 8. Scripts and test suites

Run locally with the database on `DATABASE_URL`:

- `npm run typecheck` · `npm run lint` · `npm test` (= `scripts/run-unit.mjs`)
- `npm test` runs 12 DB-free suites, plus 7 DB suites (19 in total) when `DATABASE_URL` is set.

| Group | Scripts | Needs |
|---|---|---|
| Unit, DB-free | `test-rng`, `test-fingerprint`, `test-wards`, `test-house-wards`, `test-ward-ui`, `test-voice`, `test-voice-client`, `test-input`, `test-history`, `test-proximity`, `test-focus-trap`, **`test-polish-gate`** (new) | none |
| Unit, DB | `test-notes`, `test-time-engine`, `test-time-multi`, `test-time-nested`, `test-time-seeing`, `test-command-replay`, `test-replay-determinism` | `DATABASE_URL` |
| Wire and server | `test-wire` (SSE + long-poll, `BASE` env, default port 3000), `smoke-rooms` (restarts a server on port 3100), `smoke-stats`, `smoke-doors`, `smoke-cages`, `smoke-wards`, `smoke-time`, `smoke-tutorial`, `smoke-static`, `smoke-replay-observation`, `smoke-random` (`BASE`, count argv) | running server + DB |
| Browser | `smoke-browser`, `smoke-browser-prod.sh`, `smoke-time-browser`, `smoke-time-room-ui`, `smoke-art`, `qa-visual`, `smoke-voice` | Playwright + Chromium |
| Audio and assets | `analyze-audio` (offline mix levels, −24…−10 dBFS band), `test-house-assets` (**fails on main**: needs photos outside the repo, see trap T8) | node-web-audio-api / external dir |
| Build helpers | `build-static.mjs` (→ `public/play/`), `mayfly-client.mjs` (channel CLI) | — |
| Scratch (removed on this branch) | `.mobile-check*.mjs`, `.mobile-shot.mjs`, `.mse.mjs`, `.shot-svg.mjs`, `.smoke-pages.mjs`, `.smoke-refactor.mjs` | — |

---

## 9. Polish worker subsystem

Purpose: an isolated maintenance agent that picks one small polish, works in a
scratch clone and reports to a mayfly channel. It never pushes, deploys or
edits `/app`.

| File | Role |
|---|---|
| `src/server/polish-supervisor.ts` | Spawns the loop, **only if `HOLLOW_POLISH_WORKER=1` and `HOLLOW_MAYFLY_URL` is an `https://mayfly.chat/c/…` URL** (env only, since this branch). |
| `scripts/polish-loop.mjs` | Loop: prepares a clone under `.cache/polish/work`, runs free models over it, validates the diff, commits to a local `polish/*` branch, posts status. **Refuses to start unless `HOLLOW_POLISH_WORKER=1`** (this branch). |
| `scripts/polish-prompt.md` | Scope for the agent: one small UI or wording polish, ≤3 files, ≈100 lines. |
| `scripts/mayfly-client.mjs` | Channel CLI (read/post). |
| `src/app/api/polish/status/route.ts` | Reports `{enabled:false}` unless opted in. |
| `src/app/api/health/route.ts` | Calls `ensurePolishWorker()` on each health check. |

**Changes on `mallow/code-map-hygiene` (not on main, needs a human decision to merge):**

- Opt-in is now real: default off, and the loop itself also refuses to start without the flag.
- The channel URL is read from `HOLLOW_MAYFLY_URL` only. The committed file
  `scripts/mayfly-channel.txt` is untracked and gitignored. **Its key stays in
  git history**, so the channel owner should rotate it.
- `.env.example` documents the flag.
- Regression test: `scripts/test-polish-gate.mjs`.

---

## 10. Traps and debt found while mapping

These are things that cost time or would cost time for the next agent.
Items marked **fixed** are fixed on this branch. Everything else is listed for a
human or a later branch.

| # | Trap | Where | Status |
|---|---|---|---|
| T1 | `drizzle.config.json` hardcodes `postgres://postgres:postgres@…/app_db` and **ignores `DATABASE_URL`**. `npx drizzle-kit push` therefore targets the wrong database and reports "Did not find any relations". Apply `drizzle/0000_smart_mongu.sql` with `psql` if the URL differs. | `drizzle.config.json` | open |
| T2 | Opt-out polish worker, channel key committed in a public repo. | `scripts/mayfly-channel.txt`, `polish-supervisor.ts`, `polish-loop.mjs` | **fixed** on branch (opt-in, env-only, untracked; key still in history) |
| T3 | Standalone `/play` menu lists three expired E2B sandboxes as `SERVERS`, so Singleplayer can't be reached from the published build. | `static-src/main.ts` L19–23 | open (needs a permanent backend URL and a rebuild) |
| T4 | `WORLD_W = 4200` in `types.ts` is the *old town span* (spawn bounds), while `units.ts` `WORLD_SPAN = 12200`. Names collide. | `types.ts`, `actions.ts`, `rules.ts` | open (HANDOFF P4) |
| T5 | Was: `render.ts` (56 KB) and `TutorialClient.tsx` (53 KB) exceeded the AGENTS.md 50 KB rule. **Resolved:** `render.ts` is split into `render/` (`5e86fd6`); `TutorialClient.tsx` is split into `tutorial-*.ts`, `chapters.ts`, `TutorialOverlay.tsx`, `WardJobSurface.tsx` (`5ae46b7`). | `src/game/render/`, `src/app/tutorial/` | resolved (HANDOFF P3) |
| T6 | 13-module engine import cycle; `hooks.ts` header claims "no import cycles". | §7 | open (document, not refactor) |
| T7 | Dead backdrop village. `src/game/town.ts` is deleted (human-approved). `public/art/town/` and the `test-house-assets.mjs` asserts are left as they are. | `public/art/town/`, `scripts/test-house-assets.mjs` | partly resolved: town.ts deleted; art left in place |
| T8 | `test-house-assets.mjs` fails on main (external `../../malye-korely/` dir, asserts ≥100 town houses). | `scripts/test-house-assets.mjs` | open |
| T9 | Local smoke scripts hardcode ports and kill servers: `smoke-rooms` restarts on 3100 with `pkill -f next-serv[e]r` (kills any other Next server); `test-wire` defaults to 3000. | `scripts/smoke-rooms.mjs`, `scripts/test-wire.mjs` | open |
| T10 | Create rate limit is 20 towns per minute per IP. Running the smoke suite back to back trips it ("Too many towns from one address") and looks like a game bug. | `api/game/create`, `server/rate-limit.ts` | open (note in DEPLOY) |
| T11 | Duplicated header comment ("Presentational HUD overlays … split out of GameClient") copy-pasted into five HUD files; the description does not match `hud.tsx`, `chat.tsx` or `minimap.tsx`. | `bars.tsx`, `chat.tsx`, `hud.tsx`, `midhud.tsx`, `overlays.tsx` | open (cosmetic) |
| T12 | `public/play/game.js` (≈126 KB minified) is committed build output. Two agents editing `static-src/main.ts` will conflict on it. | `public/play/` | open |
| T13 | `Renderer.zoomOnly` / `setZoomOnly` had no callers (superseded by `viewZoom`). **Resolved:** removed in `5e86fd6`. | `src/game/render/` | resolved (HANDOFF P5.7) |
| T14 | Node: the project targets Node 22 (`ci.yml`, DEPLOY). Node 20 also runs everything here, but use 22 for parity. | `.github/workflows/ci.yml` | note |
| T15 | Sandbox ports: local Next servers should use 3100, not 3000, when a platform preview holds 3000. | HANDOFF, "Read this first" notes | note |

---

*End of map. If you change the module graph, regenerate §7 with the scan described there, and keep the file under 50 KB.*
