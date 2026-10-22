# Running and releasing Hollow Creek

The game is a static browser client plus an authoritative Next.js/Postgres
server. The server must run as **one long-lived Node process**: active rooms
live in memory, with Postgres used for the roster and chronicle. Serverless
invocations and multiple independent production instances are not substitutes
for that process.

## What each piece is

| Piece | Where | Notes |
| --- | --- | --- |
| Authoritative server | this repo (`npm start`) | owns every position, role, cooldown and outcome |
| In-app client | `/` and `/room/CODE` | React client served by the same process |
| Static client | `/play` | built by `node scripts/build-static.mjs` from `static-src/` |
| Published static client | https://sodomita.github.io/HollowCreek/ | the `gh-pages` branch |
| itch.io / Newgrounds build | GitHub Releases | a direct static ZIP; **no nested iframe** |

## Quick start

Use Node 22 and any PostgreSQL database:

```bash
npm ci
cp .env.example .env          # set DATABASE_URL
npx drizzle-kit push --force  # creates the four game tables
npm run build
npm start                     # one process, port 3000
```

Open `/` on several devices, found a town, and share the four-letter code.
`GET /api/health` returns `{"ok":true}` when the process is ready.

## E2B and other temporary backends

E2B sandboxes are useful for testing but are not permanent release hosting:
their public URLs can change and the processes can stop.

`SERVERS` in `static-src/main.ts` is an ordered list of testing backends. The
menu probes their `/api/health` endpoints. Joining by room code is more strict:
if the current backend says the code does not exist, the client tries the other
configured backends, then pins itself to the one that accepted the join. That
backend is also kept in the room URL so a refresh cannot silently switch away.

**These servers are not a synchronized cluster.** Their active rooms and room
lists are independent. Room-code discovery makes temporary multi-backend tests
usable, but it does not migrate a live match or provide mid-game failover. Use
one permanent public backend for a real launch.

After changing `SERVERS`:

```bash
node scripts/build-static.mjs
```

Then:

1. Publish the contents of `public/play/` to the root of `gh-pages` if you use
   the GitHub Pages client.
2. ZIP the **contents** of `public/play/` and upload the new archive to itch.io
   and Newgrounds. Direct static uploads contain their own bundle, so changing
   a backend requires replacing those uploads.

```bash
(cd public/play && zip -r ../../hollow-creek-web.zip .)
```

`index.html` must be at the archive root, not inside a `play/` folder.

## Permanent hosting

Suitable options include:

- **Fly.io / Render / Railway** — one always-on process plus managed Postgres.
- **A small VM** — `npm ci && npm run build && npm start` behind Caddy or nginx,
  with `systemd` keeping the process alive.

Run one public game instance unless room state is redesigned for distributed
coordination. Empty rooms are dropped from memory after six hours; persisted
rooms are hydrated when someone asks for their code. Concurrent requests for
the same persisted room share a single hydration so successful joins cannot be
overwritten by a duplicate in-memory room.

## Cross-origin client hosting

The API sends `Access-Control-Allow-Origin: *` for `/api/*` and answers the
POST preflight. There are no cookies or ambient credentials; identity is an
explicit `playerId`. The direct static client therefore runs on GitHub Pages,
`html.itch.zone`, `html-classic.itch.zone`, `isolated.ungrounded.net`,
`uploads.ungrounded.net`, or a local file. Those portal origins host only the
client—they are never used as the game API address.

## Validation

With a local database configured and the production server on port 3100:

```bash
npm run typecheck
npm run build
node scripts/test-rng.mjs
node scripts/smoke-rooms.mjs       # includes concurrent joins after restart
node scripts/smoke-static.mjs
node scripts/smoke-stats.mjs http://127.0.0.1:3100
node scripts/smoke-random.mjs http://127.0.0.1:3100 200
```
