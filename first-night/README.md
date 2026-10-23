# Hollow Creek — The First Night

A singleplayer prologue / companion build for **Hollow Creek**, the one-street folk-horror social-deduction
game. It follows the canonical multiplayer design in `SodoMita/HollowCreek` — shared town wards, lantern-limited
vision, a town square, an iron cage, and a Hollow drawn at random — and adds the two things the creek was
missing:

1. **Four real ward minigames**, one per chore. No hold-to-fill progress bars.
2. **A complete singleplayer tutorial**, taught by an original creature of the night: **the Gloamwing**.

## The Gloamwing

A lantern-moth that drinks the smoke of snuffed lanterns and remembers the names the morning edits out.
It belongs to neither the town nor the Hollow. It is not a hidden role and cannot be voted for; it is the
witness who keeps this edition's field notes. The identity was chosen specifically so it does not duplicate
the Hollow, the town, or any earlier agent's contribution.

## Alignment with the shared codebase

This build began from the human's unification request and the current `SodoMita/HollowCreek` docs (`SYNC.md`,
`HANDOFF.md`, release copy, and shared types): October 1893; one walkable lane; lantern-limited vision; shared
town-owned wards; vigor; report → bell → square → cage; the Hollow dealt randomly (never by join order); and a
sealed chronicle. It is a self-contained Vite/React companion rather than a rewrite of the Next.js game server,
so it deliberately has no fake multiplayer.

## What is playable

- **The First Night** — six chapters: lantern, lane, ward, body, square, dawn. Progress is saved locally.
- **A Night Alone** — a full solo night: four ward games, one random Hollow from four neighbours, one decisive
  clue and three supporting details, a body to report, and an accusation with a permanent local record.
- **Ward practice** — every minigame is playable from the landing page without starting a night.
- **Field Guide** — the Gloamwing plate and the game's three company-keepers.
- **Hall of Records** — seals and the local night ledger, with a confirmed reset.

## Minigames

| Ward | Game | Mechanic |
| --- | --- | --- |
| Street lantern | Lantern Rites | Three independent rotating bands; align each sigil with the wick |
| Old well | The Long Draw | Timing window, three catches, four misses reset |
| Chapel | Nine Candles | Lights Out on a custom nine-candle cross board |
| Scarecrow | Crow Call | Growing watch-and-repeat sequence, four rounds |

## Stack

React 19 + Vite + Tailwind CSS 4, TypeScript, lucide-react. No backend, no accounts. All randomness uses the
browser crypto RNG. Generated art and a small procedural WebAudio bed; no audio files.

```bash
npm install
npm run dev
npm run build
```
