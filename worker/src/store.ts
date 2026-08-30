import type { Recipe } from "@webmcp-anywhere/shared";

/**
 * KV layout:
 *   recipe:<id>     -> Recipe (JSON)
 *   recipes:index   -> IndexEntry[] (id + updatedAt), the source of truth for listing
 */
export interface IndexEntry {
  id: string;
  updatedAt: string;
}

const INDEX_KEY = "recipes:index";
const recipeKey = (id: string) => `recipe:${id}`;

export class RecipeStore {
  constructor(private kv: KVNamespace) {}

  async index(): Promise<IndexEntry[]> {
    return (await this.kv.get<IndexEntry[]>(INDEX_KEY, "json")) ?? [];
  }

  private async writeIndex(entries: IndexEntry[]): Promise<void> {
    await this.kv.put(INDEX_KEY, JSON.stringify(entries));
  }

  async get(id: string): Promise<Recipe | null> {
    return this.kv.get<Recipe>(recipeKey(id), "json");
  }

  async getMany(ids: string[]): Promise<Recipe[]> {
    const results = await Promise.all(ids.map((id) => this.get(id)));
    return results.filter((r): r is Recipe => r !== null);
  }

  async all(): Promise<Recipe[]> {
    const index = await this.index();
    return this.getMany(index.map((e) => e.id));
  }

  /** Recipes with updatedAt strictly after `since` (ISO). */
  async updatedSince(since: string | null): Promise<Recipe[]> {
    const index = await this.index();
    const sinceMs = since ? Date.parse(since) : NaN;
    const ids = Number.isNaN(sinceMs)
      ? index.map((e) => e.id)
      : index.filter((e) => Date.parse(e.updatedAt) > sinceMs).map((e) => e.id);
    return this.getMany(ids);
  }

  async exists(id: string): Promise<boolean> {
    return (await this.index()).some((e) => e.id === id);
  }

  /** Insert or replace. Caller sets timestamps. */
  async put(recipe: Recipe): Promise<void> {
    await this.kv.put(recipeKey(recipe.id), JSON.stringify(recipe));
    const index = (await this.index()).filter((e) => e.id !== recipe.id);
    index.push({ id: recipe.id, updatedAt: recipe.updatedAt ?? new Date().toISOString() });
    await this.writeIndex(index);
  }

  async putMany(recipes: Recipe[]): Promise<void> {
    await Promise.all(recipes.map((r) => this.kv.put(recipeKey(r.id), JSON.stringify(r))));
    const ids = new Set(recipes.map((r) => r.id));
    const index = (await this.index()).filter((e) => !ids.has(e.id));
    for (const r of recipes) index.push({ id: r.id, updatedAt: r.updatedAt ?? new Date().toISOString() });
    await this.writeIndex(index);
  }

  async delete(id: string): Promise<boolean> {
    const index = await this.index();
    if (!index.some((e) => e.id === id)) return false;
    await this.kv.delete(recipeKey(id));
    await this.writeIndex(index.filter((e) => e.id !== id));
    return true;
  }
}
