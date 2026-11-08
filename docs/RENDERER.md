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
- Multiplayer draws other souls on a 60 ms interpolation delay between server
  positions with a capped extrapolation; the local soul is predicted immediately.
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
