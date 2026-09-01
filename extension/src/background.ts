/**
 * Background service worker.
 *
 * - Tracks per-tab tool lists + call log (for the popup).
 * - Owns recipe syncing: fetches `${apiBase}/api/sync`, caches in
 *   chrome.storage.local, falls back to the cache, and re-syncs every 10
 *   minutes via chrome.alarms (plus on demand from the popup / content script).
 * - Answers `getState`, `getSettings`, `sync-recipes` messages.
 */
import {
  DEFAULT_SETTINGS,
  MSG_NAMESPACE,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ExtensionSettings,
  type Recipe,
  type RoomMessage,
  type SyncResponse,
} from "@webmcp-anywhere/shared";
import type {
  ArmResult,
  CallLogEntry,
  RemoteStatus,
  RuntimeRequest,
  SavedRecipeResult,
  StateResponse,
  SyncResult,
  TabState,
} from "./messaging";

const ALARM = "webmcp-anywhere:sync";
const SYNC_PERIOD_MIN = 10;
const LOG_LIMIT = 50;
const CACHE_KEY = "recipesCache";

const tabs = new Map<number, TabState>();
let lastSync: StateResponse["lastSync"] | undefined;

async function getSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(stored as Partial<ExtensionSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

interface Cache {
  recipes: Recipe[];
  syncedAt: number;
  apiBase: string;
}

async function readCache(): Promise<Cache | null> {
  try {
    const { [CACHE_KEY]: c } = await chrome.storage.local.get(CACHE_KEY);
    return c && Array.isArray(c.recipes) ? (c as Cache) : null;
  } catch {
    return null;
  }
}

/** Fetch recipes from the worker; on failure fall back to the cache. */
async function syncRecipes(force = false): Promise<SyncResult> {
  const settings = await getSettings();
  const apiBase = settings.apiBase.replace(/\/+$/, "");
  const cache = await readCache();
  const fresh = cache && cache.apiBase === apiBase && Date.now() - cache.syncedAt < SYNC_PERIOD_MIN * 60_000;
  if (!force && fresh) return { recipes: cache.recipes, source: "cache", syncedAt: cache.syncedAt };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${apiBase}/api/sync`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as SyncResponse;
    const recipes = Array.isArray(body.recipes) ? body.recipes : [];
    const syncedAt = Date.now();
    await chrome.storage.local.set({ [CACHE_KEY]: { recipes, syncedAt, apiBase } satisfies Cache });
    lastSync = { at: syncedAt, source: "remote", count: recipes.length };
    return { recipes, source: "remote", syncedAt };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    lastSync = { at: Date.now(), source: cache ? "cache" : "none", count: cache?.recipes.length ?? 0, error };
    if (cache) return { recipes: cache.recipes, source: "cache", error, syncedAt: cache.syncedAt };
    return { recipes: [], source: "none", error };
  }
}

async function broadcastRecipes(recipes: Recipe[]): Promise<void> {
  const all = await chrome.tabs.query({});
  for (const t of all) {
    if (t.id === undefined) continue;
    chrome.tabs.sendMessage(t.id, { ns: MSG_NAMESPACE, type: "recipes-updated", recipes }).catch(() => {});
  }
}

async function scheduledSync(force: boolean): Promise<SyncResult> {
  const result = await syncRecipes(force);
  if (result.source === "remote") await broadcastRecipes(result.recipes);
  return result;
}

/**
 * POST a draft user recipe to the worker (which assigns a fresh id). On success,
 * force a sync so the new recipe is cached and broadcast to every open tab — its
 * tools then register on the current page within seconds via the fast-sync path.
 */
async function saveRecipe(recipe: Recipe): Promise<SavedRecipeResult> {
  const settings = await getSettings();
  const apiBase = settings.apiBase.replace(/\/+$/, "");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${apiBase}/api/recipes`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(recipe),
    });
    clearTimeout(timer);
    const body = (await res.json().catch(() => undefined)) as
      | (Recipe & { error?: string; errors?: string[] })
      | undefined;
    if (!res.ok) {
      const err = body?.error ?? body?.errors?.join("; ") ?? `HTTP ${res.status}`;
      return { ok: false, error: err };
    }
    if (!body || typeof body.id !== "string") return { ok: false, error: "Malformed response from server" };
    const saved = body as Recipe;
    // Make the new recipe live now: cache it + broadcast to tabs so its tools register.
    await scheduledSync(true);
    return { ok: true, recipe: saved };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Remote control: connect the armed tab to a relay room so a remote device can
// call its (non-sensitive) WebMCP tools. Only ONE tab may be armed at a time.
// ---------------------------------------------------------------------------

const REMOTE_KEY = "remoteArm";
const REMOTE_RUN_TIMEOUT_MS = 30_000;

interface ArmState {
  tabId: number;
  code: string;
  apiBase: string;
}

/** Generate an unguessable room code from the shared alphabet using the CSPRNG. */
function makeRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  return out;
}

/** session storage survives SW restarts within a browser session; fall back to local. */
async function persistArm(state: ArmState | null): Promise<void> {
  try {
    const store = chrome.storage.session ?? chrome.storage.local;
    if (state) await store.set({ [REMOTE_KEY]: state });
    else await store.remove(REMOTE_KEY);
  } catch {
    /* best effort */
  }
}

async function readPersistedArm(): Promise<ArmState | null> {
  try {
    const store = chrome.storage.session ?? chrome.storage.local;
    const { [REMOTE_KEY]: s } = await store.get(REMOTE_KEY);
    return s && typeof s.tabId === "number" && typeof s.code === "string" ? (s as ArmState) : null;
  } catch {
    return null;
  }
}

class RemoteController {
  private arm: ArmState | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private backoff = 1000;
  private peers = { targets: 0, remotes: 0 };
  private pending = new Map<string, { resolve: (r: { ok: boolean; result?: string; error?: string }) => void; timer: ReturnType<typeof setTimeout> }>();

  isArmedTab(tabId: number): boolean {
    return this.arm?.tabId === tabId;
  }

  status(): RemoteStatus {
    if (!this.arm) return { armed: false };
    return {
      armed: true,
      tabId: this.arm.tabId,
      code: this.arm.code,
      remoteUrl: `${this.arm.apiBase}/remote/${this.arm.code}`,
      connected: this.connected,
      targets: this.peers.targets,
      remotes: this.peers.remotes,
    };
  }

  async armTab(tabId: number): Promise<ArmResult> {
    const settings = await getSettings();
    const apiBase = settings.apiBase.replace(/\/+$/, "");
    if (!/^https?:\/\//.test(apiBase)) return { ok: false, error: "Set a valid Worker API base in Settings first." };
    // Only one armed tab at a time.
    this.teardown();
    const code = makeRoomCode();
    this.arm = { tabId, code, apiBase };
    this.peers = { targets: 0, remotes: 0 };
    await persistArm(this.arm);
    this.connect();
    return { ok: true, code, remoteUrl: `${apiBase}/remote/${code}` };
  }

  async disarm(): Promise<void> {
    this.teardown();
    this.arm = null;
    await persistArm(null);
  }

  /** Re-arm on SW restart if a tab is still marked armed and still exists. */
  async restore(): Promise<void> {
    if (this.arm) return;
    const saved = await readPersistedArm();
    if (!saved) return;
    try {
      await chrome.tabs.get(saved.tabId); // throws if the tab is gone
    } catch {
      await persistArm(null);
      return;
    }
    this.arm = saved;
    this.peers = { targets: 0, remotes: 0 };
    this.connect();
  }

  /** Publish the armed tab's current tool list + page context to the relay. */
  publishTools(): void {
    if (!this.arm || !this.connected) return;
    const s = tabs.get(this.arm.tabId);
    const tools = s?.tools ?? [];
    chrome.tabs
      .get(this.arm.tabId)
      .then((tab) => this.send({ t: "tools", tools, page: { url: s?.url ?? tab.url ?? "", title: tab.title } }))
      .catch(() => this.send({ t: "tools", tools, page: { url: s?.url ?? "" } }));
  }

  /** content -> background: a remotely-triggered run finished. */
  onRunResult(callId: string, ok: boolean, result?: string, error?: string): void {
    const p = this.pending.get(callId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(callId);
    p.resolve({ ok, result, error });
  }

  private teardown(): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.backoff = 1000;
    this.connected = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: "remote control disarmed" });
    }
    this.pending.clear();
    if (this.ws) {
      try {
        this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private connect(): void {
    if (!this.arm) return;
    const wsBase = this.arm.apiBase.replace(/^http/, "ws");
    const url = `${wsBase}/api/room/${this.arm.code}?role=target`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      warnRemote("WebSocket construct failed:", err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.connected = true;
      this.backoff = 1000;
      this.send({ t: "hello", role: "target" });
      this.publishTools();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: RoomMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as RoomMessage;
      } catch {
        return;
      }
      void this.handle(msg);
    };
    ws.onerror = () => {
      /* onclose will follow */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.ws = null;
      if (this.arm) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.arm || this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 15_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.arm) this.connect();
    }, delay);
  }

  private send(msg: RoomMessage): void {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    } catch (err) {
      warnRemote("send failed:", err);
    }
  }

  private async handle(msg: RoomMessage): Promise<void> {
    switch (msg.t) {
      case "ping":
        this.send({ t: "pong" });
        break;
      case "peers":
        this.peers = { targets: msg.targets, remotes: msg.remotes };
        break;
      case "call":
        await this.handleCall(msg.callId, msg.tool, msg.input);
        break;
      // hello/tools/result/pong from the relay are not expected inbound at the target.
    }
  }

  private async handleCall(callId: string, tool: string, input: Record<string, unknown>): Promise<void> {
    if (!this.arm) return;
    const s = tabs.get(this.arm.tabId);
    const summary = s?.tools.find((t) => t.name === tool);
    // Defense in depth: block sensitive tools here too (main-world re-checks the
    // *effective* sensitivity as the authority). Unknown tools fall through to the
    // tab, which returns a clean "not found" error.
    if (summary && summary.sensitivity === "sensitive") {
      this.send({ t: "result", callId, ok: false, blocked: true, error: "sensitive tools are blocked over remote control" });
      return;
    }
    const outcome = await this.runOnTab(callId, tool, input);
    this.send({ t: "result", callId, ok: outcome.ok, result: outcome.result, error: outcome.error });
  }

  private runOnTab(callId: string, tool: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: string; error?: string }> {
    if (!this.arm) return Promise.resolve({ ok: false, error: "not armed" });
    const tabId = this.arm.tabId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve({ ok: false, error: "tool run timed out" });
      }, REMOTE_RUN_TIMEOUT_MS);
      this.pending.set(callId, { resolve, timer });
      chrome.tabs.sendMessage(tabId, { ns: MSG_NAMESPACE, type: "remote-run", callId, tool, input }).catch((err) => {
        const p = this.pending.get(callId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(callId);
        resolve({ ok: false, error: err instanceof Error ? err.message : "could not reach tab" });
      });
    });
  }
}

function warnRemote(...args: unknown[]): void {
  console.warn("[WebMCP Anywhere][remote]", ...args);
}

const remote = new RemoteController();

function tabState(tabId: number, url?: string): TabState {
  let s = tabs.get(tabId);
  if (!s) {
    s = { tabId, url: url ?? "", hasModelContext: false, tools: [], log: [], updatedAt: Date.now() };
    tabs.set(tabId, s);
  }
  if (url) s.url = url;
  s.updatedAt = Date.now();
  return s;
}

function updateBadgeText(tabId: number): void {
  const s = tabs.get(tabId);
  const n = s?.tools.length ?? 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: s?.hasModelContext ? "#4f46e5" : "#6b7280" }).catch(() => {});
}

function handlePageEvent(tabId: number, event: Extract<RuntimeRequest, { type: "page-event" }>["event"]): void {
  const s = tabState(tabId);
  switch (event.type) {
    case "ready":
      s.url = event.url;
      s.hasModelContext = event.hasModelContext;
      if (!event.hasModelContext) s.tools = [];
      break;
    case "tools-registered":
      s.tools = event.tools;
      break;
    case "tool-call": {
      const entry: CallLogEntry = {
        callId: event.callId,
        tool: event.tool,
        input: event.input,
        sensitivity: event.sensitivity,
        startedAt: Date.now(),
      };
      s.log.push(entry);
      if (s.log.length > LOG_LIMIT) s.log.shift();
      break;
    }
    case "tool-result": {
      const e = s.log.find((x) => x.callId === event.callId);
      if (e) {
        e.ok = event.ok;
        e.result = event.result;
        e.error = event.error;
        e.durationMs = event.durationMs;
      }
      break;
    }
    case "approval-request":
      break;
  }
  updateBadgeText(tabId);
  // Keep the remote peer's view of callable tools in sync with the armed tab.
  if ((event.type === "tools-registered" || event.type === "ready") && remote.isArmedTab(tabId)) {
    remote.publishTools();
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = raw as RuntimeRequest;
  if (!msg || msg.ns !== MSG_NAMESPACE) return false;
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case "page-event":
      if (tabId !== undefined) handlePageEvent(tabId, msg.event);
      sendResponse({ ok: true });
      return false;
    case "getState": {
      const id = msg.tabId ?? tabId;
      getSettings().then((settings) => {
        const resp: StateResponse = { state: id !== undefined ? (tabs.get(id) ?? null) : null, settings, lastSync };
        sendResponse(resp);
      });
      return true;
    }
    case "getSettings":
      getSettings().then(sendResponse);
      return true;
    case "sync-recipes":
      scheduledSync(!!msg.force)
        .then(sendResponse)
        .catch((err) => sendResponse({ recipes: [], source: "none", error: String(err) } satisfies SyncResult));
      return true;
    case "save-recipe":
      saveRecipe(msg.recipe)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: String(err) } satisfies SavedRecipeResult));
      return true;
    case "arm-remote":
      remote
        .armTab(msg.tabId)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ArmResult));
      return true;
    case "disarm-remote":
      remote.disarm().then(() => sendResponse({ ok: true }));
      return true;
    case "remote-status":
      sendResponse(remote.status());
      return false;
    case "remote-run-result":
      remote.onRunResult(msg.callId, msg.ok, msg.result, msg.error);
      sendResponse({ ok: true });
      return false;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  // Closing the armed tab disarms remote control (there's nothing left to drive).
  if (remote.isArmedTab(tabId)) void remote.disarm();
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) {
    const s = tabs.get(tabId);
    if (s && s.url !== info.url) {
      s.url = info.url;
      s.tools = [];
      s.hasModelContext = false;
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void scheduledSync(true);
});

function ensureAlarm(): void {
  chrome.alarms.get(ALARM).then((a) => {
    if (!a) chrome.alarms.create(ALARM, { periodInMinutes: SYNC_PERIOD_MIN, delayInMinutes: 1 });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void scheduledSync(true);
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void remote.restore();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.apiBase) void scheduledSync(true);
});
ensureAlarm();
// SW may have just spun up after being evicted; reconnect if a tab is still armed.
void remote.restore();
