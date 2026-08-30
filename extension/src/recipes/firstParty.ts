/**
 * First-party recipes bundled into the extension from /recipes/*.json.
 * Vite inlines JSON imports; tsconfig needs `resolveJsonModule: true`.
 */
import type { Recipe } from "@webmcp-anywhere/shared";
import youtube from "../../../recipes/youtube.json";
import wikipedia from "../../../recipes/wikipedia.json";
import hackernews from "../../../recipes/hackernews.json";
import github from "../../../recipes/github.json";

export const FIRST_PARTY_RECIPES: Recipe[] = [youtube, wikipedia, hackernews, github] as unknown as Recipe[];

/** Ids of bundled recipes; `js` actions are permitted only for these. */
export const FIRST_PARTY_RECIPE_IDS = new Set(FIRST_PARTY_RECIPES.map((r) => r.id));
