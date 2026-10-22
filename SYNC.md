# UNIFICATION PROTOCOL — both agents must end identical

**Single source of truth: `main` of this repo.** The human requires both
sandboxes to run the exact same code at turn end.

## Sync steps (run in your sandbox project root)

```bash
git fetch origin
git reset --hard origin/main
git clean -fdx -e .env -e node_modules
npm ci
npx drizzle-kit push --force   # schema: game_events (jsonb data — no int-x bug)
npx next typegen && npm exec tsc -- --noEmit && npm run build
```

Then confirm on mayfly.chat with the SHA from `git rev-parse HEAD`.
Do **not** keep `agent-hollow` (or any branch) as a divergent runtime —
it is archived history; port ideas via PR-style diffs into `main`.

## Locked decisions (human overrides — do not relitigate)

1. **Last joined player is host.** Every new lobby join takes the lantern;
   on leave/disconnect the newest remaining player is promoted. A tick
   invariant guarantees the lobby always has a host while non-empty.
2. **Presence = the 100ms state poll.** `snapshot()` refreshes `lastSeen`;
   input is not required to stay "connected". Leave beacon handles tab close;
   12s stale-host handoff and 75s lobby pruning are the safety nets.
3. **No duplicate seats.** Rejoining under the same name after >8s silence
   re-adopts the stale seat; the server returns the canonical `playerId`
   and the client stores it. Never spawn "name-2".
4. Server-authoritative 1D movement, input-only clients, server-side vision
   filtering, all actions recorded to Postgres (`game_events`, jsonb).

## Verified e2e (scripts run against production build)

- kill → report → bell → walk-to-square → vote → cage → win conditions
- cage clamp, caged speech/vote, iron key pickup / unlock (key drops by cage)
- blackout radii + shared cooldown, vision occlusion in snapshots
- host: solo → last-joiner → leave-promotes-newest → watching-host stable
  → stale-name re-adoption without duplicates → host never nobody
## Locked decisions (added later — canonical merged implementation)

5. **Wards belong to the town, not to a person.** `room.pool` holds
   `min(9, 2 + 2×crew)` shared wards; any living townsperson may work any of
   them and the crew wins when all are done. No per-player task list, no
   redistribution — a death can never hold the work hostage.
6. **Vigor (stamina), 0..1.** Working drains 0.10/s; kill −0.35, snuff −0.30,
   bell −0.15, unlock −0.10. Below 0.30 work slows linearly; at 0 the player is
   `exhausted` (hysteresis: must idle back to 0.20 before work resumes — this
   prevents a regen/drain micro-oscillation crawl). Idle regen 0.09/s; walking
   neither drains nor recovers. Actions are NOT refused at 0 — only ward
   progress halts (human spec). Snapshot: `self.stamina`, `self.exhausted`.
7. **Statistics.** `player_stats` (see `src/db/schema.ts`, bumped atomically via
   `src/game/stats.ts`): games, wins, losses, kills, deaths, tasksDone,
   chatChars, cagings, reports, unlocks, blackouts, bells, playtimeSec.
   Shown at `/stats` (Hall of Records, linked from landing + end screen) and as
   JSON at `/api/game/stats`. Smoke: `node scripts/smoke-stats.mjs`.
8. **The chronicle is sealed during a match** (human request): `/chronicle/CODE`
   shows a sealed notice while the room is playing/meeting — it names the
   Hollow, so mid-match access would be cheating. Readable at match end, in the
   lobby, and for archived towns. No chronicle link in the in-game top bar.
9. **Towns persist in Postgres** (`rooms` + `room_players`, write-behind flush,
   `loadRoom` hydration, parked seats immune to lobby pruning until claimed).
   Rematch: host `restart` from ended keeps the same souls in the same code.
