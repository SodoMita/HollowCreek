# Renderer (Pixi 8, bundled)

The standalone client (`/play`, `/play/tutorial.html`) draws with **pixi.js 8.22.0**,
installed from npm and pinned exactly in `package-lock.json`. esbuild bundles it into
`public/play/game.js`; nothing is loaded from a CDN at runtime.

## Structure

| File | Role |
| --- | --- |
| `src/game/render/index.ts` | `Renderer`: owns the Pixi `Application`, camera, zoom, per-snapshot index. Public API unchanged. |
| `src/game/render/statics.ts` | Retained scene: baked sky/hills, structures, houses, stations, cart, keys, notes, bell, cages. |
| `src/game/render/actors.ts` | One rig per player/body (body, shadow, kit, key, timepiece, name, action, bubble). |
| `src/game/render/fx.ts` | Leaves, fireflies, fog, reeds, darkness, past wash, baked vignette/grade/grain, flicker. |
| `src/game/render/textures.ts` | GPU texture registry: SVG rasterisation cache, labels, baked layers. |
| `src/game/render/paint.ts` | Load-time canvas helpers (light sprites, text measuring). |
| `src/game/render/view.ts` | The one `View` object, mutated per frame. |

## Rules the renderer follows

- SVG art is rasterised to a bitmap **once at load** (`svg-assets.ts`) and uploaded as a
  texture; frames never parse SVG or build paths.
- Gradients, glows and shadows are baked into textures or drawn on a 2D canvas at load —
  never recomputed per frame. No `shadowBlur`, no canvas blend modes per frame.
- The scene is retained: a frame updates transforms, alpha, visibility and the occasional
  texture swap. Nothing is recreated per frame.
- Off-screen groups (houses, stations, culling lists, treeline) are hidden before children.
- No pixel readback, no per-frame DOM access; the HUD is plain DOM updated outside the loop.
- Cache lookups use nested numeric maps; cache keys are only built when state changes.

## Texture lifetime

`releaseTexture()` destroys a texture **without** its source. Pixi shares one
`TextureSource` per canvas; destroying the source leaves live sprites pointing at a dead
source and crashes the batcher (`Cannot read properties of null (reading 'alphaMode')`).
Never mass-clear a texture cache that sprites still reference.

## Measuring

`scripts/bench-client.mjs` (6 souls, bots walking) reports frame pacing, chromium
script/layout/style time and network bytes:

```bash
BASE=http://127.0.0.1:3100 SECONDS=8 node scripts/bench-client.mjs
```

**Sandbox caveat:** this environment has no GPU. Chromium renders WebGL through
SwiftShader, and its default Vulkan SwiftShader path is fill-rate bound: a bare Pixi
stage with one full-screen sprite costs ~40 ms/frame at 1280×800. Numbers measured here
do **not** predict a browser on a real GPU; keep that in mind when comparing historical
figures (the earlier canvas renderer measured 30–95 fps here because 2D canvas was not
rasterised by that path).
