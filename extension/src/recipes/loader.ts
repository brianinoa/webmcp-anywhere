/**
 * Recipe loading: URL matching, structural validation, and conversion of a
 * RecipeTool into a WebMCP ModelContextTool descriptor.
 */
import {
  GENERIC_TOOL_NAMES,
  matchesPattern,
  type JSONSchema,
  type ModelContextTool,
  type Recipe,
  type RecipeTool,
  type Sensitivity,
} from "@webmcp-anywhere/shared";

export const TOOL_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const SENSITIVITIES: Sensitivity[] = ["read", "write", "sensitive"];
const ACTION_KINDS = ["click", "type", "select", "scroll", "navigate", "wait", "read", "media", "js"] as const;
const MEDIA_OPS = ["play", "pause", "toggle", "seek", "rate", "volume", "mute", "state"] as const;

/** Recipes whose `matches` patterns include `url`. */
export function recipesForUrl(recipes: Recipe[], url: string): Recipe[] {
  return recipes.filter((r) => Array.isArray(r.matches) && r.matches.some((p) => typeof p === "string" && matchesPattern(p, url)));
}

/** Every tool from every matching recipe. Later recipes win on name collisions (user recipes should be listed after first-party). */
export function toolsForUrl(recipes: Recipe[], url: string): Array<{ recipe: Recipe; tool: RecipeTool }> {
  const byName = new Map<string, { recipe: Recipe; tool: RecipeTool }>();
  for (const recipe of recipesForUrl(recipes, url)) {
    for (const tool of recipe.tools) byName.set(tool.name, { recipe, tool });
  }
  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidateResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumOrTemplate = (v: unknown): boolean => isNum(v) || (isStr(v) && /\{\{\s*[A-Za-z0-9_.$-]+\s*\}\}/.test(v));

function validateSchema(schema: unknown, path: string, errors: string[]): void {
  if (!isObj(schema)) { errors.push(`${path}: inputSchema must be an object`); return; }
  if (schema.type !== undefined && schema.type !== "object") errors.push(`${path}: inputSchema.type must be "object"`);
  if (schema.properties !== undefined && !isObj(schema.properties)) errors.push(`${path}: inputSchema.properties must be an object`);
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every(isStr)) errors.push(`${path}: inputSchema.required must be a string array`);
    else if (isObj(schema.properties)) {
      for (const r of schema.required) if (!(r in schema.properties)) errors.push(`${path}: required param "${r}" is not in properties`);
    }
  }
  if (isObj(schema.properties)) {
    for (const [k, p] of Object.entries(schema.properties)) {
      if (!isObj(p)) errors.push(`${path}: property "${k}" must be a schema object`);
      else if (p.type !== undefined && !isStr(p.type)) errors.push(`${path}: property "${k}".type must be a string`);
    }
  }
}

function validateAction(a: unknown, path: string, errors: string[]): void {
  if (!isObj(a)) { errors.push(`${path}: action must be an object`); return; }
  const kind = a.kind;
  if (!isStr(kind) || !(ACTION_KINDS as readonly string[]).includes(kind)) {
    errors.push(`${path}: unknown action kind ${JSON.stringify(kind)}; expected one of ${ACTION_KINDS.join(", ")}`);
    return;
  }
  const needSel = () => { if (!isNonEmptyStr(a.selector)) errors.push(`${path}: ${kind} requires a non-empty "selector"`); };
  const optSel = () => { if (a.selector !== undefined && !isNonEmptyStr(a.selector)) errors.push(`${path}: "selector" must be a non-empty string`); };
  switch (kind) {
    case "click":
      needSel();
      break;
    case "type":
      needSel();
      if (!isStr(a.value)) errors.push(`${path}: type requires a string "value"`);
      if (a.submit !== undefined && typeof a.submit !== "boolean") errors.push(`${path}: "submit" must be boolean`);
      break;
    case "select":
      needSel();
      if (!isStr(a.value)) errors.push(`${path}: select requires a string "value"`);
      break;
    case "scroll":
      optSel();
      if (a.to !== undefined && a.to !== "top" && a.to !== "bottom") errors.push(`${path}: scroll "to" must be "top" or "bottom"`);
      if (a.selector === undefined && a.to === undefined) errors.push(`${path}: scroll needs "selector" or "to"`);
      break;
    case "navigate":
      if (!isNonEmptyStr(a.url)) errors.push(`${path}: navigate requires a "url"`);
      else if (/^\s*(javascript|data|vbscript):/i.test(a.url)) errors.push(`${path}: navigate url scheme not allowed`);
      break;
    case "wait":
      optSel();
      if (a.ms !== undefined && (!isNum(a.ms) || a.ms < 0 || a.ms > 10_000)) errors.push(`${path}: wait "ms" must be a number between 0 and 10000`);
      if (a.ms === undefined && a.selector === undefined) errors.push(`${path}: wait needs "ms" and/or "selector"`);
      break;
    case "read":
      needSel();
      if (a.attribute !== undefined && !isNonEmptyStr(a.attribute)) errors.push(`${path}: "attribute" must be a non-empty string`);
      if (a.all !== undefined && typeof a.all !== "boolean") errors.push(`${path}: "all" must be boolean`);
      if (a.as !== undefined && (!isNonEmptyStr(a.as) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(a.as) || a.as === "ok" || a.as === "did" || a.as === "tool")) {
        errors.push(`${path}: "as" must be an identifier and not one of ok/did/tool`);
      }
      if (a.following !== undefined && (!isNum(a.following) || a.following < 1 || a.following > 50)) errors.push(`${path}: "following" must be a number 1..50`);
      if (a.limit !== undefined && !isNumOrTemplate(a.limit)) errors.push(`${path}: "limit" must be a number or {{template}}`);
      break;
    case "media":
      optSel();
      if (!isStr(a.op) || !(MEDIA_OPS as readonly string[]).includes(a.op)) errors.push(`${path}: media "op" must be one of ${MEDIA_OPS.join(", ")}`);
      if (a.value !== undefined && !isNumOrTemplate(a.value)) errors.push(`${path}: media "value" must be a number or {{template}}`);
      if ((a.op === "seek" || a.op === "rate" || a.op === "volume") && a.value === undefined) errors.push(`${path}: media ${String(a.op)} requires "value"`);
      if (a.relative !== undefined && typeof a.relative !== "boolean") errors.push(`${path}: "relative" must be boolean`);
      break;
    case "js":
      if (!isStr(a.fn)) errors.push(`${path}: js requires "fn" string`);
      break;
  }
}

/**
 * Structural validation of an untrusted recipe object (no external deps).
 *
 * `allowMissingId` permits a draft recipe with no `id` (the worker assigns one on
 * POST). It defaults to false so the remote-recipe hardening path — which always
 * receives recipes that already carry a server id — keeps rejecting id-less input.
 */
export function validateRecipe(r: unknown, opts: { allowMissingId?: boolean } = {}): ValidateResult {
  const errors: string[] = [];
  if (!isObj(r)) return { ok: false, errors: ["recipe must be an object"] };

  if (r.id === undefined && opts.allowMissingId) {
    // draft recipe: id is intentionally absent and will be assigned by the server.
  } else if (!isNonEmptyStr(r.id)) {
    errors.push("id must be a non-empty string");
  }
  if (!isNonEmptyStr(r.name)) errors.push("name must be a non-empty string");
  if (!isStr(r.description)) errors.push("description must be a string");
  if (!isNum(r.version)) errors.push("version must be a number");
  if (!Array.isArray(r.matches) || r.matches.length === 0 || !r.matches.every(isNonEmptyStr)) {
    errors.push("matches must be a non-empty array of match patterns");
  } else {
    for (const p of r.matches) {
      if (p !== "<all_urls>" && !/^(\*|https?|file|ftp):\/\/(\*|\*\.[^/*]+|[^/*]+)?\/.*$/.test(p)) errors.push(`matches: invalid pattern "${p}"`);
    }
  }
  if (r.author !== undefined && !isStr(r.author)) errors.push("author must be a string");
  for (const k of ["createdAt", "updatedAt"]) if (r[k] !== undefined && !isStr(r[k])) errors.push(`${k} must be an ISO string`);

  if (!Array.isArray(r.tools)) {
    errors.push("tools must be an array");
  } else {
    const seen = new Set<string>();
    r.tools.forEach((t, i) => {
      const path = `tools[${i}]`;
      if (!isObj(t)) { errors.push(`${path}: must be an object`); return; }
      const name = t.name;
      if (!isStr(name) || !TOOL_NAME_RE.test(name)) {
        errors.push(`${path}: name must match ${TOOL_NAME_RE}`);
      } else {
        if ((GENERIC_TOOL_NAMES as readonly string[]).includes(name)) errors.push(`${path}: name "${name}" collides with a generic tool`);
        if (seen.has(name)) errors.push(`${path}: duplicate tool name "${name}"`);
        seen.add(name);
      }
      if (t.title !== undefined && !isStr(t.title)) errors.push(`${path}: title must be a string`);
      if (!isNonEmptyStr(t.description)) errors.push(`${path}: description must be a non-empty string`);
      if (!isStr(t.sensitivity) || !SENSITIVITIES.includes(t.sensitivity as Sensitivity)) {
        errors.push(`${path}: sensitivity must be one of ${SENSITIVITIES.join(", ")}`);
      }
      if (t.inputSchema !== undefined) validateSchema(t.inputSchema, path, errors);
      if (!Array.isArray(t.actions) || t.actions.length === 0) {
        errors.push(`${path}: actions must be a non-empty array`);
      } else {
        t.actions.forEach((a, j) => validateAction(a, `${path}.actions[${j}]`, errors));
      }
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, recipe: r as unknown as Recipe };
}

// ---------------------------------------------------------------------------
// WebMCP descriptor
// ---------------------------------------------------------------------------

/**
 * Build the `document.modelContext.registerTool` descriptor for one recipe tool.
 * Names are kept exactly as authored (they are global per page).
 */
export function toModelContextTool(
  recipe: Recipe,
  tool: RecipeTool,
  run: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<string>,
): ModelContextTool {
  const hasRead = tool.actions.some((a) => a.kind === "read" || a.kind === "media" || a.kind === "js");
  const inputSchema: JSONSchema = tool.inputSchema
    ? { type: "object", ...tool.inputSchema }
    : { type: "object", properties: {}, additionalProperties: false };
  return {
    name: tool.name,
    title: tool.title ?? tool.name,
    description: tool.description,
    inputSchema,
    annotations: {
      readOnlyHint: tool.sensitivity === "read",
      untrustedContentHint: hasRead,
    },
    execute: (input, options) => run((input ?? {}) as Record<string, unknown>, options),
  };
}
