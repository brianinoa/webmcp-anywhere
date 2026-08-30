import { API_ROUTES, type ListRecipesResponse, type Recipe } from "@webmcp-anywhere/shared";

/** Same origin in production (the worker serves the studio); the local worker in dev. */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:8787" : "");

export class ApiError extends Error {
  constructor(message: string, public status: number, public errors: string[] = []) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] } & T;
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.errors ?? []);
  return body;
}

export interface ListParams {
  q?: string;
  site?: string;
}

export const api = {
  list(params: ListParams = {}): Promise<Recipe[]> {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.site) qs.set("site", params.site);
    const suffix = qs.size ? `?${qs}` : "";
    return call<ListRecipesResponse>(API_ROUTES.listRecipes + suffix).then((r) => r.recipes);
  },
  get(id: string): Promise<Recipe> {
    return call<Recipe>(API_ROUTES.getRecipe.replace(":id", encodeURIComponent(id)));
  },
  create(recipe: Omit<Recipe, "id"> & { id?: string }): Promise<Recipe> {
    return call<Recipe>(API_ROUTES.createRecipe, { method: "POST", body: JSON.stringify(recipe) });
  },
  update(id: string, recipe: Recipe): Promise<Recipe> {
    return call<Recipe>(API_ROUTES.updateRecipe.replace(":id", encodeURIComponent(id)), { method: "PUT", body: JSON.stringify(recipe) });
  },
  delete(id: string): Promise<{ ok: true; id: string }> {
    return call(API_ROUTES.deleteRecipe.replace(":id", encodeURIComponent(id)), { method: "DELETE" });
  },
};

/** Fired (on window) whenever a recipe is created/updated/deleted, by the UI or by a WebMCP tool. */
export const RECIPES_CHANGED = "webmcp-anywhere:recipes-changed";
export function notifyRecipesChanged(): void {
  window.dispatchEvent(new CustomEvent(RECIPES_CHANGED));
}
