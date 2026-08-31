/**
 * Client-side recipe validation. Mirrors worker/src/validate.ts so the editor
 * can flag problems before saving. Keep the two in sync.
 */
import { RESERVED_TOOL_NAMES, type Recipe, type RecipeAction, type RecipeTool, type Sensitivity } from "@webmcp-anywhere/shared";

export const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
export const SENSITIVITIES: Sensitivity[] = ["read", "write", "sensitive"];
export const ACTION_KINDS = ["click", "type", "select", "scroll", "navigate", "wait", "read", "media", "js"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const MEDIA_OPS = ["play", "pause", "toggle", "seek", "rate", "volume", "mute", "state"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validateAction(a: unknown, path: string, errors: string[]): void {
  if (!isObj(a)) return void errors.push(`${path}: must be an object`);
  const kind = a.kind;
  if (!isStr(kind) || !(ACTION_KINDS as readonly string[]).includes(kind)) return void errors.push(`${path}.kind: must be one of ${ACTION_KINDS.join(", ")}`);
  const needStr = (k: string) => {
    if (!isStr(a[k]) || !(a[k] as string).length) errors.push(`${path}.${k}: required for "${kind}"`);
  };
  const optStr = (k: string) => {
    if (a[k] !== undefined && !isStr(a[k])) errors.push(`${path}.${k}: must be a string`);
  };
  const optNum = (k: string) => {
    if (a[k] !== undefined && typeof a[k] !== "number" && !(isStr(a[k]) && /\{\{.+\}\}/.test(a[k] as string))) errors.push(`${path}.${k}: must be a number or {{param}}`);
  };
  const optBool = (k: string) => {
    if (a[k] !== undefined && typeof a[k] !== "boolean") errors.push(`${path}.${k}: must be a boolean`);
  };
  switch (kind as RecipeAction["kind"]) {
    case "click": needStr("selector"); break;
    case "type": needStr("selector"); needStr("value"); optBool("submit"); break;
    case "select": needStr("selector"); needStr("value"); break;
    case "scroll":
      optStr("selector");
      if (a.to !== undefined && a.to !== "top" && a.to !== "bottom") errors.push(`${path}.to: must be "top" or "bottom"`);
      break;
    case "navigate": needStr("url"); break;
    case "wait": optNum("ms"); optStr("selector"); break;
    case "read": needStr("selector"); optStr("attribute"); optBool("all"); optStr("as"); break;
    case "media":
      optStr("selector");
      if (!isStr(a.op) || !(MEDIA_OPS as readonly string[]).includes(a.op)) errors.push(`${path}.op: must be one of ${MEDIA_OPS.join(", ")}`);
      optNum("value");
      break;
    case "js": needStr("fn"); break;
  }
}

export function validateTool(t: unknown, path: string, errors: string[], seen = new Set<string>()): void {
  if (!isObj(t)) return void errors.push(`${path}: must be an object`);
  if (!isStr(t.name) || !NAME_RE.test(t.name)) errors.push(`${path}.name: letters, digits, _ . - only (1-128 chars)`);
  else if (RESERVED_TOOL_NAMES.has(t.name)) errors.push(`${path}.name: "${t.name}" is a reserved generic tool name`);
  else if (seen.has(t.name)) errors.push(`${path}.name: duplicate tool name "${t.name}"`);
  else seen.add(t.name);
  if (t.title !== undefined && !isStr(t.title)) errors.push(`${path}.title: must be a string`);
  if (!isStr(t.description) || !t.description.trim()) errors.push(`${path}.description: required`);
  if (t.inputSchema !== undefined && !isObj(t.inputSchema)) errors.push(`${path}.inputSchema: must be a JSON Schema object`);
  if (!isStr(t.sensitivity) || !(SENSITIVITIES as string[]).includes(t.sensitivity)) errors.push(`${path}.sensitivity: must be read, write or sensitive`);
  if (!Array.isArray(t.actions)) errors.push(`${path}.actions: must be an array`);
  else t.actions.forEach((a, i) => validateAction(a, `${path}.actions[${i}]`, errors));
}

export function validateRecipe(r: unknown, opts: { requireId?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (!isObj(r)) return ["recipe: must be a JSON object"];
  if (r.id !== undefined || opts.requireId) {
    if (!isStr(r.id) || !NAME_RE.test(r.id)) errors.push("id: letters, digits, _ . - only");
  }
  if (!isStr(r.name) || !r.name.trim() || r.name.length > 128) errors.push("name: required (max 128 chars)");
  if (!isStr(r.description)) errors.push("description: required");
  if (r.version !== undefined && !(typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 0)) errors.push("version: must be a non-negative integer");
  if (!Array.isArray(r.matches) || r.matches.length === 0) errors.push("matches: add at least one match pattern");
  else r.matches.forEach((m, i) => {
    if (!isStr(m) || !isMatchPattern(m)) errors.push(`matches[${i}]: invalid pattern "${String(m)}" (e.g. *://*.example.com/*)`);
  });
  if (r.author !== undefined && !isStr(r.author)) errors.push("author: must be a string");
  if (!Array.isArray(r.tools) || r.tools.length === 0) errors.push("tools: add at least one tool");
  else {
    const seen = new Set<string>();
    r.tools.forEach((t, i) => validateTool(t, `tools[${i}]`, errors, seen));
  }
  return errors;
}

export function isMatchPattern(m: string): boolean {
  return /^(<all_urls>|(\*|https?|file|ftp):\/\/[^/]*\/.*)$/.test(m);
}

/** Blank recipe used by the "new recipe" editor. */
export function emptyRecipe(): Recipe {
  return { id: "", name: "", description: "", version: 1, matches: [], tools: [emptyTool()] };
}

export function emptyTool(): RecipeTool {
  return {
    name: "",
    title: "",
    description: "",
    inputSchema: { type: "object", properties: {}, required: [] },
    sensitivity: "read",
    actions: [],
  };
}

export function emptyAction(kind: ActionKind): RecipeAction {
  switch (kind) {
    case "click": return { kind, selector: "" };
    case "type": return { kind, selector: "", value: "{{query}}", submit: false };
    case "select": return { kind, selector: "", value: "" };
    case "scroll": return { kind, to: "bottom" };
    case "navigate": return { kind, url: "" };
    case "wait": return { kind, ms: 500 };
    case "read": return { kind, selector: "", all: false };
    case "media": return { kind, op: "toggle" };
    case "js": return { kind, fn: "" };
  }
}
