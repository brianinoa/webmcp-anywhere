/**
 * MAIN-world content script: registers WebMCP tools on document.modelContext.
 *
 * - Generic tools (describe_page, click, ...) are registered on every page.
 * - Recipe tools arrive from the ISOLATED world (`recipes` message) and are
 *   registered when the recipe's match patterns fit location.href. They are
 *   re-evaluated on SPA navigations (pushState/replaceState/popstate).
 * - Every execute goes through invoke(): logs the call to the ISOLATED world,
 *   asks for approval when the tool is sensitive, runs it, reports the result.
 */
import {
  DEFAULT_SETTINGS,
  effectiveSensitivity,
  matchesPattern,
  waitForModelContext,
  GENERIC_TOOL_NAMES,
  type ExtensionSettings,
  type ModelContext,
  type ModelContextTool,
  type Recipe,
  type RecipeTool,
  type Sensitivity,
  type ToolSummary,
} from "@webmcp-anywhere/shared";
import { GENERIC_TOOLS, type GenericToolDef } from "./generic";
import { runRecipeTool } from "./recipes/runner";
import { log, newCallId, onIsolatedMessage, onRunTool, postRunResult, postToIsolated, summarize, warn } from "./messaging";

const APPROVAL_TIMEOUT_MS = 60_000;
const RESULT_MAX_CHARS = 8_000;

interface Registered {
  summary: ToolSummary;
  controller: AbortController;
  /** The registered tool, so a remote run can reuse its invoke()-wrapped execute. */
  tool: ModelContextTool;
  /** The *effective* sensitivity (stricter of declared vs. actions) — the real gate. */
  sensitivity: Sensitivity;
  /** Recipe version the tool was built from, so recipe updates re-register. */
  recipeVersion?: number;
}

const state = {
  mc: null as ModelContext | null,
  settings: { ...DEFAULT_SETTINGS } as ExtensionSettings,
  recipes: [] as Recipe[],
  registered: new Map<string, Registered>(),
  pendingApprovals: new Map<string, (approved: boolean) => void>(),
  lastUrl: location.href,
};

// ---------------------------------------------------------------------------
// invoke(): common pipeline around every tool execution
// ---------------------------------------------------------------------------

function needsApproval(sensitivity: Sensitivity): boolean {
  // "sensitive" always prompts — settings can make the gate stricter, never weaker,
  // so a forged `settings` message from a hostile page can't disable it.
  if (sensitivity === "sensitive") return true;
  if (sensitivity === "write") return state.settings.approveWrites;
  return false;
}

function awaitApproval(callId: string, tool: string, input: unknown, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingApprovals.delete(callId);
      reject(new Error("User did not approve (timed out after 60s)"));
    }, APPROVAL_TIMEOUT_MS);
    const finish = (approved: boolean) => {
      clearTimeout(timer);
      state.pendingApprovals.delete(callId);
      if (approved) resolve();
      else reject(new Error("User did not approve"));
    };
    state.pendingApprovals.set(callId, finish);
    signal.addEventListener("abort", () => finish(false), { once: true });
    postToIsolated({ type: "approval-request", callId, tool, input });
  });
}

function toResultString(result: unknown): string {
  let s = typeof result === "string" ? result : JSON.stringify(result ?? { ok: true });
  if (s.length > RESULT_MAX_CHARS) s = s.slice(0, RESULT_MAX_CHARS) + "…(truncated)";
  return s;
}

async function invoke(
  name: string,
  sensitivity: Sensitivity,
  input: Record<string, unknown>,
  signal: AbortSignal,
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> | unknown,
): Promise<string> {
  const callId = newCallId();
  const started = performance.now();
  postToIsolated({ type: "tool-call", callId, tool: name, input, sensitivity });
  try {
    if (needsApproval(sensitivity)) await awaitApproval(callId, name, input, signal);
    const raw = await run(input ?? {}, signal);
    const result = toResultString(raw);
    const durationMs = Math.round(performance.now() - started);
    postToIsolated({ type: "tool-result", callId, ok: true, result: summarize(result, 400), durationMs });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Math.round(performance.now() - started);
    console.error(`[WebMCP Anywhere] tool "${name}" failed:`, err);
    postToIsolated({ type: "tool-result", callId, ok: false, error, durationMs });
    throw err instanceof Error ? err : new Error(error);
  }
}

/** Shipped Chrome builds may call execute(input) with no options object; always yield a usable signal. */
function signalOf(options: { signal?: AbortSignal } | undefined): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

/** Chrome may hand us a JSON string instead of an object; normalise. */
function parseInput(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  }
  return (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function register(
  tool: ModelContextTool,
  summary: ToolSummary,
  sensitivity: Sensitivity,
  recipeVersion?: number,
): Promise<void> {
  if (!state.mc) return;
  if (state.registered.has(tool.name)) await unregister(tool.name);
  const controller = new AbortController();
  try {
    await state.mc.registerTool(tool, { signal: controller.signal });
    state.registered.set(tool.name, { summary, controller, tool, sensitivity, recipeVersion });
  } catch (err) {
    warn(`failed to register tool "${tool.name}":`, err);
  }
}

async function unregister(name: string): Promise<void> {
  const r = state.registered.get(name);
  if (!r) return;
  state.registered.delete(name);
  r.controller.abort();
  try {
    await state.mc?.unregisterTool?.(name);
  } catch {
    /* already gone via signal */
  }
}

function genericToTool(def: GenericToolDef): ModelContextTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    annotations: { readOnlyHint: def.readOnlyHint, untrustedContentHint: def.untrustedContentHint },
    execute: (input, options) => invoke(def.name, def.sensitivity, parseInput(input), signalOf(options), def.run),
  };
}

function recipeToTool(recipe: Recipe, tool: RecipeTool): ModelContextTool {
  // Gate on the *effective* sensitivity: a recipe can't label a writing tool "read"
  // to slip past the approval prompt — the actions it carries set the real floor.
  const sensitivity = effectiveSensitivity(tool.sensitivity, tool.actions);
  const isRead = sensitivity === "read";
  return {
    name: tool.name,
    title: tool.title ?? `${recipe.name}: ${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema ?? { type: "object", properties: {}, required: [] },
    annotations: {
      readOnlyHint: isRead,
      untrustedContentHint: tool.actions.some((a) => a.kind === "read"),
    },
    execute: (input, options) =>
      invoke(tool.name, sensitivity, parseInput(input), signalOf(options), (inp, sig) =>
        // The ISOLATED world strips `js` actions from remote recipes, so anything
        // that still carries one here came from the bundled first-party set.
        runRecipeTool(tool, inp, sig, { allowJs: true }),
      ),
  };
}

async function registerGeneric(): Promise<void> {
  for (const def of GENERIC_TOOLS) {
    await register(
      genericToTool(def),
      {
        name: def.name,
        title: def.title,
        description: def.description,
        source: "generic",
        sensitivity: def.sensitivity,
        inputSchema: def.inputSchema,
      },
      def.sensitivity,
    );
  }
}

function announce(): void {
  postToIsolated({ type: "tools-registered", tools: Array.from(state.registered.values()).map((r) => r.summary) });
}

/** (Re)register recipe tools that match the current URL; unregister ones that no longer do. */
async function syncRecipeTools(): Promise<void> {
  if (!state.mc) return;
  const url = location.href;
  const wanted = new Map<string, { recipe: Recipe; tool: RecipeTool }>();
  const generic = new Set<string>(GENERIC_TOOL_NAMES);
  for (const recipe of state.recipes) {
    if (!Array.isArray(recipe.matches) || !recipe.matches.some((p) => matchesPattern(p, url))) continue;
    for (const tool of recipe.tools ?? []) {
      if (generic.has(tool.name)) {
        warn(`recipe "${recipe.id}" tool "${tool.name}" collides with a generic tool; skipped`);
        continue;
      }
      if (wanted.has(tool.name)) {
        warn(`duplicate recipe tool name "${tool.name}" (recipe ${recipe.id}); first one wins`);
        continue;
      }
      wanted.set(tool.name, { recipe, tool });
    }
  }

  let changed = false;
  for (const [name, r] of Array.from(state.registered.entries())) {
    if (r.summary.source !== "recipe") continue;
    const w = wanted.get(name);
    if (!w || w.recipe.id !== r.summary.recipeId || w.recipe.version !== r.recipeVersion) {
      await unregister(name);
      changed = true;
    }
  }
  for (const [name, { recipe, tool }] of wanted) {
    if (state.registered.has(name)) continue;
    await register(
      recipeToTool(recipe, tool),
      {
        name,
        title: tool.title,
        description: tool.description,
        source: "recipe",
        recipeId: recipe.id,
        sensitivity: tool.sensitivity,
        inputSchema: tool.inputSchema,
      },
      effectiveSensitivity(tool.sensitivity, tool.actions),
      recipe.version,
    );
    changed = true;
  }
  if (changed) {
    const recipeCount = Array.from(state.registered.values()).filter((r) => r.summary.source === "recipe").length;
    log(`recipe tools on ${location.host}: ${recipeCount}`);
  }
  announce();
}

// ---------------------------------------------------------------------------
// SPA navigation detection
// ---------------------------------------------------------------------------

function onUrlMaybeChanged(): void {
  if (location.href === state.lastUrl) return;
  state.lastUrl = location.href;
  log("url changed ->", location.href);
  postToIsolated({ type: "ready", url: location.href, hasModelContext: true });
  void syncRecipeTools();
}

function installNavigationHooks(): void {
  const wrap = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const ret = original.apply(this, args);
      queueMicrotask(onUrlMaybeChanged);
      return ret;
    } as typeof original;
  };
  try {
    wrap("pushState");
    wrap("replaceState");
  } catch (err) {
    warn("could not patch history:", err);
  }
  window.addEventListener("popstate", onUrlMaybeChanged);
  window.addEventListener("hashchange", onUrlMaybeChanged);

  // Some SPAs mutate the DOM heavily and change the URL through other means.
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      onUrlMaybeChanged();
    }, 500);
  });
  const start = () => observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

// ---------------------------------------------------------------------------
// Messages from the ISOLATED world
// ---------------------------------------------------------------------------

function installMessageHandlers(): void {
  onIsolatedMessage((msg) => {
    switch (msg.type) {
      case "recipes":
        state.recipes = Array.isArray(msg.recipes) ? msg.recipes : [];
        void syncRecipeTools();
        break;
      case "settings":
        state.settings = { ...DEFAULT_SETTINGS, ...msg.settings };
        // The ISOLATED side may have loaded after us; re-announce so its badge is complete.
        postToIsolated({ type: "ready", url: location.href, hasModelContext: !!state.mc });
        announce();
        break;
      case "approval-response":
        state.pendingApprovals.get(msg.callId)?.(!!msg.approved);
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Remote control: run a registered tool on demand for a remote caller.
// ---------------------------------------------------------------------------

function installRemoteRunHandler(): void {
  onRunTool(async (msg) => {
    const reg = state.registered.get(msg.tool);
    if (!reg) {
      postRunResult({ callId: msg.callId, ok: false, error: `tool "${msg.tool}" is not registered on this page` });
      return;
    }
    // Enforce the safety floor here too: sensitive tools never run over remote control.
    if (reg.sensitivity === "sensitive") {
      postRunResult({ callId: msg.callId, ok: false, error: "blocked: sensitive" });
      return;
    }
    try {
      // execute() is the same invoke()-wrapped pipeline the agent path uses, so the
      // call logs to the badge and returns a string result.
      const result = await reg.tool.execute(parseInput(msg.input), { signal: signalOf(undefined) });
      postRunResult({ callId: msg.callId, ok: true, result: typeof result === "string" ? result : String(result) });
    } catch (err) {
      postRunResult({ callId: msg.callId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (window !== window.top) return; // top frame only
  installMessageHandlers();
  installRemoteRunHandler();

  const mc = await waitForModelContext();
  if (!mc) {
    postToIsolated({ type: "ready", url: location.href, hasModelContext: false });
    log(
      "document.modelContext is not available on this page. Enable chrome://flags/#enable-webmcp-testing (Chrome 149+) or use a WebMCP-capable browser such as the ChatGPT desktop app.",
    );
    return;
  }
  state.mc = mc;
  postToIsolated({ type: "ready", url: location.href, hasModelContext: true });

  try {
    // Fires once per (un)registration, so keep it out of the console by default.
    mc.addEventListener("toolchange", () => {});
  } catch {
    /* optional */
  }

  await registerGeneric();
  installNavigationHooks();
  await syncRecipeTools();
  log(`registered ${state.registered.size} tools on ${location.host}`);
}

main().catch((err) => warn("fatal:", err));
