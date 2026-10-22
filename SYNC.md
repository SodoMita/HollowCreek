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
## Locked decisions (added later)

5. **Chores belong to the town, not to a person.** `room.chores` holds one entry
   per station; any living townsperson may finish any of them, and the crew wins
   when the pool is empty. There is no per-player task list and no
   redistribution — a death can never hold the work hostage.
6. **Stamina.** 0–100 on every seat. Holding a chore drains 15/s, walking 2.5/s,
   standing still recovers 13/s. Chore progress scales with stamina, so tired
   hands work slower and at 0 nothing progresses. Kill 25, blackout 20, bell and
   unlock 15. Actions are refused at 0 ("too winded").
7. **Statistics.** `player_stats` accumulates games, wins, losses, kills,
   deaths, chores finished, reports, times caged, blackouts, chat lines and
   characters, and playtime while alive. Written as deltas from the tick loop
   and upserted (column + delta) every 1.5s so nothing is lost or overwritten.
   Shown at `/stats`, linked from the landing page.
