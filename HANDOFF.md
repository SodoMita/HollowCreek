# Hollow Creek handoff — merged velvet-dusk polish pass

**Date:** 2026-11-06
**Main:** `0a505d4` — "Merge pull request #5 from SodoMita/merge/velvet-dusk"
**Merged from:** `clover59/velvet-dusk-polish` (`e969a3f`, base) + `pippa/polish-pass` (`7ee4f70`, grafted)
**PR:** https://github.com/SodoMita/HollowCreek/pull/5
**Status:** merged to `main`; typegen, tsc, lint, build, all unit suites and every
smoke suite pass except two stale ones (§ Known issues). This handoff supersedes
the 2026-10-23 audiovisual handoff that was here before.

Two agents worked in parallel for several turns and then merged into one branch.
This document is the map for whoever comes next: what the code now promises,
what will break if you edit carelessly, and what is still wrong.

---

## 1. Read this first (operating notes for agents)

- **Chat is the coordination channel.** `AGENTS.md` has the mayfly URL for the
  current dev channel. Read it at the start of every turn, claim work, and post
  a summary with your branch SHA at the end. Say goodbye before you stop
  listening. Two agents editing the same files without talking is how this
  branch got two spyglasses and two wire formats.
- **Work on your own branch, PR onto `main`, then merge.** `SYNC.md` is the
  unification protocol: `main` is the single source of truth and every sandbox
  must end identical to it. After a merge: `git fetch origin && git reset --hard
  origin/main && git clean -fdx -e .env -e node_modules && npm ci &&
  npx drizzle-kit push --force`.
- **Run local servers on port 3100, not 3000.** Port 3000 belongs to the
  platform-managed preview; a local `next start` there is displaced and dies
  mid-suite (`ECONNREFUSED` right after a successful health check). Every smoke
  script takes the base URL as `argv[2]` and most read `BASE` from the env.
- **Nothing survives between turns except the project directory.** `.next/` is
  wiped (rebuild before `next start`), `/tmp` scratch is wiped, and
  `~/.cache/ms-playwright` may be gone. Keep scratch tooling under
  `.cache/` (gitignored) if you want it to persist.
- **An autonomous worker spawns from `/api/health`.** See § Known issues #1 —
  it is opt-out, not opt-in, and it is the first thing to disable in a fresh
  sandbox.
- **Do not edit `package.json` by hand in the arena workspace**; install
  dependencies with the workspace tool. In a plain clone, `npm ci` is correct.
  `esbuild`, `playwright` and `@opencode/cli` are real dependencies now, so the
  test scripts work after `npm ci`.

---

## 2. What the game is

A server-authoritative **1D** social-deduction game on one autumn road:
townsfolk ("Townfolk" in the UI; `role: "crew"` on the wire) mend shared wards
while one or two Hollows kill, sabotage and snuff the lights. Positions are
**integers** (`ix()` in `types.ts`) so replays and snapshots compare exactly;
the client interpolates and predicts. Movement is along x only — houses are a
layer, never a coordinate change.

The world spans **-3600 … 8600** world units (~432 m), with **17 wards** and
**6 buildings** (Tollhouse, Orchard House, Foreman's Office, Quarry Cottage,
Ferryman's Hut, Watchman's Lodge). There is **no backdrop village**: beyond the
road there are only wooded hills (see § Locked decisions).

### Where things live

| Concern | Files |
| --- | --- |
| Authoritative rules, tick, actions | `src/game/{engine,tick,actions,rules,balance}.ts` |
| Per-viewer state + vision filtering | `src/game/snapshot.ts`, `src/game/proximity.ts` |
| Persistence (rooms, roster, chronicle, stats) | `src/game/{persistence,chronicle,stats,history}.ts`, `src/db/schema.ts` |
| Ward minigames (13 kinds) | `src/game/{wards,recovered-wards,ward-ui,ward-art}.ts` |
| Time travel (recorded nights) | `src/game/{time-travel,timepieces,time-ui,history}.ts`, `docs/time-travel.md` |
| Rendering (canvas, both clients share it) | `src/game/{render,atmosphere,house-art,svg-assets}.ts` |
| Audio (generative, no files) | `src/game/{audio,music-box}.ts` |
| Sizes / scale | `src/game/units.ts` |
| Network wire format | `src/game/wire.ts`, `src/game/viewers.ts`, `src/app/api/game/state/**` |
| React client | `src/app/room/[code]/*.tsx`, `useGame{Stream,Render,Input,Overlays}.ts` |
| Standalone client (`/play`, itch, gh-pages) | `static-src/{main.ts,index.html}` → `scripts/build-static.mjs` |
| Singleplayer tutorial | `src/app/tutorial/TutorialClient.tsx` |
| Settings (client-local) | `src/game/{settings,settings-ui}.ts` |

Both clients import the *same* `src/game/*` modules — the standalone one is
bundled by esbuild into `public/play/game.js`. Editing a shared module changes
both, and **the committed bundle must be rebuilt** (§ Recipes).

---

## 3. Contracts you must not break casually

### 3.1 The wire format (`src/game/wire.ts` + `src/game/viewers.ts`)

This is the newest and most load-bearing contract. One viewer receives:

1. `{etag, now, snap}` — a full `Snapshot`, once on connect (and whenever the
   server cannot prove what the client holds).
2. `{etag, now, delta?, patch?}` — only what changed. `delta` carries changed
   **top-level** fields as full values; `patch` carries changed **items** of the
   id-keyed arrays (`players`, `tasks`, `doors`) as `{id, ...changedFields}` and
   changed fields of `self`. A membership/order change resends the whole list in
   `delta`.
3. `{now}` — a bare clock tick, once a second, when nothing else moved.

`applyFrame(held, frame)` on the client merges these; `null` on the wire means
`null` in state (consumers test `keyX !== null`, `winner === "hollow"`), and
only `time` may legitimately be absent.

**Slow class.** Values that drift every tick but are only *displayed* coarsely
are held and sent at most **once per second**, unless a fast change ships in the
same frame: `self.stamina`, `self.killCooldownMs`, `self.blackoutCooldownMs`,
`sabotageCooldownMs`, `nightT`, `danger`, `time`, and a ward's bare `progress`.
The quantisation that makes this lossless lives in `snapshot.ts`
(`coarseMs()` = whole seconds because the HUD renders `Math.ceil(ms/1000)`;
`nightT` to 1/1000; `progress` to 1/100; `time.latest` to 5 s).

> If you add a per-tick field to `Snapshot`, it will change the etag 20×/s and
> undo this work. Quantise it in `snapshot.ts` **and** add it to the slow sets
> in `wire.ts`, then run `scripts/test-wire.mjs`.

Measured on `main` (4 players, `next start`): idle **~320 B / 5 s per client**
(was 420 KB before this pass); a walking neighbour costs `{"id","x"}` frames at
≤10 Hz. `/api/game/state?delta=1&wait=1` is the long-poll (held ≤900 ms, 304
when nothing changed) used by the React fallback and the standalone client;
plain `GET /api/game/state` still returns a full snapshot for compatibility.

### 3.2 Prediction (client-side)

`useGameRender.ts` (and the same logic in `static-src/main.ts`) replays the
local steering log from `arrival − measured RTT` over the acknowledged server x,
so your own movement is never felt a round trip late. `Renderer.drawPlayer`
derives **facing and gait from the displayed motion**, not from the server's
`p.facing` — that was the "moonwalk" bug (the sprite slid backwards for one RTT
after every turn). Neighbour extrapolation is capped at one frame interval so
nobody drifts after stopping.

If you change movement speeds or add a movement modifier, update both
`walkSpeed()` implementations or the two clients will diverge.

### 3.3 `units.ts` — one place for scale

`FIGURE_H = 48` world units ≈ 1.7 m for the drawn traveller
(`public/art/characters/traveler.svg`, hood top → boot sole), so
`UNITS_PER_M ≈ 28.2`. Use `m(1.7)` / `units()` / `metres()` instead of new
magic numbers. World bounds, zoom factors (`ZOOM_READ = 3.2`, `ZOOM_MAX = 4`),
note sizes and the meeting house's real dimensions (`MEETING_HOUSE`) live there
and are consumed by `render.ts`, `ward-art.ts` and `buildings.ts`.
Balance *rates* (speeds, cooldowns, vigor) stay in `balance.ts` — locked.

### 3.4 The spyglass

One continuous zoom (`Renderer.setViewZoom`, 1…4×) driven by wheel, trackpad and
two-finger pinch; the button and `Z` snap between lowered and `ZOOM_READ`,
aimed at a nearby page when there is one. Lowering works via any key, a tap on
the scene, or the floating "Lower the glass" button. Page text is **inked on the
paper in-world** (`Renderer.drawNote`) — there is no pop-out page anywhere.
While the glass is up, HUD-like labels (names, bubbles, action text, ward signs)
are not drawn.

> `<main>` must **never** be made `inert` while the glass is up. That was the
> mobile "no way to exit" bug: `inert` disabled every button on the page,
> including the one meant to close it. Only real dialogs (ward panel, time
> panel, settings) may inert the scene — see `useGameStream.ts`.

---

## 4. Locked decisions (do not relitigate)

`SYNC.md` lists 9 human overrides (last-joiner host, presence = the state poll,
no duplicate seats, shared wards, vigor hysteresis, stats, sealed chronicle,
persistent towns). Added by the human during this pass:

1. **No houses in the background.** The old 100-house parallax village is gone.
   (It also referenced 104 SVGs of which 100 did not exist — a hundred 404s per
   page load.) Beyond the road: woods, hills, props.
2. **Nature needs space.** The fen, the graveyard woods and the ridge are open
   stretches; keep them open when adding props.
3. **18th-century atmosphere, fictional Massachusetts.** No modern software
   chrome on the home page (the mock app window became a printed broadside), no
   pulsing status LEDs. Lore strings still contradict this — § Known issues #3.
4. **Townfolk, never "Crew", in anything a player reads.** `"crew"` remains the
   wire/DB role value.
5. **Audio: the road keeps the original score.** `src/game/audio.ts` is the
   drone/motif engine the human preferred. `src/game/music-box.ts` is Clover's
   keeper's box and wakes **only** for intimate moments (hands on a ward, or
   walking the recorded past). Do not swap the whole score again.
6. **Sound levels are measured, not guessed.** Any audio change must be checked
   with `scripts/analyze-audio.mjs` (offline loudness/harshness analysis) —
   the human asked explicitly for common volume and nothing painful.

---

## 5. Validation

From the project root, in this order:

```bash
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
npm run test                 # 11 DB-free suites (18 with DATABASE_URL set)
npx drizzle-kit push --force # schema; currently "No changes detected"
```

Then a production server **on port 3100** and the suites that need one:

```bash
npm run build && npx next start -p 3100 &
B=http://127.0.0.1:3100
node scripts/test-wire.mjs                       # delta protocol, needs BASE=$B
for t in smoke-rooms smoke-doors smoke-wards smoke-cages smoke-stats \
         smoke-time smoke-tutorial smoke-voice smoke-replay-observation; do
  BASE=$B node scripts/$t.mjs $B; done
LD_LIBRARY_PATH=… node scripts/smoke-browser.mjs $B        # needs a browser
LD_LIBRARY_PATH=… node scripts/smoke-time-room-ui.mjs $B
LD_LIBRARY_PATH=… node scripts/smoke-time-browser.mjs $B
LD_LIBRARY_PATH=… node scripts/smoke-art.mjs
node scripts/smoke-static.mjs $B 8089 public/play          # cross-origin client
```

### Results as of this handoff (`main` + the two fixes in § Known issues #4)

| Check | Result |
| --- | --- |
| `next typegen`, `tsc --noEmit`, `eslint`, `next build` | pass |
| `npm run test` | 11/11 DB-free suites pass |
| `test-wire` | pass (46/46 SSE etag checks, 33/33 long-poll) |
| smoke-rooms / doors / wards / cages | pass (32 door, 49 ward, 29 cage checks) |
| smoke-stats / time / tutorial / voice / replay-observation | pass (51, 70, 29, 28) |
| smoke-browser / smoke-art / smoke-static | pass |
| smoke-time-room-ui / smoke-time-browser | pass after the two fixes below |
| `test-house-assets` | **fails** — stale, see § Known issues #2 |
| CI (`.github/workflows/ci.yml`) | typecheck, lint, 7 DB-free suites; DB suites + build only when the `DATABASE_URL` secret exists |

CI does **not** run the smoke suites or `test-wire` (they need a server/browser).
Run them locally before merging anything that touches networking, rendering or
the room client.

---

## 6. Known issues, in priority order

### 1. The "polish worker" is an opt-out autonomous agent inside the health endpoint

`src/app/api/health/route.ts` calls `ensurePolishWorker()`
(`src/server/polish-supervisor.ts`), which returns early **only** when
`HOLLOW_POLISH_WORKER === "0"` — so it is enabled by default on every
deployment, including previews. When `node_modules/.bin/opencode` exists it
spawns a detached `scripts/polish-loop.mjs` that, every 60 s, clones `main`
into `.cache/polish/work`, runs free LLM models over it, and **posts to the
mayfly channel stored in `scripts/mayfly-channel.txt`** as "Creek-Polisher".

Consequences seen in practice: it competes for RAM in a ~3.9 GB sandbox (local
`next start` processes got killed mid-suite), and it puts an agent loop you did
not start inside your preview.

- Immediate local mitigation: add `HOLLOW_POLISH_WORKER=0` to `.env`
  (untracked) and `pkill -f 'polish-loo[p]'`.
- Recommended fix: make it opt-in — `if (process.env.HOLLOW_POLISH_WORKER !== "1") return;`
  — which is what `.env.example` already implies ("Optional").
- **Security:** `scripts/mayfly-channel.txt` contains a mayfly channel URL
  *including its `#key`* in a **public** repo. `.env.example` itself calls that
  URL a secret. It should be deleted and read only from `HOLLOW_MAYFLY_URL`.
  It cannot be pushed to (no credentials in the loop), but it can post.
- `/api/polish/status` is public and reports the worker's branch, commit, files
  and result. Decide whether that should be authenticated or removed.

### 2. Dead backdrop-village code and an unrunnable test

The village is no longer drawn, but its data and test remain:
`src/game/town.ts` (`TOWN_HOUSES`), `public/art/town/` (`houses.json` now has
**0** entries + 4 unused `house-*.svg`), and `scripts/test-house-assets.mjs`,
which asserts `TOWN_HOUSES.length >= 100` *and* requires reference photos at
`../../malye-korely/photos/*.jpg` — outside the repo, so it cannot pass in any
clean checkout. It is not in `run-unit.mjs` or CI, so nothing notices.
Delete all three (or restore the manifest) — but confirm with the human first,
since `public/art/reference/*` and `public/art/README.md` document the real
Malye Korely provenance of the facade art.

### 3. Lore still contradicts the human's setting

The human asked for **18th-century fictional Massachusetts**; the repo still says:
- `src/app/page.tsx:151,197` and `static-src/index.html:160` and
  `release/full-description.txt:4` — "October, **1893**".
- Anachronistic wards in `src/game/types.ts`: "Repair the **radio** tower"
  (`radio`), "**Rewire** the street lantern" (`lantern`), "repair the **fuses**"
  (`fusebox`). Period-safe alternatives: a signal beacon/semaphore, a
  tallow-lantern relighting, a hearth or mill mechanism. The ward *kinds* drive
  minigame code, so rename the display strings and art, not the `kind` ids.
- `public/art/README.md` still describes Pomor / Malye Korely log houses and
  says "the four `house/facade-*.svg`" (there are now six).

### 4. Two merge regressions (fixed in the commit that adds this handoff)

- `src/app/room/[code]/hud.tsx` — the React `NoteReader` carried the page text
  for screen readers but not the author, so `smoke-time-room-ui.mjs`
  ("the page names its author") failed. The sr-only line now reads
  `text — pinned by author`, matching the standalone client.
- `scripts/smoke-time-browser.mjs:52` — hardcoded `/1 \/ 13/` for the ward
  counter; the town now has 17 wards. It now parses "done / total" and asserts
  one repaired ward and a total ≥ 13, so adding wards will not break it again.

### 5. The published static client points at dead servers

`static-src/main.ts` `SERVERS` lists three **expired e2b sandbox URLs**
(`3000-iv1ax3…`, `3000-ihrqg7…`, `3000-irlhq61…`). Arena preview URLs are
per-sandbox and die with the sandbox, so:
- the `/play` client on GitHub Pages / itch.io / Newgrounds cannot join a town;
- its "Singleplayer Tutorial" link (built as `server + "/tutorial"`) 404s —
  this is very likely the "singleplayer can't be entered" report.
Fixing it needs a **permanent** backend (Fly.io / Render / Railway / a small VM
— see `DEPLOY.md`), then `SERVERS = [<that url>]`, `node scripts/build-static.mjs`,
and re-publishing `public/play/` to `gh-pages` plus a new direct-static ZIP for
the portals. Until then the in-app React client (served by the same process) is
the only working client.

### 6. Smaller cleanups

- `Renderer.zoomOnly` / `setZoomOnly` in `src/game/render.ts` have no callers
  left (superseded by `viewZoom`); kept only as a compat alias. Remove or wire.
- Seven unreferenced scratch scripts were committed:
  `scripts/.mobile-check.mjs`, `.mobile-check2.mjs`, `.mobile-shot.mjs`,
  `.mse.mjs`, `.shot-svg.mjs`, `.smoke-pages.mjs`, `.smoke-refactor.mjs`.
  Nothing references them; `git rm` them.
- Stale PRs **#1** (`nightjar/ward-games`) and **#2** (`nyx/nightwatch-doors`)
  are still open against `main` and now conflict heavily. Close them.
- Branches `pippa/polish-pass`, `clover59/velvet-dusk-polish`,
  `merge/velvet-dusk` are fully merged; delete after a human confirms.
- `npm audit` reports vulnerabilities in the full install (pre-existing; the
  audio/netcode work did not touch dependencies).

---

## 7. Recipes that are easy to get wrong

### Headless browser in a minimal sandbox

`npm ci` installs `playwright`, but the browser binary and its system libs are
missing. What works (Debian 12, no root):

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

Traps: mixing Debian-13-era `libatk`/`at-spi2` versions gives
`undefined symbol: atk_object_get_help_text`; the extracted `libexpat` needs
GLIBC 2.38. Launch with `--no-sandbox --disable-gpu`. In Playwright, room pages
**never** reach `networkidle` (the SSE stream stays open) — use
`domcontentloaded`.

### Audio measurement

`scripts/analyze-audio.mjs` drives the real `AudioDirector` and asserts loudness
tiers / no clipping. It needs `node-web-audio-api`, which needs `libasound.so.2`
(same .deb trick as above). Note the harness works around a
`node-web-audio-api` bug: a `setTargetAtTime` scheduled in the future with no
earlier event corrupts the param *before* its start time, so every such call is
anchored with `setValueAtTime`. Do not remove that patch or the numbers become
nonsense (they read like +120 dBFS).

### Static bundle

```bash
node scripts/build-static.mjs   # static-src → public/play/{index.html,game.js}
```

Commit the rebuilt `game.js` whenever `static-src/` or any shared `src/game/*`
module changes. Byte-diffs between two builds of identical source are normal
(esbuild mangles identifier names differently run to run) — check semantics, not
bytes. `index.html` must sit at the root of any portal ZIP, not in a `play/`
folder (see `DEPLOY.md`).

### Rooms for manual testing

```bash
B=http://127.0.0.1:3100
curl -sX POST $B/api/game/create -H 'content-type: application/json' \
  -d '{"playerId":"a","name":"Ada"}'          # → {"code":"XXXX"}
# a game needs ≥4 souls before `{"action":"start"}` is accepted
```

`/api/health` is the platform's readiness probe; `/api/game/state` answers 304
when `rev` matches, so use `delta=1&wait=1` to watch frames.

---

## 8. Suggested next work

1. Land the permanent backend and re-point `SERVERS` (§6.5) — until then the
   published clients are broken for real players. This unblocks publishing.
2. Kill the opt-out polish worker and the committed channel secret (§6.1).
3. Lore pass to 18th-century Massachusetts (§6.3): date, ward names, art README.
4. Metric pass over the rest of the art now that `units.ts` exists: houses,
   cages, cart, lantern, trees — replace magic numbers with `m()` and re-check
   the camera's vertical budget.
5. Delete the dead village data and its test, and the scratch scripts (§6.2, §6.6).
6. Add `test-wire` and (if CI can get a browser) `smoke-browser` to CI so the
   netcode contract cannot regress silently.
