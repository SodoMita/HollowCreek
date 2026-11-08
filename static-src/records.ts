// Hall of Records: the lifetime table from GET /api/game/stats, drawn with the
// DOM API so player names are never parsed as markup.
import { serverBase } from "./server-base";

type Row = {
  playerId: string; name: string; games: number; wins: number; losses: number;
  kills: number; deaths: number; tasksDone: number; cagings: number; unlocks: number;
  reports: number; bells: number; chatChars: number; playtimeSec: number;
};

const COLUMNS: { key: string; label: string; title: string; get: (r: Row) => string | number; cls?: string }[] = [
  { key: "games", label: "Nights", title: "Games played", get: (r) => r.games },
  { key: "wins", label: "Wins", title: "Nights survived / claimed", get: (r) => r.wins, cls: "wins" },
  { key: "losses", label: "Losses", title: "Lost nights", get: (r) => r.losses },
  { key: "kills", label: "Kills", title: "Kills as the Hollow", get: (r) => r.kills, cls: "kills" },
  { key: "deaths", label: "Deaths", title: "Times found dead", get: (r) => r.deaths, cls: "deaths" },
  { key: "tasks", label: "Wards", title: "Chores completed", get: (r) => r.tasksDone },
  { key: "cagings", label: "Caged", title: "Times voted into a cage", get: (r) => r.cagings },
  { key: "unlocks", label: "Freed", title: "Prisoners freed with the iron key", get: (r) => r.unlocks },
  { key: "reports", label: "Reports", title: "Bodies reported", get: (r) => r.reports },
  { key: "bells", label: "Bells", title: "Times the bell was rung", get: (r) => r.bells },
  { key: "chars", label: "Letters", title: "Characters spoken into the night", get: (r) => r.chatChars },
  { key: "time", label: "Time", title: "Time spent in the dark", get: (r) => fmtTime(r.playtimeSec) },
];

export function fmtTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

function notice(text: string): void {
  const status = document.getElementById("status")!;
  status.textContent = text;
  status.hidden = false;
}

function draw(rows: Row[]): void {
  const totals = rows.reduce(
    (a, r) => ({
      games: a.games + r.games, kills: a.kills + r.kills, deaths: a.deaths + r.deaths,
      tasks: a.tasks + r.tasksDone, chars: a.chars + r.chatChars, time: a.time + r.playtimeSec,
    }),
    { games: 0, kills: 0, deaths: 0, tasks: 0, chars: 0, time: 0 },
  );
  const bar = document.getElementById("totals")!;
  bar.replaceChildren(
    stat(rows.length, "souls recorded"),
    stat(totals.games, "nights played"),
    stat(`${totals.kills} kills · ${totals.deaths} deaths`),
    stat(totals.tasks, "wards restored"),
    stat(totals.chars.toLocaleString(), "letters spoken"),
    stat(fmtTime(totals.time), "in the dark"),
  );
  bar.hidden = false;
  if (rows.length === 0) {
    document.getElementById("empty")!.hidden = false;
    return;
  }
  const head = document.getElementById("head")!;
  head.replaceChildren(el("th", "Soul"), ...COLUMNS.map((c) => {
    const th = el("th", c.label);
    th.title = c.title;
    return th;
  }));
  const body = document.getElementById("rows")!;
  body.replaceChildren(...rows.map((r, i) => {
    const tr = el("tr");
    if (i < 3) tr.className = "top";
    const name = el("td", `${i + 1}. ${r.name}`, "name");
    if (r.games > 0) {
      name.append(el("span", `${Math.round((100 * r.wins) / r.games)}%`, "pct"));
    }
    tr.append(name, ...COLUMNS.map((c) => el("td", String(c.get(r)), c.cls)));
    return tr;
  }));
  document.getElementById("tablewrap")!.hidden = false;
}

function stat(value: string | number, label?: string): HTMLElement {
  const span = el("span");
  span.append(el("b", String(value)), label ? ` ${label}` : "");
  return span;
}

async function load(): Promise<void> {
  const base = serverBase();
  try {
    const res = await fetch(`${base}/api/game/stats`);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { rows: Row[] };
    draw(data.rows);
  } catch {
    notice("The clerk’s ledger is unreachable right now (no database or no server) — stats will appear once the town server is connected.");
  }
}

void load();
