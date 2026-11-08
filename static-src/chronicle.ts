// The Chronicle: one town's ledger from GET /api/game/chronicle?code=...
// Sealed (403) while the night is live; the DOM API keeps names out of markup.
import { serverBase } from "./server-base";

type GameEvent = {
  id: number; playerName: string | null; type: string; data: Record<string, unknown> | null; createdAt: string;
};

const TYPE_LABELS: Record<string, [string, string]> = {
  room_created: ["🏚", "A town was founded"],
  join: ["🚶", "arrived in town"],
  game_start: ["🌒", "Night fell — roles were dealt"],
  move_input: ["👣", "changed direction"],
  chat: ["💬", "spoke"],
  task_complete: ["🕯", "finished a repair"],
  ward_started: ["🧩", "opened a repair puzzle"],
  ward_move: ["🔩", "played a puzzle move"],
  kill: ["🩸", "killed"],
  report: ["❗", "reported a body"],
  ring_bell: ["🔔", "rang the bell"],
  meeting_start: ["🔔", "A meeting was called"],
  vote: ["⚖️", "voted"],
  meeting_result: ["📜", "The verdict was tallied"],
  unlock_cage: ["🗝", "unlocked a cage"],
  pickup_key: ["🗝", "took the iron key"],
  blackout: ["🌑", "snuffed every lantern in town"],
  leave: ["🚪", "left the town"],
  rejoin: ["🔁", "returned to their old seat"],
  restart: ["🕯", "gathered the same souls for another night"],
  room_restored: ["🏚", "the town was remembered after the long dark"],
  seat_claimed: ["🪑", "reclaimed their old seat"],
  game_end: ["🌅", "The tale ended"],
};

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

/** The italic detail after an event's label, as the React ledger wrote it. */
function detailOf(e: GameEvent): string {
  const d = e.data ?? {};
  switch (e.type) {
    case "chat": return `“${str(d.text)}”${d.ghost ? " (ghost whisper)" : ""}${d.caged ? " (from the cage)" : ""}`;
    case "kill": return `${str(d.victim)}${d.victimCaged ? " — inside their cage" : ""}`;
    case "vote": return `for ${str(d.target)}`;
    case "move_input": return `dir ${str(d.dir)}`;
    case "task_complete": return str(d.task);
    case "ward_started": return `${str(d.task)} (${str(d.kind)})`;
    case "ward_move": return `${str(d.task)} · tile ${str(d.tile)} · ${str(d.progress ?? 0)}%`;
    case "meeting_start": return str(d.reason);
    case "game_end": return `${str(d.winner)} — ${str(d.reason)}`;
    case "meeting_result": return JSON.stringify(d.tally ?? {});
    case "unlock_cage": return `freed ${str(d.freed)}`;
    default: return "";
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function show(id: string, on: boolean): void {
  document.getElementById(id)!.hidden = !on;
}

function renderEntry(e: GameEvent): HTMLElement {
  const [icon, label] = TYPE_LABELS[e.type] ?? ["•", e.type];
  const danger = e.type === "kill" || e.type === "game_end";
  const row = el("div", undefined, danger ? "entry danger" : "entry");
  row.append(el("span", new Date(e.createdAt).toLocaleTimeString(), "time"));
  row.append(el("span", icon));
  const who = e.playerName ? el("b", e.playerName, "who") : el("i", "the town", "detail");
  const text = el("span");
  text.append(who, ` ${label} `);
  const detail = detailOf(e);
  if (detail) text.append(el("span", detail, "detail"));
  row.append(text);
  if (typeof e.data?.x === "number") row.append(el("span", `x:${e.data.x}`, "pos"));
  return row;
}

async function load(): Promise<void> {
  const code = (new URLSearchParams(location.search).get("code") ?? "").trim().toUpperCase();
  const title = document.getElementById("title")!;
  if (!/^[A-Z0-9]{1,16}$/.test(code)) {
    show("open", true);
    title.textContent = "The Chronicle";
    document.getElementById("status")!.textContent = "A town code is needed. Open the chronicle from its town's page.";
    show("status", true);
    return;
  }
  const back = document.getElementById("backSealed") as HTMLAnchorElement;
  back.href = `./index.html`;
  try {
    const res = await fetch(`${serverBase()}/api/game/chronicle?code=${encodeURIComponent(code)}`);
    if (res.status === 403) {
      document.getElementById("sealedText")!.textContent =
        `The clerk’s hand is still moving. The chronicle of ${code} may only be read once the night has ended.`;
      show("sealed", true);
      return;
    }
    show("open", true);
    title.textContent = `The Chronicle of ${code}`;
    const status = document.getElementById("status")!;
    if (res.status === 503) {
      status.textContent = "The ledger is unreachable right now (no database) — entries will appear once the town server is connected.";
      show("status", true);
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { events: GameEvent[] };
    const entries = document.getElementById("entries")!;
    if (data.events.length === 0) {
      entries.append(el("p", "Nothing is written here yet.", "muted"));
    } else {
      entries.replaceChildren(...data.events.map(renderEntry));
    }
  } catch {
    show("open", true);
    title.textContent = `The Chronicle of ${code}`;
    document.getElementById("status")!.textContent = "The ledger could not be reached.";
    show("status", true);
  }
}

void load();
