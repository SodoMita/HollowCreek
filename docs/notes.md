# Pinned pages (notes on walls and trees)

Any living, uncaged player outside a house can pin a handwritten page with custom
text to the nearest **building wall** or **tree trunk** (stand within 90 px of it).
Pages are real world objects — no placeholders:

- `pin_note` with `noteText` (whitespace-collapsed, trimmed, max **200 chars**;
  empty or overlong text is rejected with an error). The server snaps the page to
  the closest anchor (`snapAnchor` in `src/game/buildings.ts`): the wall face is
  the player x clamped into the building footprint, tree trunks are the
  deterministic foreground trees (`treeX(i)`). The stored `x` is always an integer.
- Pages live in the room as `Note { id, authorId, authorName, text, x, kind, at }`,
  are captured into history checkpoints, and are journaled inputs — so they replay
  deterministically, and a page pinned **inside a past visit** is written back into
  the present on return (authorship remapped from the visitor incarnation to the
  real player) and replays into later travellers' shadows.
- Snapshots expose the real text of pages inside the viewer's vision (`notes[]`),
  so both clients can render a reader. The canvas draws each page as a small sheet
  on the wall/trunk (`Renderer.drawNote`).
- **Read / zoom-in**: when a page is within 150 px of you, a "📖 Read page" button
  appears (React client top bar, `data-testid="read-note"`; standalone client
  `#readnote`). Clicking it zooms the world camera onto the page (zoom ≥ 2.6,
  camera locked to the page x via `Renderer.setFocus`) and opens a paper overlay
  with the full text and author (`data-testid="note-reader"`). Click ✕ / the
  backdrop to put it back.
- **Write**: a "✎ Pin page" button (or `N` in the React client) opens a textarea
  panel (`data-testid="pin-note-panel"`); submitting sends `pin_note` with the text.
- **Inside a house** the page goes on that house's *interior wall*: `Note.house` is
  set to the building id, the x clamps into the house footprint, and the page is
  visible in snapshots only to souls inside the same house (rendered inside the
  house cutaway). Outside, `house` is null and the page shows on the facade/trunk
  within vision.
- The dead and the caged cannot pin; pinning in the open road (no wall/tree within
  90 px) is rejected.

Tests: `scripts/test-notes.mjs` (snap to wall vs tree, validation, vision-filtered
snapshots, pin-in-the-past → present, replay determinism), plus live checks in
`scripts/smoke-time.mjs` (API) and `scripts/smoke-time-room-ui.mjs` (pin panel +
zoom-in reader in both clients).

## Engine module map (after the 2026-11-04 split; `engine.ts` is the type hub + re-export barrel)

- `engine.ts` — `Room`/`P`/… interfaces, re-exports, `bindEngineHooks` wiring
- `registry.ts` — live rooms map, one-flight loads, `makeCode`, `getRoom`, `listRoomsSync`
- `persistence.ts` — DB flush/hydrate (`flushRooms`, `loadRoom`), chronicle retention prune
- `chronicle.ts` — journal/seeded/feed/record, dirty set, SSE listeners (`onRoomEvent`/`emitRoom`/`markDirty`)
- `input.ts` — `canonicalInput` whitelist; `actions.ts` — lifecycle + `handleInput`
- `rules.ts` — drops/cages/repairs/meetings/kills/win; `tick.ts` — authoritative loop
- `time-travel.ts` — replay/past layer; `snapshot.ts` — per-viewer view + ETag
- `history.ts`, `timepieces.ts`, `proximity.ts` — pure helpers; `hooks.ts` — snapshot/tickRoom bridge
- Client: `GameClient.tsx` + `hud/bars/overlays/chat.tsx` + `useGameStream/useGameInput/useGameRender/useGameOverlays` hooks

## Build report (2026-11-04, `next build` with dummy DATABASE_URL — build passes without a live DB)

- All 8 pages + 13 API routes compile and prerender; exit 0.
- Client JS grand total ≈ 987 kB across all chunks; `/room/[code]` page = 5 unique chunks,
  210.7 kB total (77.8 + 53.4 + 47.0 + 29.2 + 3.3) — mostly React/Next framework.
- `voice.ts`/`audio.ts` are already dynamic-imported behind the Voice button (not in the room page's static chunks).
