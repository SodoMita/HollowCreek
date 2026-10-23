# Hollow Creek handoff — audiovisual and settings update

**Date:** 2026-10-23  
**Implementation commit:** `e1dea835c808a80d41cd32d937d2544594870549` (`Add adaptive audiovisual settings`)  
**Base:** `8111cdc271c70d6ede17e90d0bfd00fc179792f5`  
**Status:** implementation, browser checks, gameplay regressions, and direct-static packaging are complete. This handoff is included in a separate documentation commit.

## Delivery state

- Local `main` contains the implementation and this handoff.
- **Nothing from this update has been pushed or published.** The earlier GitHub release `v1.2-static`, remote `main`, `gh-pages`, and live portal uploads do not include it.
- The new local archive is `/home/user/hollow-creek-web.zip`.
- No backend or authoritative gameplay rules were changed. In particular, vision range, roles, movement, host semantics, polling presence, voting, and room hydration were not modified.
- The existing temporary E2B entries in `SERVERS` remain. Configure one permanent authoritative backend before a real publication.

## What changed

### Settings

Added `src/game/settings.ts` and `src/game/settings-ui.ts`, shared by the React and standalone clients.

- Four-tab dialog: **Audio, Graphics, Interface, Controls**.
- Available from the full-site home page, static menu, in-game HUD, lobby, and end screen.
- Persistent local storage under `hc_settings_v1`; the old `hc_muted` value is migrated.
- Audio: master, music, ambience, effects, mute, adaptive score, proximity heartbeat.
- Graphics: low/medium/high detail, 50–100% render resolution, leaves, fog, glow, vignette, horror flicker, camera smoothing, reduced motion.
- Interface: 80–130% scale, HUD opacity, touch controls, ward list, event feed, interaction hints, player names, speech bubbles.
- Controls: rebind left, right, interact, ability, blackout, and chat; hold or toggle chore input.
- Arrow keys and Space remain fallback controls unless explicitly assigned elsewhere. Conflicting custom bindings are swapped rather than duplicated.
- Opening settings releases movement and interaction. Toggle interaction also stops on chat, leave, or window blur.
- Reduced-motion system preference is respected on first use.
- The gameplay darkness mask is deliberately **not** optional; decorative settings cannot expand authoritative vision.

### Music and sound

Reworked `src/game/audio.ts` without adding audio downloads.

- Separate music, ambience, and effects buses feed a master compressor.
- Independent perceived-volume controls and smooth live gain changes.
- Structured sixteen-step theme and answer phrase, bowed bass/pad, dark feedback echo, meeting ostinato, danger dissonance, role stings, and ending stings.
- Improved wind, creaks, bell partials, blackout sweep, crow calls, footsteps, and heartbeat.
- Event timestamps advance while muted, preventing stale sound bursts on unmute.
- Audio resources are closed on React client unmount.

### Graphics

Expanded `src/game/render.ts` and the static menu presentation.

- Layered dusk gradient, deterministic stars, moon halo/craters, drifting cloud banks, and two hill layers.
- More detailed autumn trees, road ruts, fences, stones, leaf piles, ground fog, and falling leaves.
- Improved window glow/frames, lantern light, character silhouettes, sleeves, cloak folds, hood rims, and grounded shadows.
- Quality presets control decorative density and pixel-ratio caps; resolution changes apply live.
- React and static HUDs share scale, opacity, visibility, and reduced-motion preferences.

### Release metadata

- `release/full-description.txt` now documents the settings and updated procedural score.
- `release/README.md` notes that preferences are browser-local and need no backend changes.

## Validation completed

| Check | Result |
| --- | --- |
| `git diff --check` | Passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `node scripts/build-static.mjs` | Passed; `game.js` is 61,528 bytes |
| `npm run build` | Passed with Next.js 16.2.6 |
| Standalone Chromium settings/input suite | Passed; zero page/console errors |
| React Chromium settings/input suite | Passed; zero page/console errors |
| Mobile menu checks at 390×844 | Both clients passed; no horizontal overflow |
| `node scripts/test-rng.mjs` | Passed; chi-square 2.85 |
| `node scripts/smoke-stats.mjs http://127.0.0.1:3100` | 10/10 passed |
| `node scripts/smoke-random.mjs … 200` | Passed |
| `node scripts/smoke-random.mjs … 60` | Passed |
| `node scripts/smoke-static.mjs … 8090 public/play` | Cross-origin gameplay/CORS suite passed |
| `BASE=http://127.0.0.1:3100 node scripts/smoke-rooms.mjs` | Restart persistence, concurrent joins, and immediate snapshots passed |

The two browser suites used a deterministic mocked authoritative snapshot. They verified settings persistence after reload, keyboard-accessible sliders, remapping, old-key removal, arrow/Space fallback conflict handling, hold/toggle interaction, input release when settings open, mute persistence, live graphics preferences, mobile dialog bounds, and nonblank canvas rendering. Sampled canvas diversity was **916 colors** in the static client and **908** in React. Desktop/mobile screenshots were also inspected.

The API/gameplay suites used a real local Next production server and disposable PostgreSQL 17 database. They did not create rooms on a public deployment. All disposable servers and the database were stopped afterward.

**Audio limitation:** Chromium exercised the WebAudio graph without runtime errors, but a headless test is not a human listening review. Do a final listening pass on speakers/headphones and at least one mobile device before publication.

## Direct-static archive

`/home/user/hollow-creek-web.zip`

- Size: **702,166 bytes**
- SHA-256: `009afc54620a7464e2b21f4a14a980b76c50966e88e9701c8a4ba7b9616c0286`
- Root entries: `index.html`, `game.js`, `favicon.ico`, `icon.png`, `icon-192.png`, `icon-512.png`, `icon-1024.png`
- No nested directory, iframe wrapper, server code, or environment file.
- Extraction was verified byte-for-byte against `public/play`.

Generated file hashes:

- `public/play/game.js`: `67bb1cbc392111e82fdbd9a182ba936133dbf77db99fd918806dea99fbfa3719`
- `public/play/index.html`: `5e38e47008d544bd009fb6fe770e9f10a7dbea88ff000368a412370c9e203129`

Inspection screenshots are saved outside the repository under `/home/user/hollow-creek-*-{visual,settings,mobile-settings,mobile-menu}.png`.

## Remaining actions for release

1. Review the screenshots and perform the human audio/gameplay pass.
2. From an appropriately credentialed environment, push local `main` to GitHub.
3. Put the permanent authoritative backend first in `SERVERS`, rebuild, and rerun the static smoke test if that configuration changes.
4. Publish `public/play/` to `gh-pages` if the Pages client should be updated.
5. Upload the new direct-static ZIP to itch.io. Re-create/replace a Newgrounds submission only if desired; its earlier submission was removed before human adoption.
6. Tag a new release only after deciding the deployed backend and archive are final. Do not overwrite the meaning of the existing `v1.2-static` tag.

The full-install npm audit still reports dependency vulnerabilities. Dependency upgrades were outside this audiovisual task and were not attempted.
