# Hollow Creek editable art

These are the actual SVG files used by the game, not reference images. Open `/art` in the full site to preview and download them. Edit the files in any SVG editor (for example Inkscape), save, and reload the game. The SVGs are hand-authored vectors; no generated artwork is required.

## Files

- `house/facade-*.svg` — separate exterior for each house. The `siding`, `foundation`, `roof`, and `chimney` groups can be edited independently.
- `house/interior.svg` — shared back wall and floor. `house/windows.svg` is transparent glass and trim; the facade has matching window cutouts.
- `house/door-frame.svg`, `door-closed.svg`, `door-open.svg` — side-profile frame and the two leaf positions. The open opening is transparent: the interior and occupants are rendered behind it. Closing and locking remain separate game actions.
- `house/sign.svg` — blank house nameplate; the game supplies the name.
- `furniture/*.svg` — individual hearth, fire, shelves, jars, clock, fuse board, table, desk, bed, crate, entrance barrel, rug, and framed picture.
- `characters/traveler.svg` — the player silhouette. Keep the `/* RUNTIME PALETTE */` marker: the game injects cloak and eye colors and a small walk pose there. The default colors remain visible in a normal SVG editor.
- `scenery/autumn-tree.svg`, `props/key.svg`, `props/timepiece.svg`, `props/supply-cart.svg`, and `props/supply-kit.svg` — reusable world objects.
- `scenery/moon.svg` — the moon disc with its craters (84 × 84; the halo and rays stay in code). `scenery/meeting-square.svg` — the meeting-square highlight; the game sets its opacity per frame. `scenery/stump.svg` and `scenery/leaf-pile.svg` — the shadow and leaves at each road tree. `scenery/pebble.svg` — one road pebble, scaled per stone. `props/broken-fence.svg` — one fence bay (86 × 38; the game places it at fixed world positions). `props/blood-pool.svg` — the pool under a corpse.
- `props/fence.svg`, `props/lantern-post.svg`, `props/woodpile.svg`, `props/windmill.svg` — Malye Korely street dressing placed at fixed world x positions in `src/game/atmosphere.ts`.
- The four `house/facade-*.svg` files are redrawn as Pomor log houses in the manner of the Malye Korely open-air museum (village on the Korelka creek near Arkhangelsk; cf. Arkhangelsk's one-street museum street Chumbarova-Luchinskogo): log courses with corner log-ends, shingle gable roofs with ridge, stone-boulder foundations, brick chimneys; `house/windows.svg` carries carved platbands, shutters and warm dusk-lit panes. Keep the 332 × 158 facade viewBox and the window cutouts at x=61/x=197.
- `structures/*.svg` — the ward structures and the prisoner's cages and bell tower, drawn in world units with the road point at (0, 0). Each structure has an intact file and a `-broken` file (the damaged silhouette); the chapel, pumpkin shed and windmill also have a `-trim` file with window frames and muntins, which is drawn over the lit glass. The mill sails (`mill-sails.svg`, `mill-sails-broken.svg`) and the bell (`bell.svg`) are rotated in code. Placement boxes are in `src/game/render/structures.ts`. The lit windows, lantern glow, radio lamp, bell ringing arcs and rope stay in code because they depend on game state.
- `props/gravestone.svg`, `props/haystack.svg` — graves-ward and harvest dressing; `scenery/autumn-tree.svg` was enriched with layered canopy and trunk shading.
- `props/creek-bridge.svg` — Hollow Creek water, reeds and plank bridge at the road's far west end (the world grew from −1500..5750 to −2800..7400; every pre-existing tree, building, station and key coordinate kept its exact x).
- House facades carry carved bargeboard fretwork along both gable slopes; `house/door-frame.svg` gained porch steps; `house/interior.svg` gained a dark ceiling beam and a hanging lantern glow (the warm glow ellipses at cx 74/210 are unchanged). The renderer also spills warm window light onto the road and places a barrel and crate beside each house.
- `rooms.json` — furniture placement. Each room item has an asset path, `x` relative to the house center, `y` relative to the ground (negative is upward), `width`, `height`, and optional `when: "done"` or `"unfinished"` for task state. Change these numbers to move or resize objects; reload to see changes.

## Reference houses (Malye Korely)

- `reference/houses.json` — the list of real houses of the Malye Korely open-air
  museum used as the art reference (Pukhov 1812, Kirillov, Tretyakov, Popov,
  Klokotov 1879, Limonnikov 1920), each with origin village, sector, source URLs
  and downloaded photos (`/home/user/malye-korely/photos`, see SOURCES.md there).
- `reference/<slug>-exterior.svg` / `reference/<slug>-interior.svg` — one
  individually hand-authored SVG per real house (exterior and interior), each
  tagged `data-ref="<slug>"` with a hand-authored marker comment. They are
  reference/library assets, not wired into gameplay coordinates.
- `scripts/test-house-assets.mjs` verifies: assets exist per house; no asset
  repeats (hash + normalized content + unique titles); no script generates the
  assets procedurally; every file under `public/art` is < 50 Kb; and the number
  of real reference houses (6) is less than the game's house visual assets
  (4 facades + 6 reference exteriors = 10).

## Loading and fallbacks

The game draws each SVG once its file has loaded (`src/game/svg-assets.ts`). There is no code fallback for SVG-backed objects: a shape that exists as an SVG is not also drawn in code. The one exception is trees: `src/game/render/tree.ts` keeps its procedural drawing alongside `scenery/autumn-tree.svg`, by the scope decision. Two consequences: art is blank for the first moments after the page loads (the local files load quickly), and a missing or broken file leaves its object undrawn rather than drawing a substitute. Check the browser console and the `public/art` files when an object is missing.

What stays in code, by design: the sky gradient, stars, moon halo and rays, smoke, creek water and glints, the road ruts, hills, grass, reeds and plants, trees (procedural, in `tree.ts`), note paper and its text, the marker's diamond, label box and progress bar, animated crows and the death flash, and window light, lanterns and the lit glass (all driven by game state).

## Alignment and editing

Keep each SVG's `viewBox` unless intentionally changing its game alignment. House facades use a 300 × 158 world-unit core; windows align at x=61 and x=197. Door files use a 64 × 112 viewBox, with the world threshold anchored at x=20 and the bottom at ground level. The renderer mirrors the same side-profile door for left and right gables. The aperture geometry itself is in `src/game/house-art.ts` if the frame opening is deliberately moved.

Avoid external images, fonts, scripts, or remote references inside SVGs: keeping them self-contained lets the canvas render safely and keeps the standalone client portable. The sky, fog, and effects, plus the state-driven light listed above, are still canvas-drawn; the objects listed above and the `structures/` files are editable SVGs.

The full site reads `public/art` directly. After editing art or `rooms.json`, run `node scripts/build-static.mjs` to copy the same assets into `public/play/art` for the standalone client. A browser refresh reloads the art. Gameplay positions and server-authoritative door/task rules are separate from the artwork.
