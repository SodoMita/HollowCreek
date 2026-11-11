# Raw authoritative movement: measuring unevenness

This client **does not predict, extrapolate, interpolate, smooth, or play a delayed position queue**.
The camera snaps to the authoritative target every frame, and player/bystander sprites are drawn at the exact
server `drawX` value; there is no display easing at all. Reintroducing any of it is treated as a regression
(`scripts/test-raw-view.mjs`). The goal at this stage is that transport problems are *visible* during play.
Every displayed multiplayer coordinate is a value integrated and transmitted by the server.
The renderer may convert world coordinates to screen coordinates; it never advances a player's position.

## What changed in this pass

- Preserve and publish the server's subpixel position as `drawX` / `cartDrawX` (three decimal places).
  Integer `x` remains the collision/replay grid. Do not zero a remainder on a normal STOP: that caused a backwards hop.
- Server integration uses a 4 ms fixed step. The measured 8 ms version still beat against 60 Hz display sampling.
  This increases server/network work: it is not a claim that a higher packet count alone fixes jitter.
- Protocol `format=2` sends lossless motion tuples `[slot, x, drawX, walkFrame]`. Version 1 field patches remain supported.
  Both formats reconstruct the same snapshot and fingerprint; tests assert this and compare byte counts.
- Each SSE connection owns its delta cursor. Frames identify their `base`; mismatches trigger a full resync.
  Poll cursors are additionally isolated by tab/client ID.
- Cancel/abort removes stream timers and listeners. Backpressure retains at most one queued stream frame;
  when the socket resumes it computes the latest delta instead of building a replay backlog.
- Reload resumes above `self.steerSeq`. STOP/reverse does not wait on the prior RTT; only the newest steering intent retries.
  Rejected steering never enters the replay journal. There is no artificial tap nudge or 50 ms release delay.
  Leave and rematch preserve ordering so old requests cannot restart a stopped player.
  STOP has a separate bounded rate-limit lane; every full reconnect resends the current intent after sequence resume.
- On stream failure, polling remains active while SSE is reprobed, starting after 250 ms with bounded backoff.
  Switch to the pushed full snapshot only after it arrives; invalidate all older poll callbacks first.
- Abandoned matches perform one stale-release tick and sleep. Lobbies keep a 100 ms maintenance beat.
  Time-travel queries incrementally replay new events on the **server**, with independent returned copies;
  an uncached oracle regression verifies identical results.
- Multiplayer gait is an authoritative 32-pose index. A pose composites synchronously from a primed cloak bitmap;
  asynchronous SVG decoding no longer substitutes idle sprites on first use. Primed bodies remain available across cache eviction.
  No client gait clock invents multiplayer poses.
- The silent/suspended audio graph is prepared during initial loading, not after the first movement request.

## Reproduce

Install dependencies, apply the existing Drizzle schema, build the static client and Next application,
then run the production preview using the normal project runtime. With a test server on port 3100:

```sh
node scripts/test-input-transport.mjs
node scripts/test-motion-netcode.mjs
node scripts/test-server-cadence.mjs
PLAYWRIGHT_BROWSERS_PATH=.cache/pw node scripts/test-walk-poses.mjs
BASE=http://127.0.0.1:3100 LABEL=local REQUIRE_RELOAD=1 node scripts/bench-motion.mjs
BASE=http://127.0.0.1:3100 LABEL=jitter ONE_WAY_MS=50 JITTER_MS=20 REQUIRE_RELOAD=1 node scripts/bench-motion.mjs
BASE=http://127.0.0.1:3100 LABEL=slow ONE_WAY_MS=100 JITTER_MS=35 REQUIRE_RELOAD=1 node scripts/bench-motion.mjs
BASE=http://127.0.0.1:3100 LABEL=cut DISCONNECT_MS=2600 ONE_WAY_MS=50 JITTER_MS=20 node scripts/bench-motion.mjs
```

`bench-motion.mjs` wraps the actual Renderer class. It records positions **after render**, not merely the last network message.
It checks every drawn coordinate against the supplied snapshot, measures key-to-draw and release-to-stopped-draw,
counts repeated/backwards draws, reports step-size distribution and RMS deviation from constant speed,
and verifies movement immediately after a real page reload. A seeded FIFO proxy preserves response byte ordering.
Results and raw renderer rows are saved under `.cache/motion/`.

`test-walk-poses.mjs` verifies 32 distinct first-use leg poses, synchronous turning, 4x raster density, and zero new SVG decodes after 1,920 cache variants.
The ordinary unit runner includes the input transport, exact-motion, cursor, lifecycle, idle-room and cached-replay regressions
(DB-backed suites require `DATABASE_URL`).

## Measurements from this sandbox (8-player rooms, 60 Hz browser)

The first baseline was commit `98152c1`. Representative steady movement windows:

| Measurement | Baseline | Candidate |
| --- | --- | --- |
| No added jitter: p95 drawn step | 5 px | 3.8–4.56 px |
| No added jitter: repeated/backwards draws | 1 / 0 | 0 / 0 |
| 100 ms RTT, +/-20 ms jitter: repeated draws | 35 / 193 | 5–11 / about 192 |
| 100 ms RTT: p95 drawn step | 8 px | 6.08 px |
| Movement after reload | 0 px (broken) | >120 px |
| Drawn coordinates not supplied by server | 0 | 0 |

Different camera positions, visible rosters, OS scheduling and browser rasterization affect results.
These are runs, not guarantees or a claim that the injected jitter is identical to every real network.
Wire compaction is compared on identical snapshots in the deterministic regression, not across random visible rosters.
The higher integration cadence has a bandwidth/CPU cost; `wireKBps` is part of the benchmark output.

## Diagnostics for visible jitter

`/play/?net=1` reports transport mode, fps, smoothed RTT, wire gap p50, **sample age** (ms since the newest
position-bearing frame) and **still** (`drawnStill/drawnMoved`: how often a moving soul was drawn at an unchanged x).
A rising sample age or still count means the transport is late or the stream has stalled — that is the signal.
Steering POSTs deliberately do not use the browser's beacon/`keepalive` pool, so a single request cannot queue
behind a long-lived beacon request. The server tick loop now runs every slot missed by a late OS timer inside the
same callback (bounded), keeping the simulation on the absolute grid instead of a train of 1 ms retries.

## Honest remaining limit

With raw latest-state rendering, a packet delayed beyond a display refresh leaves that frame unchanged;
its arrival can then produce a larger step. Higher server cadence reduces sampling/quantization error but cannot
eliminate real network jitter or recover time during a disconnected link. 200 ms RTT with +/-35 ms jitter still
produced repeated draws in testing. Explicitly blocking SSE produced RTT-bound polling and substantially worse motion;
the debug readout labels the active transport. No interpolation, buffer, local prediction, or sub-RTT latency is claimed here.
Use the renderer rows and disconnect test to distinguish this limit from a sequence, lifecycle, decoder or server stall.
