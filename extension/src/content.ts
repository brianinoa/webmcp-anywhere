/**
 * ISOLATED-world content script: the bridge.
 *
 * - Relays MAIN-world events (ready / tools-registered / tool-call / tool-result /
 *   approval-request) to the background service worker for the popup.
 * - Loads settings + recipes (remote via background, cached, or bundled) and
 *   posts them into the page for main-world.ts.
 * - Hosts the in-page badge (Shadow DOM) which handles approvals.
 */
import {
  DEFAULT_SETTINGS,
  MSG_NAMESPACE,
  type ExtensionSettings,
  type MainToIsolated,
  type Recipe,
} from "@webmcp-anywhere/shared";
import { createBadge, type Badge } from "./badge";
import { log, onMainMessage, postToMain, sendRuntime, warn, type RuntimePush, type SyncResult } from "./messaging";

// Bundled first-party recipes (recipes/*.json at repo root). Empty glob is fine.
const bundledModules = import.meta.glob<{ default: Recipe }>("../../recipes/*.json", { eager: true });
const BUNDLED_RECIPES: Recipe[] = Object.values(bundledModules)
  .map((m) => (m as { default?: Recipe }).default ?? (m as unknown as Recipe))
  .filter((r) => r && typeof r === "object" && Array.isArray(r.tools));

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let badge: Badge | null = null;
let currentRecipes: Recipe[] = [];

function isRecipe(r: unknown): r is Recipe {
  return !!r && typeof r === "object" && typeof (r as Recipe).id === "string" && Array.isArray((r as Recipe).matches) && Array.isArray((r as Recipe).tools);
}

/** Remote recipes may never run arbitrary JS: drop any tool that carries a `js` action. */
function sanitizeRemote(recipes: Recipe[]): Recipe[] {
  return recipes.filter(isRecipe).map((r) => {
    const tools = r.tools.filter((t) => {
      const hasJs = Array.isArray(t.actions) && t.actions.some((a) => a && a.kind === "js");
      if (hasJs) warn(`dropping remote recipe tool "${t.name}" from "${r.id}": js actions are only allowed in bundled recipes`);
      return !hasJs;
    });
    return { ...r, tools };
  });
}

/** Bundled first, remote/cached recipes override by id. */
function mergeRecipes(remote: Recipe[]): Recipe[] {
  const byId = new Map<string, Recipe>();
  for (const r of BUNDLED_RECIPES) byId.set(r.id, r);
  for (const r of sanitizeRemote(remote)) byId.set(r.id, r);
  return Array.from(byId.values());
}

function pushRecipes(remote: Recipe[]): void {
  currentRecipes = mergeRecipes(remote);
  postToMain({ type: "recipes", recipes: currentRecipes });
}

async function loadSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...(stored as Partial<ExtensionSettings>) };
  } catch (err) {
    warn("could not read settings:", err);
  }
  postToMain({ type: "settings", settings });
  badge?.setVisible(settings.showBadge);
}

async function loadRecipes(): Promise<void> {
  try {
    const res = await sendRuntime<SyncResult>({ type: "sync-recipes" });
    if (res?.error) warn("recipe sync:", res.error, `(using ${res.source})`);
    pushRecipes(res?.recipes ?? []);
  } catch (err) {
    warn("recipe sync failed, using bundled recipes only:", err);
    pushRecipes([]);
  }
}

function forwardToBackground(event: MainToIsolated): void {
  sendRuntime({ type: "page-event", event }).catch(() => {
    /* background may be asleep or the extension reloaded; not fatal */
  });
}

function handleApproval(msg: Extract<MainToIsolated, { type: "approval-request" }>): void {
  const respond = (approved: boolean) => postToMain({ type: "approval-response", callId: msg.callId, approved });
  if (badge && settings.showBadge) {
    badge.requestApproval(msg, respond);
    return;
  }
  // Badge hidden: fall back to a native confirm so sensitive tools still need a human.
  let approved = false;
  try {
    approved = window.confirm(
      `WebMCP Anywhere\n\nAn AI agent wants to run "${msg.tool}" on this page with input:\n${JSON.stringify(msg.input, null, 2)}\n\nAllow?`,
    );
  } catch {
    approved = false;
  }
  respond(approved);
}

function installMainListener(): void {
  onMainMessage((msg) => {
    forwardToBackground(msg);
    switch (msg.type) {
      case "ready":
        badge?.setStatus(msg.hasModelContext, msg.url);
        break;
      case "tools-registered":
        badge?.setTools(msg.tools);
        break;
      case "tool-call":
        badge?.onCall(msg);
        break;
      case "tool-result":
        badge?.onResult(msg);
        break;
      case "approval-request":
        handleApproval(msg);
        break;
    }
  });
}

function installRuntimeListener(): void {
  chrome.runtime.onMessage.addListener((raw: unknown) => {
    const msg = raw as RuntimePush;
    if (!msg || msg.ns !== MSG_NAMESPACE) return;
    if (msg.type === "recipes-updated") {
      log("recipes updated from background:", msg.recipes.length);
      pushRecipes(msg.recipes);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let touched = false;
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExtensionSettings>) {
      if (key in changes) {
        (settings as unknown as Record<string, unknown>)[key] = changes[key].newValue ?? DEFAULT_SETTINGS[key];
        touched = true;
      }
    }
    if (touched) {
      postToMain({ type: "settings", settings });
      badge?.setVisible(settings.showBadge);
    }
  });
}

/**
 * Recipe Studio dispatches this DOM event after any recipe mutation (its own
 * WebMCP tools included). Re-sync immediately so the new recipe reaches every
 * open tab in seconds instead of waiting for the 10-minute alarm.
 */
function installStudioListener(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("webmcp-anywhere:recipes-changed", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      log("studio reported recipe changes; syncing now");
      sendRuntime({ type: "sync-recipes", force: true }).catch(() => {});
    }, 500);
  });
}

function mountBadge(): void {
  const mount = () => {
    try {
      badge = createBadge({ visible: settings.showBadge });
    } catch (err) {
      warn("badge failed to mount:", err);
    }
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

async function main(): Promise<void> {
  if (window !== window.top) return;
  installMainListener();
  installRuntimeListener();
  installStudioListener();
  mountBadge();
  await loadSettings();
  await loadRecipes();
}

main().catch((err) => warn("content script fatal:", err));
