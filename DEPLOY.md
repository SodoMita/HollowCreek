# The Hollow Creek Bell

A 1D side-scrolling social-deduction horror game set in a small autumn town.
Among-Us-shaped roles, but the whole world is one long street you walk left and
right along.

## How it plays

- **Server-authoritative movement.** The client only ever sends `{type:"move",
  dir: -1|0|1}`. The server integrates position at 20 Hz, clamps it to the
  street, and pushes snapshots back over SSE. Clients predict their own walk and
  interpolate everyone else. A watchdog stops anyone whose input stops arriving,
  so a closed tab cannot leave a ghost sliding forever.
- **Vision is server-side.** You only receive players, bodies and speech bubbles
  that are inside your lantern radius, so a hacked client cannot wallhack.
- **Roles.** ~1 in 4 players is one of *them*. Crew do chores; the thing kills,
  snuffs every lantern in town, and slips between hedges (the 1D version of
  vents).
- **Speech bubbles.** Press `T`; words float out of your head and only people
  who can see you can read them. Ghosts whisper only to ghosts.
- **The bell and the cages.** Reporting a body rings the bell. Everyone then
  *walks themselves* to the cages in Harvest Square — no teleporting. The town
  votes; the loser is locked in a cage. Caged players keep talking, keep voting,
  and can be freed three ways: a later vote, the iron key hidden somewhere on
  the street, or being killed in their cell.
- **Everything is recorded.** Every join, step, task, kill, vote, key and word is
  written to PostgreSQL and shown on the per-room chronicle page:
  `/chronicle/CODE`.

## Local run

```bash
npm install
npx drizzle-kit push      # create the tables
npm run build && npm start
```

Open the site on several devices, create a town, and share the 4-letter code.

## Deploying to E2B

This repo is a single Next.js app with one Node process (the game engine is an
in-memory singleton on `globalThis`), so it must run as a long-lived server, not
as serverless functions.

```bash
e2b template build -n hollow-creek   # base image with node 22
e2b sandbox create -t hollow-creek
```

Inside the sandbox:

```bash
git clone <this repo> && cd app
npm ci
export DATABASE_URL=postgres://user:pass@host:5432/db   # any managed Postgres
npx drizzle-kit push
npm run build
npm start -- -p 3000
```

The sandbox's public URL (`https://<sandbox-id>.e2b.app`) is then the link to
share; set it as `NEXT_PUBLIC_SITE_URL` if you want absolute links. The in-memory
rooms reset if the process restarts, but the full action history survives in
Postgres.

## Layout

| Path | What it is |
| --- | --- |
| `src/server/engine.ts` | authoritative sim: movement, roles, kills, meetings, cages, snapshots |
| `src/server/recorder.ts` | write-behind recorder for every action |
| `src/lib/world.ts` | the street: landmarks, chores, hedges, cages, tuning |
| `src/app/api/stream` | SSE snapshot push |
| `src/app/api/input` | client intent in, outcomes out |
| `src/components/WorldScene.tsx` | parallax renderer, figures, bubbles, cages |
| `src/components/GameClient.tsx` | input, prediction, HUD, meeting overlay |
| `scripts/smoke.mjs` | end-to-end gameplay test against a running server |
