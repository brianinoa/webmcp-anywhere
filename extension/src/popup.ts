import { DEFAULT_SETTINGS, type ExtensionSettings } from "@webmcp-anywhere/shared";
import { sendRuntime, summarize, type ArmResult, type RemoteStatus, type StateResponse, type SyncResult } from "./messaging";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function currentTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function bindSettings(settings: ExtensionSettings): void {
  $<HTMLInputElement>("apiBase").value = settings.apiBase;
  $<HTMLInputElement>("approveSensitive").checked = settings.approveSensitive;
  $<HTMLInputElement>("approveWrites").checked = settings.approveWrites;
  $<HTMLInputElement>("showBadge").checked = settings.showBadge;
}

function wireSettings(): void {
  $<HTMLInputElement>("apiBase").addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.apiBase;
    chrome.storage.sync.set({ apiBase: v });
  });
  for (const key of ["approveSensitive", "approveWrites", "showBadge"] as const) {
    $<HTMLInputElement>(key).addEventListener("change", (e) => {
      chrome.storage.sync.set({ [key]: (e.target as HTMLInputElement).checked });
    });
  }
  $<HTMLButtonElement>("sync").addEventListener("click", async () => {
    const info = $("syncInfo");
    info.textContent = "syncing…";
    try {
      const r = await sendRuntime<SyncResult>({ type: "sync-recipes", force: true });
      info.textContent = r.error ? `failed (${r.error}); using ${r.source}` : `${r.recipes.length} recipes (${r.source})`;
    } catch (err) {
      info.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}

function renderState(resp: StateResponse): void {
  const s = resp.state;
  const status = $("status");
  if (!s) status.textContent = "No data for this tab yet — reload the page.";
  else if (!s.hasModelContext)
    status.textContent = "document.modelContext not available on this tab. Enable chrome://flags/#enable-webmcp-testing.";
  else status.textContent = `Active on ${new URL(s.url).host}`;

  const tools = $("tools");
  tools.replaceChildren();
  $("toolCount").textContent = s?.tools.length ? `(${s.tools.length})` : "";
  if (!s?.tools.length) tools.append(Object.assign(document.createElement("div"), { className: "empty", textContent: "None" }));
  for (const t of s?.tools ?? []) {
    const row = document.createElement("div");
    row.className = "tool";
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = t.name;
    n.title = t.description;
    row.append(n);
    if (t.source === "recipe") row.append(Object.assign(document.createElement("span"), { className: "chip", textContent: t.recipeId ?? "recipe" }));
    row.append(Object.assign(document.createElement("span"), { className: `chip ${t.sensitivity}`, textContent: t.sensitivity }));
    tools.append(row);
  }

  const log = $("log");
  log.replaceChildren();
  const entries = (s?.log ?? []).slice().reverse();
  if (!entries.length) log.append(Object.assign(document.createElement("div"), { className: "empty", textContent: "No calls yet" }));
  for (const e of entries) {
    const div = document.createElement("div");
    div.className = "entry";
    const mark = e.ok === undefined ? "…" : e.ok ? "✓" : "✗";
    div.innerHTML = `<span class="t"></span><span class="d"></span><div class="b"></div>`;
    (div.querySelector(".t") as HTMLElement).textContent = `${mark} ${e.tool}`;
    (div.querySelector(".d") as HTMLElement).textContent = e.durationMs !== undefined ? `${e.durationMs} ms` : "";
    const body = div.querySelector(".b") as HTMLElement;
    const input = summarize(e.input, 100);
    body.textContent = [input && input !== "{}" ? `→ ${input}` : "", e.ok === false ? `← ${e.error}` : e.result ? `← ${summarize(e.result, 160)}` : ""]
      .filter(Boolean)
      .join("\n");
    log.append(div);
  }

  if (resp.lastSync) {
    const d = new Date(resp.lastSync.at);
    $("syncInfo").textContent = `${resp.lastSync.count} recipes (${resp.lastSync.source}) ${d.toLocaleTimeString()}${resp.lastSync.error ? " — " + resp.lastSync.error : ""}`;
  }
}

// ---------------------------------------------------------------------------
// Remote control
// ---------------------------------------------------------------------------

function renderRemote(s: RemoteStatus): void {
  const idle = $("remoteIdle");
  const armed = $("remoteArmed");
  idle.hidden = s.armed;
  armed.hidden = !s.armed;
  if (!s.armed) return;
  $("remoteCode").textContent = s.code ?? "";
  $<HTMLInputElement>("remoteUrl").value = s.remoteUrl ?? "";
  const dot = $("remoteDot");
  const text = $("remoteConnText");
  const remotes = s.remotes ?? 0;
  if (!s.connected) {
    dot.className = "dot";
    text.textContent = "Connecting to relay…";
  } else if (remotes > 0) {
    dot.className = "dot live";
    text.textContent = `${remotes} device${remotes === 1 ? "" : "s"} connected`;
  } else {
    dot.className = "dot wait";
    text.textContent = "Waiting for a device…";
  }
}

async function refreshRemote(): Promise<void> {
  try {
    const s = await sendRuntime<RemoteStatus>({ type: "remote-status" });
    renderRemote(s ?? { armed: false });
  } catch {
    /* background asleep; ignore */
  }
}

function wireRemote(): void {
  $<HTMLButtonElement>("armBtn").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("armBtn");
    const tabId = await currentTabId();
    if (tabId === undefined) return;
    btn.disabled = true;
    try {
      const res = await sendRuntime<ArmResult>({ type: "arm-remote", tabId });
      if (!res.ok) $("status").textContent = `Remote: ${res.error}`;
      await refreshRemote();
    } finally {
      btn.disabled = false;
    }
  });
  $<HTMLButtonElement>("disarmBtn").addEventListener("click", async () => {
    await sendRuntime({ type: "disarm-remote" });
    await refreshRemote();
  });
  $<HTMLButtonElement>("copyLink").addEventListener("click", async () => {
    const url = $<HTMLInputElement>("remoteUrl").value;
    try {
      await navigator.clipboard.writeText(url);
      $("copyInfo").textContent = "copied";
    } catch {
      $<HTMLInputElement>("remoteUrl").select();
      $("copyInfo").textContent = "select + copy";
    }
    setTimeout(() => ($("copyInfo").textContent = ""), 1500);
  });
}

async function refresh(): Promise<void> {
  const tabId = await currentTabId();
  const resp = await sendRuntime<StateResponse>({ type: "getState", tabId });
  bindSettings(resp.settings);
  renderState(resp);
  await refreshRemote();
}

wireSettings();
wireRemote();
refresh().catch((err) => ($("status").textContent = `Error: ${err}`));
setInterval(() => refresh().catch(() => {}), 1500);
