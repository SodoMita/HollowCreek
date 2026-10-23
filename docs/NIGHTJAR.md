# The Nightjar addition — ward minigames + the singleplayer school

Two gaps the human named: **no minigames for tasks**, **no singleplayer tutorial**.
Nothing here changes a rule the SYNC.md locks: the ward pool stays the town's
(decision #5), vigor keeps its drain/regen/slow/hysteresis numbers (#6), vision
stays the server's, and clients still send intent only.

## Identity

The creature of the night everyone else passed over: the **nightjar**
(*Caprimulgus crepusculi*), the goatsucker of parish lore. Vampire, wolf, wraith,
banshee and the Strigoi were taken; the roster in `src/game/types.ts` had no
nightjar at all, so it is added there as a seventh face with `claimedBy: "Nightjar"`.

It is the guide of the tutorial because it *eats warnings* — the danger meter is
voiced as the bird's feathers going up, not as a UI widget.

## `src/game/minigames.ts`

Fourteen wards, ten mechanics, one seeded state machine each:

| ward | mechanic | hand tested |
| --- | --- | --- |
| pumpkins | `pick` | discernment — ripe only, rot spoils the cart |
| well / lantern | `meter` | timing / precision, tolerance shrinks per hit |
| mill / woodpile | `multi` | rhythm across three wheels at different speeds |
| scarecrow | `order` | sequence — wrong hole re-pulls the seam |
| beehive / gate | `band` | breath + nerve — hold in the band, punish drift |
| chapel | `memory` | five-step recall, failure replays |
| laundry | `reflex` | reaction under a clock |
| silo | `dials` | deduction from a carved code |
| graves | `pick` | restraint — striking a stone is audible |
| bridge | `balance` | keep the plank level for ten seconds |
| radio | `tune` | listening, no picture at all |

API: `createSession(kind, seed)` → `step(session, dtSeconds)` →
`act(session, name, value)`. Pure, no DOM, no React, deterministic per seed, so an
authoritative tick can run it and a client can only propose actions.

**Engine hook (one place, currently `interactHeld` accumulation):**

```ts
// was: t.progress += (TICK_MS / TASK_HOLD_MS) * factor
const next = act(step(player.session, TICK_MS / 1000), ev.act, ev.v);
t.progress = next.progress;
player.session = next;
if (next.done) { completeWard(room, t); player.session = null; }
if (next.failed) { t.progress = 0.15; player.session = null; }
```

`InputBody` gains `minigame?: { act: string; v?: number }`; the legacy
`interactHeld` path stays so old static clients keep working.

## `src/game/tutorial.ts`

Eight feathers, each gated by `featherDone(feather, snapshot)` on real state:
walk 210px, light one ward, recover vigor past 70%, feel `danger`, cast a ballot,
take the key. Data + predicate only — no lesson logic can drift between clients.

## Verification run here

`npm run build` of the unified React/static pair, plus a headless pass through all
fourteen sessions (create → act → complete/fail) and the tutorial gates.
