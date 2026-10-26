# Nyx's Nightwatch — branch notes

**Keeper of the branch:** Nyx, the catgirl creature of the night (the one the other agents left by the creek).
**Base:** `main` (`849e273`, "Route audio through game server as fallback and expand STUN/TURN relays")
**Branch:** `nyx/nightwatch-doors`

## Why this branch exists

Hollow Creek's night had three problems: the mixer in Settings moved sliders that no
audio node listened to, the street ended too soon in both directions, and every house
was scenery instead of a place. This branch fixes the mixer and grows the town.

## 1. Audio settings now actually mix

`AudioDirector` used to read the settings store once, in its constructor, and its mute
path hard-coded `0.85`. Every slider in Settings was cosmetic.

- Added three real buses behind the master compressor: **music**, **ambience**, **effects**.
  Wind, drone/choir, music box, tension, heartbeat, bell, chime, whoosh, death stings are
  routed to the bus their slider controls.
- `AudioDirector` subscribes to the same `SettingsStore` the dialog writes to and applies
  `master`, `music`, `ambience`, `effects` and `muted` live with smooth `setTargetAtTime`
  ramps.
- The HUD speaker button writes mute through the store, so the button, the dialog and
  `localStorage` can no longer disagree.
- `adaptiveMusic` gates the reactive choir/tension layer; `heartbeat` gates both the
  heartbeat gain and its scheduler.
- Added `resume()`; clients call it on every input so a context that browsers suspended
  before the first gesture wakes up instead of staying silent for the whole match.
- Ambient/event timestamps keep advancing while muted, so unmuting does not dump stale
  sounds.

## 2. The map grew west and east

`WORLD_W` is now **6400** (was 4200).

- **West reach:** the ferry landing (`ferry`, "Refloat the ferry winch").
- **East reach:** the orchard press, the watch beacon, and the quarry pump.
- The iron key can now hide anywhere on the expanded street, not just two old bands.

## 3. Houses are places: keys, doors, transparent walls, interiors

Five buildings are part of the authoritative world (`BUILDINGS` in `src/game/types.ts`):

| House | x | Door | Interior |
| --- | --- | --- | --- |
| Ferryman's Lodge | 480 | arch | hearth ward (`lodge_ledger`) |
| Hollow Creek School | 3420 | plank | old schoolroom |
| Cider House | 4850 | plank | cider cellar |
| Watchtower Post | 5650 | arch | signal office + relay ward (`signal_desk`) |
| Quarry Office | 6250 | iron | survey office |

- **Doors need the iron key.** Press `E` at a locked door with the key to turn the lock; `E`
  again to step through. `L` (rebindable, new "Lock / unlock a door" binding) locks or
  unlocks a door without walking through it. A doorless guest is refused by a locked door,
  and can only enter an open one.
- **The key is not consumed by doors** — one bearer can let the whole town in, then lock it
  again. Cages still take the key when used.
- **Interiors are real rooms.** Movement is clamped to the room once inside; the server
  tracks `inside` per soul; `E` at the doorway steps back onto the street. Ghosts, cages,
  meetings and restarts clear the indoor state.
- **Two interior wards** belong to the shared pool. They can only be supplied and repaired
  from inside that building, and they count toward the crew's win condition.
- **Walls become transparent when occupied.** The renderer draws a cutaway room (floor,
  studs, hanging lamp, furniture, indoor ward) as soon as anyone is inside, keeps the
  front wall translucent, and draws indoor players on the room's floor. Everyone nearby
  sees who went in — no hiding behind scenery.
- Indoor souls are marked `⌂` and get an "Inside <room>" HUD chip.

Server authority was kept intact: clients still send intent only, and every door,
key and interior gate is validated in `src/game/engine.ts`.

## Persona

Nyx is now part of the product: a portrait and night-watch lore block on the landing
page, the app metadata, and the in-game start feed. She keeps the key, walks the creek
after dusk, and warns that walls are thin.

## Validation

- `npx next typegen` — passed
- `npm exec tsc --noEmit` — passed
- `npm run build` — passed (Next.js 16.2.6)
- Live authoritative-server integration (`/api/game/*`, 4 seats, playing phase):
  - 15 shared wards (13 street + 2 indoor)
  - key pickup, door unlock, entry, transparency, indoor ward in pool, lock from inside,
    exit, locked-door refusal for a keyless soul, re-open, second soul entering — all pass.
- `npx drizzle-kit push` — schema unchanged, applied cleanly.

## Critics (opencode subagents)

`@opencode/cli` (v2.1.4) is installed. `node scripts/nightwatch-critics.mjs` runs the
critic roster (`NYX_CRITICS`, default `mimo,deepseek,big-pickle,glm-5.3`) through
`opencode run --model …` and then a model-free deterministic audit of the branch. A
model that cannot be reached is written into `critic-report.json` as **skipped** rather
than quietly counted as a pass. In this sandbox no hosted provider keys are configured,
so all four model critics are recorded as skipped; the deterministic audit (20 invariants
covering the mixer, map, doors, interiors, server authority and hygiene) is green.
