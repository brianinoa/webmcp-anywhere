/**
 * Shared contracts for WebMCP Anywhere.
 *
 * Every package (extension, studio, worker) imports from here so the
 * recipe format, WebMCP typings, and messaging protocol stay in sync.
 * Change these types deliberately — three agents build against them.
 */

// ---------------------------------------------------------------------------
// WebMCP browser API (document.modelContext) — mirrors the spec at
// https://webmachinelearning.github.io/webmcp/ and Chrome's imperative API.
// ---------------------------------------------------------------------------

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

export interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ModelContextTool<Input = Record<string, unknown>> {
  name: string;
  description: string;
  title?: string;
  inputSchema?: JSONSchema;
  annotations?: ModelContextToolAnnotations;
  execute: (input: Input, options: { signal: AbortSignal }) => unknown | Promise<unknown>;
}

export interface RegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

export interface ModelContext extends EventTarget {
  registerTool(tool: ModelContextTool, options?: RegisterToolOptions): Promise<void>;
  unregisterTool?(name: string): Promise<void> | void;
  getTools(options?: { fromOrigins?: string[] }): Promise<ModelContextTool[]>;
  executeTool(tool: ModelContextTool | string, input: string, options?: { signal?: AbortSignal }): Promise<string>;
  provideContext?(ctx: unknown): void;
  clearContext?(): void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    /** Deprecated since Chrome 150; prefer document.modelContext. */
    modelContext?: ModelContext;
  }
}

/** Resolve document.modelContext, polling because Chrome may attach it after content scripts run. */
export async function waitForModelContext(timeoutMs = 5000, intervalMs = 50): Promise<ModelContext | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const mc = document.modelContext ?? navigator.modelContext;
    if (mc) return mc;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recipes — per-site tool bundles authored in Recipe Studio and loaded by the
// extension. A recipe is pure JSON so it can be stored, shared, and reviewed.
// Tool behaviour is expressed as a small list of declarative "actions" that
// the extension executes against the DOM, so recipes never ship arbitrary JS.
// ---------------------------------------------------------------------------

export type Sensitivity = "read" | "write" | "sensitive";

/** One step of a recipe tool. `{{param}}` placeholders are filled from tool input. */
export type RecipeAction =
  | { kind: "click"; selector: string }
  | { kind: "type"; selector: string; value: string; submit?: boolean }
  | { kind: "select"; selector: string; value: string }
  | { kind: "scroll"; selector?: string; to?: "top" | "bottom" }
  | { kind: "navigate"; url: string }
  | { kind: "wait"; ms?: number; selector?: string }
  | {
      kind: "read"; selector: string; attribute?: string; all?: boolean; as?: string;
      /** Read the next N <p> blocks after the match (stops at the next same-level heading). */
      following?: number;
      /** Cap for `all`/`following` results (1..50); a string allows "{{param}}". */
      limit?: number | string;
    }
  | {
      kind: "media"; selector?: string;
      op: "play" | "pause" | "toggle" | "seek" | "rate" | "volume" | "mute" | "state";
      /** A string allows "{{param}}" substitution. */
      value?: number | string;
      /** For `seek`: offset from currentTime instead of absolute seconds. */
      relative?: boolean;
    }
  | { kind: "js"; fn: string };
// Selector strings also accept `base:text=words` and `base:nth=N` pseudo-syntax, and templates accept
// the builtins {{$origin}}, {{$host}}, {{$pathname}}, {{$href}}, {{$repo}} — see recipes/README.md.
// `js` is reserved for first-party bundled recipes only; the extension refuses it for remote recipes.

export interface RecipeTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JSONSchema;
  sensitivity: Sensitivity;
  /** Actions run in order; the last `read` action's result (or a summary of the run) is returned. */
  actions: RecipeAction[];
}

export interface Recipe {
  /** Stable id, e.g. "youtube" or a uuid for user recipes. */
  id: string;
  name: string;
  description: string;
  version: number;
  /** URL match patterns in Chrome match-pattern syntax, e.g. "*://*.youtube.com/*". */
  matches: string[];
  author?: string;
  tools: RecipeTool[];
  createdAt?: string;
  updatedAt?: string;
  /**
   * Response-only: set by the server for protected first-party recipes that cannot be
   * modified or deleted via the API. Never persisted; the studio hides Edit/Delete when true.
   */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Worker HTTP API (studio <-> worker, extension <-> worker)
// ---------------------------------------------------------------------------

export const API_ROUTES = {
  listRecipes: "/api/recipes",            // GET  ?q=&site=
  getRecipe: "/api/recipes/:id",          // GET
  createRecipe: "/api/recipes",           // POST Recipe (without id) -> Recipe
  updateRecipe: "/api/recipes/:id",       // PUT  Recipe
  deleteRecipe: "/api/recipes/:id",       // DELETE
  syncRecipes: "/api/sync",               // GET  ?since=ISO -> { recipes: Recipe[], serverTime }
} as const;

export interface ListRecipesResponse {
  recipes: Recipe[];
}

export interface SyncResponse {
  recipes: Recipe[];
  serverTime: string;
}

// ---------------------------------------------------------------------------
// Extension messaging: MAIN world <-> ISOLATED content script <-> background.
// MAIN <-> ISOLATED uses window.postMessage with these envelopes; ISOLATED <->
// background uses chrome.runtime messaging with the same payloads.
// ---------------------------------------------------------------------------

export const MSG_NAMESPACE = "webmcp-anywhere";

export type MainToIsolated =
  | { ns: typeof MSG_NAMESPACE; type: "ready"; url: string; hasModelContext: boolean }
  | { ns: typeof MSG_NAMESPACE; type: "tools-registered"; tools: ToolSummary[] }
  | { ns: typeof MSG_NAMESPACE; type: "tool-call"; callId: string; tool: string; input: unknown; sensitivity: Sensitivity }
  | { ns: typeof MSG_NAMESPACE; type: "tool-result"; callId: string; ok: boolean; result?: unknown; error?: string; durationMs: number }
  | { ns: typeof MSG_NAMESPACE; type: "approval-request"; callId: string; tool: string; input: unknown };

export type IsolatedToMain =
  | { ns: typeof MSG_NAMESPACE; type: "recipes"; recipes: Recipe[] }
  | { ns: typeof MSG_NAMESPACE; type: "approval-response"; callId: string; approved: boolean }
  | { ns: typeof MSG_NAMESPACE; type: "settings"; settings: ExtensionSettings };

export interface ToolSummary {
  name: string;
  title?: string;
  description: string;
  source: "generic" | "recipe";
  recipeId?: string;
  sensitivity: Sensitivity;
}

export interface ExtensionSettings {
  /** Base URL of the worker, e.g. https://webmcp-anywhere.<you>.workers.dev */
  apiBase: string;
  /** Require click-to-approve for tools with sensitivity "sensitive" (default true). */
  approveSensitive: boolean;
  /** Also approve "write" tools (default false). */
  approveWrites: boolean;
  /** Show the in-page badge (default true). */
  showBadge: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBase: "https://webmcp-anywhere.briandaniloinoa.workers.dev",
  approveSensitive: true,
  approveWrites: false,
  showBadge: true,
};

/** Names of the generic tools the extension registers on every page. Recipes may not reuse these. */
export const GENERIC_TOOL_NAMES = [
  "describe_page",
  "find_text",
  "scroll_to",
  "click",
  "fill_field",
  "select_option",
  "submit_form",
  "navigate",
  "go_back",
] as const;

export type GenericToolName = (typeof GENERIC_TOOL_NAMES)[number];

/** Tool names a recipe may not use — they'd collide with the generic layer. */
export const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set(GENERIC_TOOL_NAMES);

const SENSITIVITY_RANK: Record<Sensitivity, number> = { read: 0, write: 1, sensitive: 2 };

/**
 * The lowest sensitivity an action list actually warrants, regardless of what the
 * author declared. Any state-changing action is at least "write"; submitting a form
 * or navigating away is "sensitive". Used to enforce approval on the *real* effect of
 * a tool so a recipe can't label a writing tool "read" to dodge the approval gate.
 */
export function deriveSensitivity(actions: RecipeAction[]): Sensitivity {
  let rank = 0;
  for (const a of actions) {
    if (a.kind === "read" || a.kind === "wait" || a.kind === "scroll") continue;
    if (a.kind === "media") {
      rank = Math.max(rank, a.op === "state" ? 0 : 1);
      continue;
    }
    if (a.kind === "js" || (a.kind === "type" && a.submit)) {
      // Running script or submitting a form is high-consequence.
      rank = Math.max(rank, SENSITIVITY_RANK.sensitive);
      continue;
    }
    // click, type, select, navigate, and anything else that changes state
    rank = Math.max(rank, SENSITIVITY_RANK.write);
  }
  return (Object.keys(SENSITIVITY_RANK) as Sensitivity[]).find((s) => SENSITIVITY_RANK[s] === rank) ?? "write";
}

/** The stricter of the author's declared sensitivity and what the actions imply. */
export function effectiveSensitivity(declared: Sensitivity, actions: RecipeAction[]): Sensitivity {
  const derived = deriveSensitivity(actions);
  return SENSITIVITY_RANK[derived] > SENSITIVITY_RANK[declared] ? derived : declared;
}

/** Chrome match-pattern test used by both the extension loader and studio previews. */
export function matchesPattern(pattern: string, url: string): boolean {
  if (pattern === "<all_urls>") return /^(https?|file|ftp):/.test(url);
  const m = pattern.match(/^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)?(\/.*)$/);
  if (!m) return false;
  const [, scheme, host = "", path] = m;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const s = u.protocol.replace(":", "");
  if (scheme !== "*" ? s !== scheme : !/^https?$/.test(s)) return false;
  if (host !== "*") {
    if (host.startsWith("*.")) {
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith("." + base)) return false;
    } else if (u.hostname !== host) return false;
  }
  const pathRe = new RegExp("^" + path.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return pathRe.test(u.pathname + u.search);
}
