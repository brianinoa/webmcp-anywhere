import { matchesPattern, type Recipe, type ListRecipesResponse, type SyncResponse } from "@webmcp-anywhere/shared";
import { corsHeaders, originAllowed, preflight } from "./cors";
import { SEED_RECIPES } from "./seed";
import { RecipeStore } from "./store";
import { normalizeRecipe, shortId, slugify, validateRecipe } from "./validate";

/** Headers every non-API (studio asset) response gets so the studio is a WebMCP-capable origin. */
const WEBMCP_HEADERS: Record<string, string> = {
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": "tools=(self)",
};

const API_PREFIX = "/api/";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API_PREFIX)) {
      try {
        return await handleApi(request, url, env, ctx);
      } catch (err) {
        console.error(JSON.stringify({ level: "error", path: url.pathname, message: (err as Error).message, stack: (err as Error).stack }));
        return json(request, { error: "Internal error" }, 500);
      }
    }
    return serveAsset(request, env);
  },
} satisfies ExportedHandler<Env>;

async function serveAsset(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: WEBMCP_HEADERS });
  }
  const upstream = await env.ASSETS.fetch(request);
  const res = new Response(upstream.body, upstream);
  for (const [k, v] of Object.entries(WEBMCP_HEADERS)) res.headers.set(k, v);
  return res;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request) },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function handleApi(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return preflight(request);
  if (!originAllowed(request.headers.get("Origin"), request.method)) {
    return json(request, { error: "Origin not allowed" }, 403);
  }

  const store = new RecipeStore(env.RECIPES);
  const segments = url.pathname.slice(API_PREFIX.length).split("/").filter(Boolean);
  const [resource, id, extra] = segments;
  const method = request.method;

  // GET /api/seed  — (re)load first-party recipes from the bundled seed.
  if (resource === "seed" && !id && (method === "GET" || method === "POST")) {
    const seeded = await seed(store, { force: url.searchParams.get("force") === "1" });
    return json(request, { seeded: seeded.map((r) => r.id), available: SEED_RECIPES.length });
  }

  // GET /api/sync?since=ISO
  if (resource === "sync" && !id && method === "GET") {
    await seedIfEmpty(store);
    const since = url.searchParams.get("since");
    if (since && Number.isNaN(Date.parse(since))) return json(request, { error: "since: must be an ISO timestamp" }, 400);
    const recipes = await store.updatedSince(since);
    const body: SyncResponse = { recipes: sortByName(recipes), serverTime: new Date().toISOString() };
    return json(request, body);
  }

  if (resource !== "recipes" || extra !== undefined) return json(request, { error: "Not found" }, 404);

  // /api/recipes
  if (!id) {
    if (method === "GET") {
      await seedIfEmpty(store);
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const site = (url.searchParams.get("site") ?? "").trim();
      let recipes = await store.all();
      if (q) recipes = recipes.filter((r) => searchText(r).includes(q));
      if (site) {
        const siteUrl = /^[a-z]+:\/\//i.test(site) ? site : `https://${site}`;
        recipes = recipes.filter((r) => r.matches.some((p) => matchesPattern(p, siteUrl)));
      }
      const body: ListRecipesResponse = { recipes: sortByName(recipes) };
      return json(request, body);
    }
    if (method === "POST") {
      const input = await readJson(request);
      const v = validateRecipe(input);
      if (!v.ok) return json(request, { error: "Invalid recipe", errors: v.errors }, 400);
      const raw = input as Record<string, unknown>;
      const now = new Date().toISOString();
      let newId = typeof raw.id === "string" ? raw.id : "";
      if (newId) {
        if (await store.exists(newId)) return json(request, { error: `Recipe "${newId}" already exists` }, 409);
      } else {
        do newId = `${slugify(raw.name as string)}-${shortId()}`; while (await store.exists(newId));
      }
      const recipe = normalizeRecipe({ ...raw, id: newId, createdAt: now, updatedAt: now });
      await store.put(recipe);
      return json(request, recipe, 201);
    }
    return json(request, { error: "Method not allowed" }, 405);
  }

  // /api/recipes/:id
  if (method === "GET") {
    await seedIfEmpty(store);
    const recipe = await store.get(id);
    return recipe ? json(request, recipe) : json(request, { error: "Not found" }, 404);
  }
  if (method === "PUT") {
    const existing = await store.get(id);
    if (!existing) return json(request, { error: "Not found" }, 404);
    const input = await readJson(request);
    const v = validateRecipe(input);
    if (!v.ok) return json(request, { error: "Invalid recipe", errors: v.errors }, 400);
    const raw = input as Record<string, unknown>;
    if (typeof raw.id === "string" && raw.id !== id) return json(request, { error: "id in body does not match URL" }, 400);
    const recipe = normalizeRecipe({
      ...raw,
      id,
      version: typeof raw.version === "number" ? raw.version : existing.version + 1,
      createdAt: existing.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.put(recipe);
    return json(request, recipe);
  }
  if (method === "DELETE") {
    const deleted = await store.delete(id);
    return deleted ? json(request, { ok: true, id }) : json(request, { error: "Not found" }, 404);
  }
  void ctx;
  return json(request, { error: "Method not allowed" }, 405);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function searchText(r: Recipe): string {
  return [r.name, r.description, ...r.matches, ...r.tools.map((t) => `${t.name} ${t.title ?? ""} ${t.description}`)]
    .join("\n")
    .toLowerCase();
}

function sortByName(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => a.name.localeCompare(b.name));
}

/** Upsert bundled first-party recipes. Without `force`, only inserts ids that don't exist yet. */
async function seed(store: RecipeStore, opts: { force: boolean }): Promise<Recipe[]> {
  const index = await store.index();
  const existing = new Set(index.map((e) => e.id));
  const now = new Date().toISOString();
  const toWrite = SEED_RECIPES.filter((r) => opts.force || !existing.has(r.id)).map((r) => ({
    ...r,
    author: r.author ?? "WebMCP Anywhere",
    createdAt: r.createdAt ?? now,
    updatedAt: now,
  }));
  if (toWrite.length) await store.putMany(toWrite);
  return toWrite;
}

async function seedIfEmpty(store: RecipeStore): Promise<void> {
  if (SEED_RECIPES.length === 0) return;
  const index = await store.index();
  if (index.length === 0) await seed(store, { force: false });
}
