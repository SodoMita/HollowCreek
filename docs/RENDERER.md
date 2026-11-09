# Renderer (canvas 2D)

The standalone client (`/play`, `/play/tutorial.html`) draws on a single
**Canvas 2D** surface. No renderer library is bundled: measured in this
environment, a canvas path runs at 80–82 fps while a WebGL path (Pixi) managed
~9 fps, because the sandbox has no GPU and Chromium runs WebGL in software. The
bundle is ~46 KB gzipped.

## Structure

| File | Role |
| --- | --- |
| `src/game/render/index.ts` | `Renderer`: camera, zoom, per-snapshot index, layer order. Owns one reused `View`. |
| `src/game/render/backdrop.ts` | Sky/road bake, stars, moon and rays, hills, treeline, clouds. |
| `src/game/render/street.ts` | Ruts, stumps and leaf piles, fences and props, creek, meeting square. |
| `src/game/render/props.ts` | Structures, bell tower, cages, cart, keys, timepieces. |
| `src/game/render/houses.ts` | Interior cutaways, pinned pages, exteriors and door swing. |
| `src/game/render/stations.ts` | Outdoor ward structures, lit panes, markers and progress. |
| `src/game/render/actors.ts` | Bodies and players: figures, shadows, carried items, labels, speech. |
| `src/game/render/fx.ts` | Leaves, fireflies, fog, reeds, darkness, past wash, vignette/grade/grain. |
| `src/game/render/notes.ts` | Hand-written pages, far scribble and near legible text. |
| `src/game/render/paint.ts` | Load-time helpers: light sprites, text measurement. |
| `src/game/svg-assets.ts` | SVG loading and rasterisation, traveller palettes, preloading. |

## Rules the renderer follows

- SVG art is rasterised **once per size and raster density** (`svg-assets.ts`); a
  frame copies bitmaps. Nothing parses SVG or builds art paths per frame.
- Gradients, glows and shadows are baked (sky/road, vignette+grade, light sprites),
  never recomputed per frame. No canvas blend modes and no `shadowBlur` in the
  frame path — the one facade cut-out bake uses `destination-out` once per size.
- The `View` object and its lookups are reused; the frame path does not allocate.
- Off-screen props, players and notes are skipped before drawing (viewport bounds).
- No pixel readback and no DOM access from the draw code. The HUD is plain DOM,
  updated outside the loop.
- A figure is never skipped: while a palette bakes, a silhouette in the player's
  colour is drawn instead. The traveller cache evicts single entries, never clears.
- Every player colour and pose is pre-baked at load, so matches do not bake sprites.

## Movement and latency

- The server reports `moving` as **intent** (`dir !== 0`), not displacement, so the
  walk cycle keeps playing when a soul presses into a wall or doorway.
- The tutorial steps its simulation inside `requestAnimationFrame`; the HUD updates
  ~8×/s instead of once per step.
- Multiplayer draws other souls on a PER-CLIENT interpolation delay measured from that
  client's own frame gaps: clamp(p50 × 0.6 + 6, 20, 60) ms. It is deliberately below
  one frame gap; the renderer extrapolates the remainder with the known facing and
  speed (capped at 150 ms), so the picture stays fresh. The local soul is predicted
  from input immediately.
- A cart pusher is predicted at cart speed (`CART_SOLO_SPEED` plus helper bonus),
  matching the server's movement, so there is no lunge-and-snap.
- The camera follows the viewer at 18/s (6/s only under the spyglass).

## Measuring

```bash
BASE=http://127.0.0.1:3100 SECONDS=8 node scripts/bench-client.mjs
```

Reports frame pacing, chromium script/layout/style time and network bytes for a
town of bots. `scripts/test-renderer-rules.mjs` (part of `npm test`) enforces the
rules above.

## Network: one position per frame, never a sequence

The state wire sends **one latest value per changed entity per frame**, not a history:

- Full snapshot once (≈3.5 KB), then field-level patches: a walking neighbour is
  `{"i":2,"x":2882}` inside `patch.players` — a roster slot plus the changed fields.
- Patches address entities by **roster slot** (`i`), not by 36-character UUID.
  Order is stable while patches are sent; a membership/order change resends the list.
- The server ticks at 50 ms and coalesces **one frame per viewer per 50 ms**
  (`FRAME_MS`), with slow values (vigor, cooldowns, night, hint, ward progress) on a
  1 Hz beat.
- The client long-polls at 50 ms with `delta=1&wait=1`; a room event that changes
  nothing *for this viewer* keeps the request open instead of ending it (the old
  behaviour churned one request per viewer per event).
- The client interpolates between the last two positions on an adaptive delay (20-60 ms)
  and extrapolates the remainder, so 20 position updates/s render as continuous motion.

Measured on a 4-soul town, viewer walking (`/api/game/state?delta=1&wait=1`):

| Metric | Value |
| --- | --- |
| frames/s | 20.1 |
| bytes/frame (walking) | 167 |
| walking stream | ≈3.3 KB/s |
| client idle (bench, real client) | ≈0.7 KB/s |

Sending a *sequence* of 120 frames/s instead would cost ~600+ bytes/s per neighbour
just for x values, grow with every player and the cart, and buy nothing: the client
already renders at 60 fps by interpolating between the two newest positions.

## Latency budget (measured)

| Component | Before | Now |
| --- | --- | --- |
| Input → server state | ~25 ms median (half a tick) | ~25 ms median (tick-bound) |
| Server event → frame sent | up to 50 ms (coalescing window) | ~16 ms (one display frame) |
| State frames per second | 10 | 20 (one per server tick) |
| Client interpolation delay | fixed 60 ms | adaptive 20–60 ms per client |
| Client poll interval | 100 ms | 16 ms (long-poll self-paces) |

The floor for other players is one server tick (~50 ms) plus network: the server only
moves souls on ticks, so no client poll rate can invent fresher positions. The client
sends input the moment a key changes and predicts its own soul immediately.
