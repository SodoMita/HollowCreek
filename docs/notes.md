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
- The dead, the caged, and players inside a house cannot pin; pinning in the open
  road (no wall/tree within 90 px) is rejected.

Tests: `scripts/test-notes.mjs` (snap to wall vs tree, validation, vision-filtered
snapshots, pin-in-the-past → present, replay determinism), plus live checks in
`scripts/smoke-time.mjs` (API) and `scripts/smoke-time-room-ui.mjs` (pin panel +
zoom-in reader in both clients).
