# Ward games & the First Night — porting guide for unified main

Base: `a968a1295` (2D valley map, painterly renderer, generative score, Strigoi identity).
Branch: `gloamwing-wards` — **additive only**. Nothing in this branch modifies an existing
file, so `main` stays the single source of truth and `SYNC.md` decisions 1–9 are untouched.

Two gaps the human named, both still open on `main`:

1. **"a lack of minigames for tasks"** — wards are still `TASK_HOLD_MS = 3200` hold-to-work.
2. **"No singleplayer tutorial."** — there is no solo mode at all; a night needs 3+ souls.

## 1. Ward games

`src/game/wards.ts` (new file, zero imports, no DOM/React) covers all **14 stations** on the
valley with five mechanics:

| Mechanic | Stations | Win | Server-side guarantee |
| --- | --- | --- | --- |
| `align` — Lantern Rites | lantern, gate, silo | every ring notch at the wick | replay of `turn` moves |
| `timing` — The Long Draw | well, woodpile, mill | 3 catches inside the band | marker position is sent, band is server-known |
| `lights` — Nine Candles | chapel, graves, laundry | all nine lit (Lights Out) | replay + `lightsPar()` rejects impossible solves |
| `sequence` — Crow Call | scarecrow, radio, beehive | 4 growing rounds repeated | calls derived from server seed |
| `trace` — The Furrow | pumpkins, bridge | walk the seeded path in order | replay of `step` moves |

### Wiring (engine-authoritative, clients still send intent only)

```ts
// types.ts — InputBody gains:
action?: ... | "ward";
ward?: string;      // station id
moves?: Move[];     // from src/game/wards.ts — never positions

// engine.ts — when a player starts a ward (in range, alive, not caged, not exhausted):
const seed = nextInt(room);                    // src/game/rng.ts
task.challenge = createChallenge(station.kind, seed);
task.challengeSeed = seed;                     // sent down in snapshot.tasks[]

// when the client submits { action: "ward", ward, moves }:
const result = validateSolution(task.challenge, body.moves);
if (result.ok) {
  task.done = true;
  p.stamina = Math.max(0, p.stamina - vigorCost(task.challenge.kind, result.moves));
  record(room, p, "ward_done", { ward: task.id, moves: result.moves, seed });
}
```

Because the challenge is `(kind, seed)` and the seed is in the snapshot, the client rebuilds the
identical board locally and plays it with no round-trips; the server replays the move list. A
modified client cannot fake a ward, cannot skip the work, and cannot see other players' boards.
`vigorCost()` preserves the canonical vigor rule (work drains; at 0 only ward progress halts) —
take `max(STAMINA_WORK_DRAIN * seconds, vigorCost(...))` so mashing is not cheaper than working.

Rendering: five small canvases or DOM boards. The reference implementation in `first-night/`
(`src/components/Minigames.tsx`) is a complete, tested React version of all four boards plus
solved/failed states — port the shapes, not the JSX, into `static-src/main.ts` and
`GameClient.tsx`. `WARD_COPY` holds the in-game voice for each mechanic.

## 2. The First Night — singleplayer tutorial

Six chapters, ~8 minutes, no server, no lobby, saved locally. Reference implementation is
playable today in `first-night/` (Vite + React + Tailwind, self-contained, `npm run build`).

| Ch | Teaches | Canonical rule it reinforces |
| --- | --- | --- |
| 0 | Take up the lantern, name yourself | lantern-limited vision |
| I | Walk the lane (hold arrows / A-D) | intent-only movement |
| II | Finish one ward game | shared wards, vigor, no timer punishment |
| III | Inspect a body at 3 evidence points, then report | report before you accuse |
| IV | Accuse one of four neighbours | evidence over hunch; cage not hanging |
| V | Dawn: the Hollow is revealed, ledger sealed | chronicle is end-of-match only |

Solo night (`first-night/` → "A Night Alone") is a full deduction run: 4 wards, a body, an
accusation, and a local Hall of Records. The Hollow is drawn uniformly at random with the
browser crypto RNG — the same property `scripts/smoke-random.mjs` proves for the multiplayer
deal. Every ward leaves one clue; exactly one clue is decisive and it always names the culprit's
own trade, so a careful reader is never punished by two contradictory explicit clues.

To ship it inside the Next app rather than as a separate bundle: `first-night/src/components/*`
map cleanly onto an `/first-night` route (client component, no API), and the pure ward logic is
already shared via `src/game/wards.ts`.

## 3. Identity claim — the Gloamwing

The specimen roster on `main` lists Vârcolac (SierraA), Wraith (Agent-Hollow), Banshee
(ArenaAgent) and Strigoi (current build). **The Gloamwing is unclaimed and this build wears it.**

`Lampyris memorialis` — a lantern-moth that drinks the smoke of snuffed lanterns and remembers
the names the morning edits out. It is deliberately *not* a fourth impostor or a hidden role:
it belongs to neither crew nor Hollow, cannot be voted for, and cannot enter the cage. It is the
night's witness and the tutorial's teacher, which is what a singleplayer prologue needs and what
the roster was missing. Additive entry for `CREATURES` in `src/game/types.ts`:

```ts
{
  id: "gloamwing",
  name: "Gloamwing",
  latin: "Lampyris memorialis",
  taken: false,                       // unclaimed before this build
  line: "It drinks the smoke. It remembers the names.",
  // sigil: four eyespots + two wing arcs + a curled antenna pair (see field guide plate)
}
```

If a creature must be able to *play*, leave the Gloamwing as a witness slot: it reads better as
the one specimen that never lies than as a fifth way to be the impostor.

## 4. Files in this branch

```
src/game/wards.ts        new — pure ward-game logic + server validation (no imports)
FIRSTNIGHT.md            new — this guide
first-night/             new — playable Vite/React reference: tutorial, solo night,
                         four ward minigames, field guide, Hall of Records, README
```

Validated in the reference build: `tsc --noEmit` clean, production build clean, all five views
exercised in headless Chromium (tutorial completed and persisted; a full solo night solved —
all four ward games, body reported, accusation filed, ledger written), zero console errors, and
zero horizontal overflow at 390×844.
