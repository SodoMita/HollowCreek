// Standalone room HUD: diffed DOM writes (skips unchanged regions), lobby/end
// overlays, meeting verdict, and minimap updates. No React, no framework.
import { BUILDINGS, DOOR_REACH, doorX } from "../src/game/buildings";
import { keyLabel, type GameSettings } from "../src/game/settings";
import { BELL_X, type Snapshot } from "../src/game/types";
import type { VoiceStatus } from "../src/game/voice";
import { Minimap } from "./minimap";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function voiceControlsMarkup(v: VoiceStatus) {
  return `<div class="row" style="margin-top:10px;justify-content:center;align-items:center;flex-wrap:wrap">
    <button class="chip" data-act="voice" ${v.starting ? "disabled" : ""}>${v.starting ? "Asking for microphone…" : v.active ? "Leave voice chat" : "Join proximity voice"}</button>
    ${v.active ? `<button class="chip" data-act="micmute">${v.muted ? "Unmute mic" : "Mute mic"}</button>` : ""}
    </div>${v.active ? `<p class="muted" data-voicepeers style="margin-top:4px">${v.connected} connected · ${v.nearby} within earshot · the dead hear only the dead</p>` : ""}
    ${v.error ? `<p role="alert" style="color:#e29a84;font-size:12px">${esc(v.error)}${v.error.includes("Enable sound") ? ` <button data-act="voiceplay" style="text-decoration:underline">Enable sound</button>` : ""}</p>` : ""}`;
}

function renderMatchResults(s: Snapshot): string {
  if (!s.results) return "";
  const time = `${Math.floor(s.results.durationSec / 60)}m ${String(s.results.durationSec % 60).padStart(2, "0")}s`;
  const cards = s.results.players.map((p) => {
    const st = p.stats;
    const rows: [string, number][] = [
      ["Repaired", st.repairs], ["Kits", st.kitsDelivered], ["Kills", st.kills], ["Deaths", st.deaths],
      ["Jailed", st.timesCaged], ["Unlocked", st.cagesOpened], ["Votes", st.votes], ["Reports", st.reports],
      ["Ruins", st.ruins], ["Bells", st.bells], ["Snuffs", st.blackouts], ["Steps", st.distance],
    ];
    return `<div style="border:1px solid #3a2733;border-radius:6px;background:#1d1420;padding:9px;margin-top:6px">
      <div style="display:flex;align-items:center;gap:8px;font-size:14px">
        <span style="width:11px;height:11px;border-radius:50%;background:${esc(p.color)}"></span>
        <b>${esc(p.name)}</b>
        <span style="margin-left:auto;color:${p.role === "hollow" ? "#ff8a7a" : "#a8c98a"}">${p.role === "hollow" ? "HOLLOW" : "TOWNFOLK"}</span>
        <small style="color:#9c8b7a">${!p.alive ? "dead" : p.caged ? "jailed" : "free"}</small>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;margin-top:7px;font-size:10px;color:#9c8b7a">
        ${rows.map(([label, value]) => `<span>${label} <b style="color:#e9dfcf">${value}</b></span>`).join("")}
      </div>
    </div>`;
  }).join("");
  return `<section aria-label="Match results" style="margin-top:16px;text-align:left">
    <div style="display:flex;justify-content:space-between;gap:12px;color:#c9b8a4;font-size:11px;text-transform:uppercase;letter-spacing:.12em">
      <span>Who was who · this match</span><span style="text-transform:none;letter-spacing:0">${time}</span>
    </div>
    <div style="max-height:42dvh;overflow-y:auto">${cards}</div>
  </section>`;
}

export class RoomHud {
  private readonly cache = new Map<string, string>();
  readonly minimap = new Minimap($("minimap"));
  overlayKey = "";
  tasksOpen = window.innerWidth > 640;

  private set(id: string, text: string) {
    if (this.cache.get(id) === text) return;
    this.cache.set(id, text);
    $(id).textContent = text;
  }

  private display(id: string, disp: string) {
    const k = `d:${id}`;
    if (this.cache.get(k) === disp) return;
    this.cache.set(k, disp);
    $(id).style.display = disp;
  }

  private attr(id: string, prop: string, val: string) {
    const k = `${prop}:${id}`;
    if (this.cache.get(k) === val) return;
    this.cache.set(k, val);
    const el = $(id);
    if (prop === "cls") el.className = val;
    else if (prop === "title") el.title = val;
    else if (prop === "color") el.style.color = val;
    else if (prop === "bg") el.style.background = val;
    else if (prop === "w") el.style.width = val;
  }

  invalidateOverlay() {
    this.overlayKey = "";
  }

  renderCountdowns(s: Snapshot) {
    if (s.phase === "meeting" && s.meeting) {
      const me = s.players.find((p) => p.id === s.self.id);
      const secs = Math.max(0, Math.ceil((s.meeting.endsAt - s.now) / 1000));
      const subHtml = s.meeting.inArea
        ? `Cast your verdict — <b>${secs}s</b>`
        : `Walk to the town square ${me && me.x < BELL_X ? "→ east" : "← west"} — <b>${secs}s</b>`;
      if (this.cache.get("msub") !== subHtml) {
        this.cache.set("msub", subHtml);
        $("banner").querySelector(".sub")!.innerHTML = subHtml;
      }
    }
    if (s.time?.mode === "past") {
      this.set("status", `In the past · ${Math.max(0, Math.ceil(((s.time.endsAt ?? s.now) - s.now) / 1000))}s remaining · M to return`);
    }
  }

  render(s: Snapshot, settings: GameSettings, voiceStatus: VoiceStatus, server: string, glassUp: boolean) {
    const me = s.players.find((p) => p.id === s.self.id);
    this.set("copycode", s.code);
    this.set("soulcount", `${s.playerCount} souls${s.self.hasSupply ? " · kit carried" : ""}`);
    this.display("supplydrop", s.phase === "playing" && s.self.hasSupply ? "inline-block" : "none");
    const meX = me ? me.x : 0;
    const nearNote = (s.notes ?? []).filter((n) => Math.abs(n.x - meX) <= 150).sort((a, b) => Math.abs(a.x - meX) - Math.abs(b.x - meX))[0];
    this.display("readnote", s.phase === "playing" ? "inline-block" : "none");
    const noteId = nearNote ? nearNote.id : "";
    if (this.cache.get("noteId") !== noteId) { this.cache.set("noteId", noteId); $("readnote").dataset.noteId = noteId; }
    this.attr("readnote", "title", nearNote ? `Raise the spyglass to the page pinned by ${nearNote.author} (Z · wheel or pinch to zoom)` : "Raise the spyglass (Z · wheel or pinch to zoom)");
    this.display("pinbtn", s.phase === "playing" && s.self.alive ? "inline-block" : "none");
    this.display("pushbtn", s.phase === "playing" && s.self.alive && !s.self.caged && !s.self.hasSupply ? "block" : "none");
    this.set("pushbtn", `Hold Push + ◀▶${s.cartPushers > 0 ? ` · ${s.cartPushers}` : ""}`);
    this.display("ruinbtn", s.phase === "playing" && s.self.alive && s.self.role === "hollow" ? "block" : "none");
    this.set("ruinbtn", `Ruin ${keyLabel(settings.controls.ruin)}${s.self.sabotageCooldownMs > 0 ? ` · ${Math.ceil(s.self.sabotageCooldownMs / 1000)}s` : ""}`);
    const ruinDis = !s.self.canSabotage ? "1" : "0";
    if (this.cache.get("ruinDis") !== ruinDis) { this.cache.set("ruinDis", ruinDis); ($("ruinbtn") as HTMLButtonElement).disabled = !s.self.canSabotage; }
    this.set("role", (!s.self.alive ? "Ghost" : s.self.role === "hollow" ? "The Hollow" : "Townfolk") + (s.self.caged && s.self.alive ? " · Caged" : ""));
    this.attr("role", "cls", !s.self.alive ? "ghost" : s.self.role);
    this.attr("taskfill", "w", `${s.taskBar.total ? (100 * s.taskBar.done) / s.taskBar.total : 0}%`);

    const tasksShow = s.phase !== "lobby" && s.self.alive && s.tasks.length > 0;
    this.display("tasks", tasksShow ? "block" : "none");
    if (tasksShow) {
      const tKey = `${s.self.role}|${s.time?.mode}|${this.tasksOpen}|` + s.tasks.map((t) => `${t.id}:${t.done ? 1 : 0}:${t.delivered ? 1 : 0}:${t.sabotaged ? 1 : 0}:${Math.round(t.progress * 100)}`).join(",");
      if (this.cache.get("tasks") !== tKey) {
        this.cache.set("tasks", tKey);
        $("tasks").innerHTML = `<div class="hd" id="tasktoggle">${s.self.role === "hollow" && s.time?.mode !== "past" ? "Town wards (pretend)" : "Town wards · shared"} ${this.tasksOpen ? "▾" : "▸"}</div>` +
          (this.tasksOpen ? s.tasks.map((t) => `<div class="t ${t.done ? "done" : ""}">${t.done ? "✓" : t.delivered ? "▣" : "◇"} ${esc(t.name)}${!t.done ? ` <span style="color:${t.delivered ? "var(--moss)" : "var(--amber)"}">${t.delivered ? t.progress > 0 ? `${Math.round(t.progress * 100)}%` : "puzzle ready" : t.sabotaged ? "ruined" : "needs kit"}</span>` : ""}</div>`).join("") : "");
      }
    }

    const fSlice = s.feed.slice(-4);
    const fKey = fSlice.map((f) => f.text).join("\u0000");
    if (this.cache.get("feed") !== fKey) {
      this.cache.set("feed", fKey);
      $("feed").innerHTML = fSlice.map((f, i) => `<p style="opacity:${0.4 + i * 0.2}">${esc(f.text)}</p>`).join("");
    }

    if (s.phase === "meeting" && s.meeting) {
      const secs = Math.max(0, Math.ceil((s.meeting.endsAt - s.now) / 1000));
      this.display("banner", "block");
      const whyText = `🔔 ${s.meeting.reason}`;
      if (this.cache.get("mwhy") !== whyText) { this.cache.set("mwhy", whyText); $("banner").querySelector(".why")!.textContent = whyText; }
      const subHtml = s.meeting.inArea
        ? `Cast your verdict — <b>${secs}s</b>`
        : `Walk to the town square ${me && me.x < BELL_X ? "→ east" : "← west"} — <b>${secs}s</b>`;
      if (this.cache.get("msub") !== subHtml) { this.cache.set("msub", subHtml); $("banner").querySelector(".sub")!.innerHTML = subHtml; }
      if (s.meeting.inArea && s.self.alive) {
        this.display("vote", "block");
        const opts = [
          ...s.players.filter((p) => p.alive && !p.caged && p.id !== s.self.id).map((p) => ({ key: p.id, label: `Cage ${p.name}`, color: p.color })),
          ...s.players.filter((p) => p.caged).map((p) => ({ key: `free:${p.id}`, label: `Free ${p.name}`, color: "#7fb069" })),
          { key: "skip", label: "Abstain", color: "#7f8c8d" },
        ];
        const vKey = `${s.self.myVote ?? ""}|` + opts.map((o) => `${o.key}:${o.label}`).join(",");
        if (this.cache.get("vote") !== vKey) {
          this.cache.set("vote", vKey);
          $("vote").innerHTML = `<h3>The Verdict</h3>` + opts.map((o) =>
            `<button data-vote="${o.key}" class="${s.self.myVote === o.key ? "mine" : ""}" ${s.self.myVote ? "disabled" : ""}><span class="dot" style="background:${o.color}"></span>${esc(o.label)}</button>`
          ).join("") + `<div class="note">${s.self.myVote ? "Verdict cast. Wait for the toll." : "Most votes: caged in the square. Free the caged by vote or iron key."}</div>`;
        }
      } else this.display("vote", "none");
    } else { this.display("banner", "none"); this.display("vote", "none"); }

    if (s.time?.mode === "past") {
      this.display("status", "block");
      this.set("status", `In the past · ${Math.max(0, Math.ceil(((s.time.endsAt ?? s.now) - s.now) / 1000))}s remaining · M to return`);
      this.attr("status", "color", "#b8e3de");
    } else if (!s.self.alive && s.phase !== "ended") {
      this.display("status", "block");
      this.set("status", "You are dead. Drift as a ghost — only the dead can see and hear you.");
      this.attr("status", "color", "#99aaaa");
    } else if (s.self.caged && s.self.alive) {
      this.display("status", "block");
      this.set("status", "The iron is cold. You can still speak and vote — plead for the key.");
      this.attr("status", "color", "var(--amber)");
    } else this.display("status", "none");

    const st = s.self.stamina;
    this.display("vigor", s.self.alive && s.phase !== "lobby" ? "flex" : "none");
    this.attr("vigorfill", "w", `${Math.round(st * 100)}%`);
    this.attr("vigorfill", "bg", st <= 0 ? "#e06a5a" : st < 0.3 ? "#d99a3d" : "#6b8e23");
    this.set("vigorlbl", s.self.exhausted ? "spent — rest!" : "vigor");
    this.attr("vigorlbl", "color", s.self.exhausted ? "#e06a5a" : "var(--dim)");

    this.display("timebtn", s.self.hasTimepiece || s.time?.mode === "past" ? "inline-block" : "none");
    this.set("timebtn", s.time?.mode === "past" ? "Return · M" : "Timepiece · M");
    this.display("hint", s.hint ? "block" : "none");
    if (s.hint) this.set("hint", s.hint);
    this.set("ebtn", keyLabel(settings.controls.interact));
    this.attr("ebtn", "cls", `rbtn ${s.hint ? "hot" : ""}`);
    const nearbyKeyedDoor = me ? BUILDINGS.find((b) => Math.abs(doorX(b) - me.x) <= DOOR_REACH && s.self.doorKeys?.includes(b.id)) : undefined;
    this.display("doorlock", nearbyKeyedDoor && s.self.alive && !s.self.caged ? "block" : "none");
    this.set("doorlock", `${s.doors?.find((d) => d.id === nearbyKeyedDoor?.id)?.locked ? "Unlock" : "Lock"} · L`);
    this.set("ability", s.abilityLabel);
    this.attr("ability", "cls", `rbtn kill ${s.abilityReady ? "hot" : ""}`);
    this.display("ability", s.self.alive ? "block" : "none");
    const snuffShow = s.self.role === "hollow" && s.self.alive && s.phase === "playing";
    this.display("snuffbtn", snuffShow ? "block" : "none");
    const snuffKey = keyLabel(settings.controls.blackout);
    if (this.cache.get("snuffKey") !== snuffKey) { this.cache.set("snuffKey", snuffKey); $("snuffbtn").querySelector("small")!.textContent = snuffKey; }
    this.attr("snuffbtn", "cls", `rbtn snuff ${s.self.canBlackout ? "hot" : ""}`);
    this.set("cd", s.self.role === "hollow" && s.self.alive
      ? (s.self.killCooldownMs > 0 ? `${Math.ceil(s.self.killCooldownMs / 1000)}s` : "") + (s.self.blackoutCooldownMs > 0 ? ` 🌑${Math.ceil(s.self.blackoutCooldownMs / 1000)}s` : "")
      : "");

    const mmKey = `${s.phase}|${Math.round(meX / 8)}|${Math.round(s.cartX / 12)}|${s.keyX ?? ""}|${glassUp ? 1 : 0}|${s.tasks.map((t) => (t.done ? "2" : t.delivered ? "1" : "0")).join("")}`;
    if (this.cache.get("mm") !== mmKey) {
      this.cache.set("mm", mmKey);
      this.minimap.update(s, glassUp);
    }

    const key = JSON.stringify([s.phase, s.players.map((p) => [p.id, p.name, p.isHost]), s.self.id === s.hostId, s.round, s.winner, s.playerCount]);
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      const ov = $("overlay"), panel = $("overlaypanel");
      if (s.phase === "lobby") {
        ov.style.display = "flex";
        panel.innerHTML = `
          <h2>${s.round > 0 ? `Night ${s.round + 1} approaches` : "Gathering at dusk"}</h2>
          <p class="muted" style="margin-top:4px">${s.round > 0 ? "The same souls, the same street — new roles when darkness falls" : "Share the town code with your fellow townsfolk"}</p>
          <div class="bigcode">${s.code}</div>
          <p style="margin-top:10px;color:#c9b8a4;font-size:13px">The wards are broken. Deliver a kit from the one cart, then press E at the ward to play its repair puzzle. More hands push the cart faster. Cages hold suspects; repair every ward to win.</p>
          <div class="roster">${s.players.map((p) => `<div class="seat"><span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span>${p.isHost ? `<span class="host">host</span>` : ""}</div>`).join("")}</div>
          ${s.self.id === s.hostId
            ? `<button class="big" data-act="start" ${s.playerCount < 4 ? "disabled" : ""}>${s.playerCount < 4 ? "Waiting for more souls… (min 4)" : "Let night fall"}</button>`
            : `<p class="muted" style="margin-top:16px">Waiting for the host to let night fall…</p>`}
          <div class="row" style="margin-top:14px;justify-content:center">
            <button class="chip" data-act="settings">⚙ Settings</button>
            <button class="chip" data-act="menu" style="border-color:#84624c;padding:10px 12px;flex:1">← Back to towns</button>
          </div>
          ${voiceControlsMarkup(voiceStatus)}
          <p class="muted">4–10 players · 1–2 of you will be Hollow</p>`;
      } else if (s.phase === "ended") {
        ov.style.display = "flex";
        panel.innerHTML = `
          <h2 style="color:${s.winner === "hollow" ? "#ff4a3a" : "#a8c98a"};font-size:44px">${s.winner === "hollow" ? "The Hollow wins" : "The town survives"}</h2>
          <p style="margin-top:12px;font-style:italic;color:#c9b8a4">${esc(s.winReason ?? "")}</p>
          ${renderMatchResults(s)}
          ${voiceControlsMarkup(voiceStatus)}
          ${s.self.id === s.hostId ? `<button class="big" data-act="restart">Gather the same souls again</button>` : `<p class="muted" style="margin-top:14px">The lantern-bearer may gather this town for another night…</p>`}
          <div class="row" style="margin-top:12px;justify-content:center;gap:10px">
            <button class="chip" data-act="settings">⚙ Settings</button>
            <button class="chip" data-act="menu" style="border-color:#84624c;padding:10px 12px;flex:1">← Back to towns</button>
            <a class="chip" href="chronicle.html?code=${encodeURIComponent(s.code)}&server=${encodeURIComponent(server)}" target="_blank" style="text-decoration:none">Chronicle</a>
            <a class="chip" href="records.html?server=${encodeURIComponent(server)}" target="_blank" style="text-decoration:none">Records</a>
          </div>`;
      } else ov.style.display = "none";
    }
  }
}
