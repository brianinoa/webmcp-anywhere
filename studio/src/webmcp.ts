/**
 * WebMCP tools registered by Recipe Studio itself (document.modelContext).
 * The studio is a WebMCP site: an agent driving the browser can search, read,
 * author, and delete recipes through these tools while the human watches.
 *
 * Tool names are stable; registration happens once per page load.
 */
import { waitForModelContext, type ModelContext, type ModelContextTool, type Recipe, type RecipeTool } from "@webmcp-anywhere/shared";
import { api, ApiError, notifyRecipesChanged } from "./api";
import { RECIPE_FORMAT_REFERENCE } from "./format";
import { validateRecipe, validateTool } from "./validate";

export type WebMCPStatus = "pending" | "native" | "unavailable";

/** Injected by the app so tools can drive client-side routing. */
let navigateFn: (path: string) => void = (path) => {
  window.location.assign(path);
};
export function setNavigator(fn: (path: string) => void): void {
  navigateFn = fn;
}

const listeners = new Set<(s: WebMCPStatus) => void>();
let status: WebMCPStatus = "pending";
let modelContext: ModelContext | null = null;
let registered: Promise<void> | null = null;

export function getWebMCPStatus(): WebMCPStatus {
  return status;
}
export function onWebMCPStatus(fn: (s: WebMCPStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}
function setStatus(s: WebMCPStatus): void {
  status = s;
  listeners.forEach((fn) => fn(s));
}

/** Tools currently registered on this page, per the browser (empty if WebMCP is unavailable). */
export async function listRegisteredTools(): Promise<ModelContextTool[]> {
  if (!modelContext) return [];
  try {
    return await modelContext.getTools();
  } catch {
    return STUDIO_TOOLS;
  }
}

const compact = (v: unknown): string => JSON.stringify(v);

function summarize(r: Recipe) {
  return { id: r.id, name: r.name, description: r.description, matches: r.matches, tools: r.tools.map((t) => t.name) };
}

function errorResult(err: unknown): string {
  if (err instanceof ApiError) return compact({ ok: false, error: err.message, errors: err.errors });
  return compact({ ok: false, error: err instanceof Error ? err.message : String(err) });
}

export const STUDIO_TOOLS: ModelContextTool[] = [
  {
    name: "search_recipes",
    title: "Search recipes",
    description:
      "Search the WebMCP Anywhere recipe library. Use `query` for free-text search over recipe names, descriptions, and tool names, and/or `site` (a URL such as https://www.youtube.com/watch?v=x) to find recipes whose match patterns apply to that page. Returns a compact list of {id, name, description, matches, tools}.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search terms (optional)." },
        site: { type: "string", description: "A URL to match against recipe match patterns (optional)." },
      },
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      try {
        const recipes = await api.list({ q: input.query as string | undefined, site: input.site as string | undefined });
        return compact({ count: recipes.length, recipes: recipes.map(summarize) });
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "get_recipe",
    title: "Get recipe",
    description: "Fetch the full JSON of one recipe by id, including every tool's inputSchema, sensitivity, and actions.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Recipe id, e.g. \"youtube\"." } }, required: ["id"] },
    annotations: { readOnlyHint: true },
    async execute(input) {
      try {
        return compact(await api.get(String(input.id)));
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "create_recipe",
    title: "Create recipe",
    description:
      "Create a new recipe from a full Recipe JSON object (call explain_recipe_format first if unsure of the shape). `id` is optional; the server assigns one from the name. Returns {ok, id} or {ok:false, errors:[...]} with precise validation messages.",
    inputSchema: {
      type: "object",
      properties: {
        recipe: {
          type: "object",
          description: "Recipe object: {name, description, version?, matches: string[], author?, tools: RecipeTool[]}.",
        },
      },
      required: ["recipe"],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      const recipe = typeof input.recipe === "string" ? safeParse(input.recipe) : input.recipe;
      const errors = validateRecipe(recipe);
      if (errors.length) return compact({ ok: false, errors });
      try {
        const created = await api.create(recipe as Recipe);
        notifyRecipesChanged();
        return compact({ ok: true, id: created.id, name: created.name, tools: created.tools.map((t) => t.name) });
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "add_tool_to_recipe",
    title: "Add tool to recipe",
    description:
      "Append one tool to an existing recipe. `tool` is a RecipeTool object: {name, title?, description, inputSchema?, sensitivity: read|write|sensitive, actions: RecipeAction[]}. Returns the updated tool list or validation errors.",
    inputSchema: {
      type: "object",
      properties: {
        recipeId: { type: "string", description: "Id of the recipe to modify." },
        tool: { type: "object", description: "The RecipeTool to add." },
      },
      required: ["recipeId", "tool"],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      const tool = (typeof input.tool === "string" ? safeParse(input.tool) : input.tool) as RecipeTool;
      try {
        const recipe = await api.get(String(input.recipeId));
        const errors: string[] = [];
        validateTool(tool, "tool", errors, new Set(recipe.tools.map((t) => t.name)));
        if (errors.length) return compact({ ok: false, errors });
        const updated = await api.update(recipe.id, { ...recipe, tools: [...recipe.tools, tool] });
        notifyRecipesChanged();
        return compact({ ok: true, id: updated.id, version: updated.version, tools: updated.tools.map((t) => t.name) });
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "update_recipe",
    title: "Update recipe",
    description:
      "Update an existing recipe by shallow-merging `patch` into it (top-level fields: name, description, matches, author, tools, version). To replace the tools array, pass the full new array in patch.tools. Returns the saved summary or validation errors.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Recipe id." },
        patch: { type: "object", description: "Partial Recipe object with the fields to change." },
      },
      required: ["id", "patch"],
    },
    annotations: { readOnlyHint: false },
    async execute(input) {
      const patch = (typeof input.patch === "string" ? safeParse(input.patch) : input.patch) as Partial<Recipe>;
      try {
        const recipe = await api.get(String(input.id));
        const merged: Recipe = { ...recipe, ...patch, id: recipe.id };
        const errors = validateRecipe(merged, { requireId: true });
        if (errors.length) return compact({ ok: false, errors });
        const updated = await api.update(recipe.id, merged);
        notifyRecipesChanged();
        return compact({ ok: true, ...summarize(updated), version: updated.version });
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "delete_recipe",
    title: "Delete recipe",
    description: "Permanently delete a recipe by id. This cannot be undone; confirm with the user before calling. Returns a confirmation string.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Recipe id to delete." } }, required: ["id"] },
    annotations: { readOnlyHint: false },
    async execute(input) {
      const id = String(input.id);
      try {
        await api.delete(id);
        notifyRecipesChanged();
        if (window.location.pathname.startsWith(`/recipes/${encodeURIComponent(id)}`)) navigateFn("/");
        return `Deleted recipe "${id}".`;
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "open_recipe",
    title: "Open recipe in Studio",
    description: "Navigate the Recipe Studio UI to a recipe's detail page so the human can see what you are looking at. Pass id \"new\" to open the blank editor.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Recipe id, or \"new\"." } }, required: ["id"] },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const id = String(input.id);
      if (id === "new") {
        navigateFn("/recipes/new");
        return compact({ ok: true, path: "/recipes/new" });
      }
      try {
        const recipe = await api.get(id);
        const path = `/recipes/${encodeURIComponent(recipe.id)}`;
        navigateFn(path);
        return compact({ ok: true, path, name: recipe.name });
      } catch (err) {
        return errorResult(err);
      }
    },
  },
  {
    name: "explain_recipe_format",
    title: "Explain recipe format",
    description: "Return the reference for the WebMCP Anywhere recipe JSON format (fields, action kinds, constraints, and an example). Call this before authoring or editing a recipe.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute() {
      return RECIPE_FORMAT_REFERENCE;
    },
  },
];

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Register the studio's tools once. Safe to call multiple times. */
export function registerStudioTools(): Promise<void> {
  if (registered) return registered;
  registered = (async () => {
    // A capable browser exposes document.modelContext synchronously; only give the
    // late-attach case a short grace period so plain Chrome doesn't sit on "checking…".
    const mc = document.modelContext ?? navigator.modelContext ?? (await waitForModelContext(1200));
    if (!mc) {
      setStatus("unavailable");
      return;
    }
    modelContext = mc;
    for (const tool of STUDIO_TOOLS) {
      try {
        await mc.registerTool(tool);
      } catch (err) {
        console.warn(`[studio] failed to register ${tool.name}`, err);
      }
    }
    setStatus("native");
  })();
  return registered;
}
