// trapTab keeps Tab/Shift+Tab cycling inside the dialog root.
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/game/focus-trap.ts"], bundle: true, write: false, platform: "node", format: "esm" });
const { trapTab } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const mkBtn = () => ({ focus() { this.focused = true; } });
const first = mkBtn(), last = mkBtn();
let active = first;
globalThis.document = { activeElement: null };
const root = {
  contains: (el) => el === first || el === last,
  querySelectorAll: () => [first, last],
};
const ev = (key, shiftKey) => ({ key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

// Tab on last -> wraps to first
active = last; document.activeElement = last;
let e = ev("Tab", false); trapTab(root, e);
if (!e.defaultPrevented || !first.focused) { console.error("FAIL Tab wrap"); process.exit(1); }
// Shift+Tab on first -> wraps to last
first.focused = false; active = first; document.activeElement = first;
e = ev("Tab", true); trapTab(root, e);
if (!e.defaultPrevented || !last.focused) { console.error("FAIL Shift+Tab wrap"); process.exit(1); }
// Tab in the middle -> untouched
first.focused = last.focused = false; document.activeElement = first;
e = ev("Tab", false); // active === first, not last -> no wrap
trapTab(root, e);
if (e.defaultPrevented) { console.error("FAIL middle tab intercepted"); process.exit(1); }
// non-Tab key ignored
e = ev("Enter", false); trapTab(root, e);
if (e.defaultPrevented) { console.error("FAIL non-tab"); process.exit(1); }
console.log("FOCUS_TRAP_OK");
