# Direct HTML5 release kit

Use the **static client itself** for itch.io and Newgrounds. Do not use the old
iframe-wrapper release: both portals can isolate or block nested frames.

## Icons

All sizes are generated from `public/icon-1600.png`:

| File | Size | Use |
| --- | --- | --- |
| `public/icon-1600.png` | 1600×1600 | master art |
| `public/icon-1024.png` | 1024×1024 | store artwork |
| `public/icon-512.png` | 512×512 | general / PWA |
| `public/icon-256.png` | 256×256 | PWA |
| `public/icon-192.png` | 192×192 | static-client icon |
| `public/icon-180.png` | 180×180 | iOS home screen |
| `public/icon-140.png` | 140×140 | **Newgrounds cover image** |
| `public/icon-64/48/32/16.png` | small sizes | legacy favicons |
| `public/favicon.ico` | 48+32+16 | multi-resolution favicon |

To regenerate after changing the master:

```bash
cd public
for s in 1024 512 256 192 180 140 64 48 32 16; do convert icon-1600.png -resize ${s}x${s} -strip icon-$s.png; done
convert icon-1600.png -define icon:auto-resize=48,32,16 favicon.ico
cp icon-512.png ../src/app/icon.png
cp icon-180.png ../src/app/apple-icon.png
cp icon-192.png play/icon.png
```

## Descriptions

- `short-description.txt` — listing/share-card text.
- `full-description.txt` — long description and controls.

## Build one ZIP for both portals

1. Deploy one authoritative Node/Postgres backend and verify
   `https://YOUR_SERVER/api/health` returns `{"ok":true}`.
2. Put that origin first in `SERVERS` in `static-src/main.ts`. Do not append
   `/api/health` to the configured origin.
3. Build and package the files, not their parent folder:

   ```bash
   npm ci
   node scripts/build-static.mjs
   (cd public/play && zip -r ../../hollow-creek-web.zip .)
   ```

The archive starts with `index.html`, `game.js`, `favicon.ico`, and the icons.
There is no nested iframe and no server-side code or database secret in it.
Audio, graphics, HUD, accessibility, and key-binding preferences are stored only
in the player's browser under `hc_settings_v1`; they require no backend changes.

For temporary multi-backend tests, the menu probes the configured servers. A
join by code also tries the other backends when the current one does not know
that town, then stays pinned to the backend that accepted it. This is room
discovery, not synchronized multi-server hosting; use one permanent backend
for production.

## itch.io

1. Create/edit an **HTML** project.
2. Upload `hollow-creek-web.zip` and enable **This file will be played in the
   browser**.
3. Fullscreen launch works well with the responsive viewport; an embedded
   viewport with a fullscreen button also works.
4. Test creating and joining a town in Draft mode before making it public.

## Newgrounds

1. Create a **Game** project and choose the HTML5 ZIP upload.
2. Upload the same `hollow-creek-web.zip`; `index.html` must be at the root.
3. Use `public/icon-140.png` as the cover and the two description files above.
4. Test joining by a code created on another device/browser before publishing.

Content rating: mild realistic violence and horror themes. No sexual content;
player-entered chat can of course contain player-chosen language.

## If the backend moves

Edit `SERVERS`, rebuild, replace both portal ZIPs, and republish `public/play/`
to `gh-pages` if you also host the Pages client. Players should never need to
type a server address. The advanced Server field and `?server=https://…`
remain available for diagnostics and explicit test overrides.
