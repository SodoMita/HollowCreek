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
- `rooms.json` — furniture placement. Each room item has an asset path, `x` relative to the house center, `y` relative to the ground (negative is upward), `width`, `height`, and optional `when: "done"` or `"unfinished"` for task state. Change these numbers to move or resize objects; reload to see changes.

## Alignment and editing

Keep each SVG's `viewBox` unless intentionally changing its game alignment. House facades use a 300 × 158 world-unit core; windows align at x=61 and x=197. Door files use a 64 × 112 viewBox, with the world threshold anchored at x=20 and the bottom at ground level. The renderer mirrors the same side-profile door for left and right gables. The aperture geometry itself is in `src/game/house-art.ts` if the frame opening is deliberately moved.

Avoid external images, fonts, scripts, or remote references inside SVGs: keeping them self-contained lets the canvas render safely and keeps the standalone client portable. The sky, fog, some street structures, cages, and effects are still canvas-drawn; the objects listed above are editable SVGs.

The full site reads `public/art` directly. After editing art or `rooms.json`, run `node scripts/build-static.mjs` to copy the same assets into `public/play/art` for the standalone client. A browser refresh reloads the art. Gameplay positions and server-authoritative door/task rules are separate from the artwork.
