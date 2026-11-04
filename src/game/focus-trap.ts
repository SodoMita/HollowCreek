// Shared Tab focus trap for the innerHTML dialogs (ward puzzle, timepiece,
// settings). Keeps keyboard focus inside the open dialog; Esc is handled by
// each panel / the game screen itself.
export function trapTab(root: HTMLElement, event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const items = root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}
