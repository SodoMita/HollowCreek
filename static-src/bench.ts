// The Repair Bench: every ward puzzle, playable offline. No server, no night,
// no vigor. It renders the authoritative board shape with the same shared
// renderer the live game uses, so a practised repair transfers directly.
import { HINT_LABELS, wardHint } from "../src/game/ward-hints";
import { installWardStyles, renderWardJob } from "../src/game/ward-ui";
import {
  WARD_JOBS, applyWardMove, createWardPuzzle, validWardMove, wardProgress, wardSolved, wardView,
  type WardKind, type WardPuzzle,
} from "../src/game/wards";

const KINDS = Object.keys(WARD_JOBS) as WardKind[];
const BEST_KEY = "hc_bench_best_v1";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

type Best = Record<string, number>;
const readBest = (): Best => {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw as Best : {};
  } catch { return {}; }
};
let best: Best = readBest();
let solvedThisSession = 0;

function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] || Date.now()) >>> 0;
}

const isKind = (value: string): value is WardKind => (KINDS as string[]).includes(value);

function parseHash(): { kind: WardKind; seed: number } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [kindPart, seedPart] = raw.split("/");
  const kind = isKind(kindPart) ? kindPart : KINDS[0];
  const seed = Number(seedPart);
  return { kind, seed: Number.isFinite(seed) && seed > 0 ? Math.trunc(seed) : randomSeed() };
}

type BenchState = { kind: WardKind; seed: number; game: WardPuzzle; hint: number; justSolved: boolean };
let state: BenchState;

function load(kind: WardKind, seed: number) {
  state = { kind, seed, game: createWardPuzzle(kind, seed), hint: 0, justSolved: false };
  history.replaceState(null, "", `#${kind}/${seed}`);
}

function newBoard() {
  load(state.kind, randomSeed());
  render();
  focusFirstPart();
}

function resetBoard() {
  load(state.kind, state.seed);
  render();
  focusFirstPart();
}

function markBest() {
  const moves = state.game.moves;
  if (!best[state.kind] || moves < best[state.kind]) {
    best = { ...best, [state.kind]: moves };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* private mode */ }
  }
}

function move(index: number) {
  if (wardSolved(state.game) || !validWardMove(state.game, index)) return;
  const before = wardSolved(state.game);
  state.game = applyWardMove(state.game, index);
  const after = wardSolved(state.game);
  state.justSolved = !before && after;
  if (state.justSolved) { solvedThisSession++; markBest(); }
  render();
  if (state.justSolved) ($("solved") as HTMLElement | null)?.focus({ preventScroll: true });
  else focusFirstPart();
}

function focusFirstPart() {
  const control = $("stage").querySelector<HTMLButtonElement>("[data-ward-move]");
  control?.focus({ preventScroll: true });
}

function cycleHint() {
  state.hint = (state.hint + 1) % (HINT_LABELS.length + 1);
  render();
  (($("hintbutton") as HTMLElement | null) ?? $("stage")).focus?.({ preventScroll: true });
}

function jobsMarkup(): string {
  return KINDS.map((kind) => {
    const mended = best[kind] !== undefined;
    return `<button type="button" data-bench-kind="${kind}" aria-current="${kind === state.kind}" class="${mended ? "mended" : ""}">
      <span>${esc(WARD_JOBS[kind].title)}</span>
      <small>${mended ? `best ${best[kind]}` : "new"}</small>
    </button>`;
  }).join("");
}

function stageMarkup(): string {
  const view = wardView(state.kind, WARD_JOBS[state.kind].title, state.game);
  const solved = wardSolved(state.game);
  const percent = Math.round(wardProgress(state.game) * 100);
  const hintLabel = state.hint === 0 ? "explain the rule" : state.hint === 1 ? "read this board" : state.hint === 2 ? "name the next move" : "hide the clue";
  return `<div class="hc-ward-panel">
    <div class="hc-ward-top"><div><small style="color:#d99a3d">THE REPAIR BENCH</small><h2>${esc(WARD_JOBS[state.kind].title)}</h2></div>
      <button type="button" class="hc-ward-close" data-bench-new aria-label="Deal a fresh board for this repair">New board · R</button></div>
    <p class="hc-ward-lead">${esc(WARD_JOBS[state.kind].instruction)}</p>
    <div class="hc-ward-progress" role="progressbar" aria-label="Repair progress" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><div style="width:${percent}%"></div></div>
    <div class="hc-ward-meta"><span>${percent}% repaired</span><span>${state.game.moves} moves${state.game.mistakes ? ` · ${state.game.mistakes} slips` : ""}</span></div>
    ${renderWardJob(view)}
    ${solved ? `<div class="bench-solved" id="solved" tabindex="-1" role="status"><b>Mended.</b> ${state.game.moves} moves${best[state.kind] ? ` · best ${best[state.kind]}` : ""} · <span class="bench-seed">seed ${state.seed}</span>${state.justSolved ? " · counted on the bench" : ""}</div>` : ""}
    <div class="hc-ward-tools">
      <button type="button" class="hc-ward-hint" id="hintbutton" data-bench-hint aria-label="Nudge: ${hintLabel}" aria-keyshortcuts="H">? Nudge<small>${hintLabel}</small></button>
      <span class="hc-ward-key">1–9 play · H nudge · R new board</span>
    </div>
    ${state.hint > 0 ? `<p class="hc-ward-hintline" role="status">${esc(wardHint(view, state.hint - 1))}</p>` : ""}
    <div class="bench-actions">
      <button type="button" class="primary" data-bench-new>Deal a new board</button>
      <button type="button" data-bench-reset>Reset this board</button>
      <button type="button" data-bench-copy>Copy practice link</button>
    </div>
    <p class="bench-meta"><span>Seed <span class="bench-seed">${state.seed}</span> · boards are deterministic, so this link teaches the same puzzle.</span><span>Mended this visit: ${solvedThisSession}</span></p>
    <p class="hc-ward-note">No deadline and no vigor on the bench. A nudge never counts as a move. Every board is solvable — if a puzzle ever looks stuck, reset the board and tell the keeper.</p>
  </div>`;
}

function render() {
  $("jobs").innerHTML = jobsMarkup();
  $("stage").innerHTML = stageMarkup();
  state.justSolved = false;
}

async function copyLink() {
  const button = $("stage").querySelector<HTMLButtonElement>("[data-bench-copy]");
  const url = `${location.origin}${location.pathname}#${state.kind}/${state.seed}`;
  try {
    await navigator.clipboard.writeText(url);
    if (button) button.textContent = "Link copied";
  } catch {
    window.prompt("Copy this practice link", url);
  }
}

installWardStyles();
const start = parseHash();
load(start.kind, start.seed);
render();

$("jobs").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-bench-kind]");
  if (!button) return;
  const kind = button.dataset.benchKind ?? "";
  if (!isKind(kind) || kind === state.kind) return;
  load(kind, randomSeed());
  render();
  focusFirstPart();
});

$("stage").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("[data-bench-new]")) { newBoard(); return; }
  if (target.closest("[data-bench-reset]")) { resetBoard(); return; }
  if (target.closest("[data-bench-copy]")) { void copyLink(); return; }
  if (target.closest("[data-bench-hint]")) { cycleHint(); return; }
  const control = target.closest<HTMLButtonElement>("[data-ward-move]");
  if (!control) return;
  move(Number(control.dataset.wardMove));
});

window.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const typing = (event.target as HTMLElement | null)?.closest("input,textarea,select");
  if (typing) return;
  if (/^[1-9]$/.test(event.key)) {
    const controls = [...$("stage").querySelectorAll<HTMLButtonElement>("[data-ward-move]")];
    const control = controls[Number(event.key) - 1];
    if (control && !control.disabled) { event.preventDefault(); move(Number(control.dataset.wardMove)); }
    return;
  }
  if (event.key.toLowerCase() === "h" || event.key.toLowerCase() === "n") { event.preventDefault(); cycleHint(); return; }
  if (event.key.toLowerCase() === "r") { event.preventDefault(); newBoard(); }
});

window.addEventListener("hashchange", () => {
  const next = parseHash();
  load(next.kind, next.seed);
  render();
});
