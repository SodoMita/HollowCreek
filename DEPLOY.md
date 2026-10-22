# Running a Hollow Creek server

The game is a client plus an authoritative server. The server is a Next.js app
that must run as **one long-lived Node process**: rooms live in memory, with
Postgres behind them for the roster and the chronicle. Serverless platforms will
not work, because each invocation would start with an empty room map.

## What each piece is

| Piece | Where | Notes |
| --- | --- | --- |
| Authoritative server | this repo (`npm start`) | owns every position, role, cooldown and outcome |
| In-app client | `/` and `/room/CODE` | the React client, served by the same process |
| Static client | `/play` | built by `node scripts/build-static.mjs` from `static-src/` |
| Published static client | https://sodomita.github.io/HollowCreek/ | the `gh-pages` branch |
| Newgrounds builds | https://github.com/SodoMita/HollowCreek/releases | a zip of the static client, and a zip that just frames Pages |

## Quick start

```bash
npm ci
cp .env.example .env          # DATABASE_URL -> any Postgres
npx drizzle-kit push --force  # creates game_events, rooms, room_players, player_stats
npm run build
npm start                     # one process, port 3000
```

Open `/` on several devices, found a town, and share the four-letter code.

## E2B

E2B sandboxes work fine while they live, which makes them good for testing and
bad for a release: the public URL changes when the sandbox is rebuilt.

```bash
e2b template build -n hollow-creek   # a Node 22 base image
```

then inside the sandbox: `npm ci`, set `DATABASE_URL`, `npx drizzle-kit push`,
`npm run build`, `npm start -- -p 3000`.

Because the URL moves, the static client does not depend on one address. It
probes a list of servers (`SERVERS` in `static-src/main.ts`) with a 3.5s
`/api/health` request each and binds to the first one that answers. A player can
always override it with `?server=https://…` or the Server field on the title
screen.

**When the server moves, republish the client rather than re-uploading anywhere:**

```bash
# 1. put the new address first in the list
$EDITOR static-src/main.ts
# 2. rebuild
node scripts/build-static.mjs
# 3. republish Pages (the gh-pages branch holds index.html, game.js, icon.png)
git checkout gh-pages && cp public/play/* . && git commit -am "new server" && git push
```

Nothing hosted on Newgrounds or itch.io needs to be re-uploaded, because those
builds either frame Pages or carry the probe list.

## Somewhere permanent

For a release, point `SERVERS[0]` at something that does not move:

- **Fly.io / Render / Railway** — one always-on process plus a managed Postgres.
- **A small VM** — `npm ci && npm run build && npm start` behind Caddy or nginx,
  with `systemd` to keep it alive.
- Any Postgres works; the schema is four tables and `drizzle-kit push` makes them.

Memory: a room is a few kilobytes, and empty rooms are dropped from memory after
15 minutes (they are all in Postgres, and `loadRoom()` restores a town the moment
anybody asks for its code), so one small instance serves a lot of concurrent
towns.

## Hosting the client elsewhere

The API sends `Access-Control-Allow-Origin: *` (there are no cookies and no
ambient credentials — identity is an explicit playerId in the request body), and
the pages allow framing, so the static client runs from anywhere: GitHub Pages,
itch.io, an LMS, a USB stick or `file://`.

To build a zip for Newgrounds' HTML5 uploader, keep `index.html` at the root of
the archive or Newgrounds returns a 403. `release/README.md` covers both paths.
