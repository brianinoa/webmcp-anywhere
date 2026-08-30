/**
 * Human/LLM-readable reference for the recipe format, derived from the types
 * in @webmcp-anywhere/shared. Returned by the `explain_recipe_format` tool and
 * shown in the editor's help panel.
 */
export const RECIPE_FORMAT_REFERENCE = `WebMCP Anywhere recipe format (JSON)

Recipe {
  id: string            // stable slug, e.g. "youtube"; omit on create and the server assigns slug-from-name + suffix
  name: string          // human name, max 128 chars
  description: string   // what the site is and what the tools let an agent do
  version: number       // integer, bumped on update
  matches: string[]     // Chrome match patterns, e.g. "*://*.youtube.com/*" (non-empty)
  author?: string
  tools: RecipeTool[]   // non-empty
}

RecipeTool {
  name: string          // ^[A-Za-z0-9_.-]{1,128}$, unique within the recipe; must not be one of the generic names
                        // (describe_page, find_text, scroll_to, click, fill_field, select_option, submit_form, navigate, go_back)
  title?: string
  description: string   // LLM-facing: when to use it, what it returns
  inputSchema?: JSONSchema   // {type:"object", properties:{...}, required:[...]}; params are referenced as {{param}} in actions
  sensitivity: "read" | "write" | "sensitive"   // "sensitive" tools require click-to-approve in the extension
  actions: RecipeAction[]    // run in order; the last "read" action's result (or a run summary) is returned
}

RecipeAction (discriminated by "kind"):
  { kind:"click",    selector }
  { kind:"type",     selector, value, submit? }        // value may contain {{param}}; submit presses Enter
  { kind:"select",   selector, value }
  { kind:"scroll",   selector?, to?: "top"|"bottom" }
  { kind:"navigate", url }                             // url may contain {{param}}
  { kind:"wait",     ms?, selector? }                  // wait for time and/or for selector to appear
  { kind:"read",     selector, attribute?, all?, as? } // returns textContent (or attribute); all=true returns a list; as names the result
  { kind:"media",    selector?, op: "play"|"pause"|"toggle"|"seek"|"rate"|"volume"|"mute", value? }
  { kind:"js",       fn }                              // first-party bundled recipes only; rejected in remote recipes

Example:
{
  "name": "Example Search",
  "description": "Search example.com and read the results.",
  "version": 1,
  "matches": ["*://*.example.com/*"],
  "tools": [{
    "name": "search",
    "description": "Search the site for a query and return the result titles.",
    "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] },
    "sensitivity": "read",
    "actions": [
      { "kind": "type", "selector": "input[name=q]", "value": "{{query}}", "submit": true },
      { "kind": "wait", "selector": ".result" },
      { "kind": "read", "selector": ".result h3", "all": true, "as": "results" }
    ]
  }]
}`;
