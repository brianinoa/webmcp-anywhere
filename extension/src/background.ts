/**
 * Background service worker.
 *
 * - Tracks per-tab tool lists + call log (for the popup).
 * - Owns recipe syncing: fetches `${apiBase}/api/sync`, caches in
 *   chrome.storage.local, falls back to the cache, and re-syncs every 10
 *   minutes via chrome.alarms (plus on demand from the popup / content script).
 * - Answers `getState`, `getSettings`, `sync-recipes` messages.
 */
import { DEFAULT_SETTINGS, MSG_NAMESPACE, type ExtensionSettings, type Recipe, type SyncResponse } from "@webmcp-anywhere/shared";
import type { CallLogEntry, RuntimeRequest, StateResponse, SyncResult, TabState } from "./messaging";

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
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));
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
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.apiBase) void scheduledSync(true);
});
ensureAlarm();
