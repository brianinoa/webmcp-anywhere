import type { Recipe, RecipeAction, RecipeTool } from "@webmcp-anywhere/shared";

export const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const SENSITIVITIES = new Set(["read", "write", "sensitive"]);
const ACTION_KINDS = new Set(["click", "type", "select", "scroll", "navigate", "wait", "read", "media", "js"]);
const MEDIA_OPS = new Set(["play", "pause", "toggle", "seek", "rate", "volume", "mute", "state"]);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validateAction(a: unknown, path: string, errors: string[]): void {
  if (!isObj(a)) return void errors.push(`${path}: must be an object`);
  const kind = a.kind;
  if (!isStr(kind) || !ACTION_KINDS.has(kind)) return void errors.push(`${path}.kind: must be one of ${[...ACTION_KINDS].join(", ")}`);
  const needStr = (k: string) => {
    if (!isStr(a[k]) || !(a[k] as string).length) errors.push(`${path}.${k}: required string for kind "${kind}"`);
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
      if (!isStr(a.op) || !MEDIA_OPS.has(a.op)) errors.push(`${path}.op: must be one of ${[...MEDIA_OPS].join(", ")}`);
      optNum("value");
      break;
    case "js": needStr("fn"); break;
  }
}

function validateTool(t: unknown, path: string, errors: string[], seen: Set<string>): void {
  if (!isObj(t)) return void errors.push(`${path}: must be an object`);
  if (!isStr(t.name) || !NAME_RE.test(t.name)) errors.push(`${path}.name: must match ${NAME_RE}`);
  else if (seen.has(t.name)) errors.push(`${path}.name: duplicate tool name "${t.name}"`);
  else seen.add(t.name);
  if (t.title !== undefined && !isStr(t.title)) errors.push(`${path}.title: must be a string`);
  if (!isStr(t.description) || !t.description.trim()) errors.push(`${path}.description: required string`);
  if (t.inputSchema !== undefined && !isObj(t.inputSchema)) errors.push(`${path}.inputSchema: must be a JSON Schema object`);
  if (!isStr(t.sensitivity) || !SENSITIVITIES.has(t.sensitivity)) errors.push(`${path}.sensitivity: must be "read", "write" or "sensitive"`);
  if (!Array.isArray(t.actions)) errors.push(`${path}.actions: must be an array`);
  else t.actions.forEach((a, i) => validateAction(a, `${path}.actions[${i}]`, errors));
}

/** Structural validation of a Recipe. `requireId` for PUT bodies. */
export function validateRecipe(r: unknown, opts: { requireId?: boolean } = {}): ValidationResult {
  const errors: string[] = [];
  if (!isObj(r)) return { ok: false, errors: ["recipe: must be a JSON object"] };
  if (r.id !== undefined || opts.requireId) {
    if (!isStr(r.id) || !NAME_RE.test(r.id)) errors.push(`id: must match ${NAME_RE}`);
  }
  if (!isStr(r.name) || !r.name.trim() || r.name.length > 128) errors.push("name: required string (max 128 chars)");
  if (!isStr(r.description)) errors.push("description: required string");
  if (r.version !== undefined && !(typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 0)) errors.push("version: must be a non-negative integer");
  if (!Array.isArray(r.matches) || r.matches.length === 0) errors.push("matches: must be a non-empty array of match patterns");
  else r.matches.forEach((m, i) => {
    if (!isStr(m) || !/^(<all_urls>|(\*|https?|file|ftp):\/\/[^/]*\/.*)$/.test(m)) errors.push(`matches[${i}]: invalid match pattern "${String(m)}"`);
  });
  if (r.author !== undefined && !isStr(r.author)) errors.push("author: must be a string");
  if (!Array.isArray(r.tools) || r.tools.length === 0) errors.push("tools: must be a non-empty array");
  else {
    const seen = new Set<string>();
    r.tools.forEach((t, i) => validateTool(t, `tools[${i}]`, errors, seen));
  }
  return { ok: errors.length === 0, errors };
}

/** Pick only the known Recipe fields (drops junk) and apply defaults. */
export function normalizeRecipe(r: Record<string, unknown>): Recipe {
  return {
    id: r.id as string,
    name: (r.name as string).trim(),
    description: r.description as string,
    version: typeof r.version === "number" ? r.version : 1,
    matches: r.matches as string[],
    ...(isStr(r.author) ? { author: r.author } : {}),
    tools: (r.tools as RecipeTool[]).map((t) => ({
      name: t.name,
      ...(t.title !== undefined ? { title: t.title } : {}),
      description: t.description,
      ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
      sensitivity: t.sensitivity,
      actions: t.actions,
    })),
    ...(isStr(r.createdAt) ? { createdAt: r.createdAt } : {}),
    ...(isStr(r.updatedAt) ? { updatedAt: r.updatedAt } : {}),
  };
}

export function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return s || "recipe";
}

export function shortId(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
