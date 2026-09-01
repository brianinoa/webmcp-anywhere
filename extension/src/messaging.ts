/**
 * Small helpers shared by the MAIN-world script and the ISOLATED content
 * script. Both sides talk over window.postMessage using the envelopes from
 * @webmcp-anywhere/shared; the `ns` field keeps us from confusing page traffic.
 */
import { MSG_NAMESPACE, type IsolatedToMain, type MainToIsolated } from "@webmcp-anywhere/shared";

export const LOG_PREFIX = "[WebMCP Anywhere]";

export const log = (...args: unknown[]) => console.log(LOG_PREFIX, ...args);
export const warn = (...args: unknown[]) => console.warn(LOG_PREFIX, ...args);

const MAIN_TYPES = new Set<MainToIsolated["type"]>([
  "ready",
  "tools-registered",
  "tool-call",
  "tool-result",
  "approval-request",
]);
const ISOLATED_TYPES = new Set<IsolatedToMain["type"]>(["recipes", "approval-response", "settings"]);

/** Omit that distributes over union members (plain Omit collapses discriminated unions). */
export type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export function postToIsolated(msg: DistributiveOmit<MainToIsolated, "ns">): void {
  window.postMessage({ ns: MSG_NAMESPACE, ...msg }, "*");
}

export function postToMain(msg: DistributiveOmit<IsolatedToMain, "ns">): void {
  window.postMessage({ ns: MSG_NAMESPACE, ...msg }, "*");
}

function isEnvelope(data: unknown): data is { ns: string; type: string } {
  return !!data && typeof data === "object" && (data as { ns?: unknown }).ns === MSG_NAMESPACE;
}

/** Listen (in the ISOLATED world) for messages posted by the MAIN world. */
export function onMainMessage(handler: (msg: MainToIsolated) => void): () => void {
  const listener = (ev: MessageEvent) => {
    if (ev.source !== window || !isEnvelope(ev.data)) return;
    if (!MAIN_TYPES.has(ev.data.type as MainToIsolated["type"])) return;
    handler(ev.data as MainToIsolated);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Listen (in the MAIN world) for messages posted by the ISOLATED world. */
export function onIsolatedMessage(handler: (msg: IsolatedToMain) => void): () => void {
  const listener = (ev: MessageEvent) => {
    if (ev.source !== window || !isEnvelope(ev.data)) return;
    if (!ISOLATED_TYPES.has(ev.data.type as IsolatedToMain["type"])) return;
    handler(ev.data as IsolatedToMain);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

// ---------------------------------------------------------------------------
// Remote-control run channel (ISOLATED <-> MAIN), extension-local envelopes.
// Kept out of the shared MainToIsolated/IsolatedToMain unions on purpose: these
// never leave the extension and shouldn't widen the cross-package contract.
// ---------------------------------------------------------------------------

/** ISOLATED -> MAIN: run a registered tool by name for a remote caller. */
export interface RunToolMsg {
  ns: typeof MSG_NAMESPACE;
  type: "run-tool";
  callId: string;
  tool: string;
  input: Record<string, unknown>;
}

/** MAIN -> ISOLATED: the result of a `run-tool`. */
export interface RunResultMsg {
  ns: typeof MSG_NAMESPACE;
  type: "run-result";
  callId: string;
  ok: boolean;
  result?: string;
  error?: string;
}

export function postRunTool(msg: Omit<RunToolMsg, "ns" | "type">): void {
  window.postMessage({ ns: MSG_NAMESPACE, type: "run-tool", ...msg } satisfies RunToolMsg, "*");
}

export function postRunResult(msg: Omit<RunResultMsg, "ns" | "type">): void {
  window.postMessage({ ns: MSG_NAMESPACE, type: "run-result", ...msg } satisfies RunResultMsg, "*");
}

/** Listen (in the MAIN world) for `run-tool` requests posted by the ISOLATED world. */
export function onRunTool(handler: (msg: RunToolMsg) => void): () => void {
  const listener = (ev: MessageEvent) => {
    if (ev.source !== window || !isEnvelope(ev.data) || ev.data.type !== "run-tool") return;
    handler(ev.data as unknown as RunToolMsg);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/** Listen (in the ISOLATED world) for `run-result` replies posted by the MAIN world. */
export function onRunResult(handler: (msg: RunResultMsg) => void): () => void {
  const listener = (ev: MessageEvent) => {
    if (ev.source !== window || !isEnvelope(ev.data) || ev.data.type !== "run-result") return;
    handler(ev.data as unknown as RunResultMsg);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

let counter = 0;
export function newCallId(): string {
  counter += 1;
  return `c${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Truncate any value to a short, log-friendly string. */
export function summarize(value: unknown, max = 160): string {
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  }
  if (s === undefined) s = "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// ISOLATED <-> background (chrome.runtime) messages. Same MainToIsolated
// payloads flow up to the background; these extra ones are extension-internal.
// ---------------------------------------------------------------------------

import type { ExtensionSettings, Recipe, ToolSummary } from "@webmcp-anywhere/shared";

export interface CallLogEntry {
  callId: string;
  tool: string;
  input: unknown;
  sensitivity: string;
  startedAt: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface TabState {
  tabId: number;
  url: string;
  hasModelContext: boolean;
  tools: ToolSummary[];
  log: CallLogEntry[];
  updatedAt: number;
}

export type RuntimeRequest =
  | { ns: typeof MSG_NAMESPACE; type: "page-event"; event: MainToIsolated }
  | { ns: typeof MSG_NAMESPACE; type: "getState"; tabId?: number }
  | { ns: typeof MSG_NAMESPACE; type: "getSettings" }
  | { ns: typeof MSG_NAMESPACE; type: "sync-recipes"; force?: boolean }
  | { ns: typeof MSG_NAMESPACE; type: "save-recipe"; recipe: Recipe }
  // Remote control (popup <-> background):
  | { ns: typeof MSG_NAMESPACE; type: "arm-remote"; tabId: number }
  | { ns: typeof MSG_NAMESPACE; type: "disarm-remote" }
  | { ns: typeof MSG_NAMESPACE; type: "remote-status" }
  // Internal (content -> background): result of a remotely-triggered tool run.
  | { ns: typeof MSG_NAMESPACE; type: "remote-run-result"; callId: string; ok: boolean; result?: string; error?: string };

/** Result of a "save-recipe" request: the saved recipe (with its server-assigned id) or an error. */
export type SavedRecipeResult = { ok: true; recipe: Recipe } | { ok: false; error: string };

/** Result of an "arm-remote" request. */
export type ArmResult = { ok: true; code: string; remoteUrl: string } | { ok: false; error: string };

/** Snapshot of the remote-control state, returned by "remote-status". */
export interface RemoteStatus {
  armed: boolean;
  tabId?: number;
  code?: string;
  remoteUrl?: string;
  /** Whether the target WebSocket is currently connected to the relay. */
  connected?: boolean;
  /** Live peer counts from the relay's last `peers` message. */
  targets?: number;
  remotes?: number;
}

export type RuntimePush =
  | { ns: typeof MSG_NAMESPACE; type: "recipes-updated"; recipes: Recipe[] }
  // Background -> content: run a tool on demand for a remote caller.
  | { ns: typeof MSG_NAMESPACE; type: "remote-run"; callId: string; tool: string; input: Record<string, unknown> };

export interface SyncResult {
  recipes: Recipe[];
  source: "remote" | "cache" | "none";
  error?: string;
  syncedAt?: number;
}

export interface StateResponse {
  state: TabState | null;
  settings: ExtensionSettings;
  lastSync?: { at: number; source: string; count: number; error?: string };
}

export function sendRuntime<T = unknown>(msg: DistributiveOmit<RuntimeRequest, "ns">): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ ns: MSG_NAMESPACE, ...msg }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(resp as T);
      });
    } catch (e) {
      reject(e);
    }
  });
}
