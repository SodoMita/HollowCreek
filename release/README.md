# Release kit

Everything needed to put Hollow Creek on Newgrounds (or anywhere else).

## Icons

All sizes are generated from one master, `public/icon-1600.png`:

| File | Size | Use |
| --- | --- | --- |
| `public/icon-1600.png` | 1600×1600 | master art, highest resolution |
| `public/icon-1024.png` | 1024×1024 | store submissions (App Store / Play standard) |
| `public/icon-512.png` | 512×512 | PWA / general |
| `public/icon-256.png` | 256×256 | PWA |
| `public/icon-192.png` | 192×192 | `public/play/icon.png`, the static client favicon |
| `public/icon-180.png` | 180×180 | `src/app/apple-icon.png` (iOS home screen) |
| `public/icon-140.png` | 140×140 | **Newgrounds cover image** |
| `public/icon-64/48/32/16.png` | small | legacy favicon sizes |
| `public/favicon.ico` | 48+32+16 | multi-resolution favicon for `/favicon.ico` |
| `src/app/icon.png` | 512×512 | the Next.js app favicon (App Router picks it up) |

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

- `short-description.txt` — the one-liner for listings and share cards (~150 characters).
- `full-description.txt` — the long description / author comments. Plain text, no
  markup needed. Newgrounds accepts plain text with blank-line paragraphs.

## Newgrounds, step by step

1. Decide where the simulation runs. It must be a single long-lived Node process
   (see `DEPLOY.md`); an E2B sandbox works while it lives, a small VM or Fly.io
   works forever.
2. Point the client at it: edit `DEFAULT_SERVER` in `static-src/main.ts`, then
   `node scripts/build-static.mjs`. The output lands in `public/play/`.
3. Upload as **HTML5**: zip `index.html`, `game.js` and `icon.png` from
   `public/play/` (an `index.html` must sit at the root of the zip or
   Newgrounds returns a 403). Use `public/icon-140.png` as the cover image and
   paste the two description files.
4. Or **iframe it**: give Newgrounds `https://sodomita.github.io/HollowCreek/`
   instead. That URL is stable, and if the server ever moves you fix it with one
   line in `static-src/main.ts` and a redeploy - no re-upload to Newgrounds.

Content rating: mild realistic violence and horror themes. No sexual content, no
adult language by default (that depends on what your friends type).
