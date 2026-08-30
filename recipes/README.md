# Recipes

A recipe is a JSON bundle of WebMCP tools for one site. The extension loads every recipe whose `matches` patterns match the current URL and registers each of its tools with `document.modelContext.registerTool`. Tools are lists of declarative **actions** that the extension's runner (`extension/src/recipes/runner.ts`) executes against the live DOM — recipes never ship JavaScript.

First-party recipes live in this folder and are bundled into the extension (`extension/src/recipes/firstParty.ts`) and seeded into the worker. User recipes are authored in Recipe Studio and synced through the worker.

## Format

Types are defined in `shared/src/index.ts` (`Recipe`, `RecipeTool`, `RecipeAction`).

```jsonc
{
  "id": "hackernews",                    // stable id (slug for first-party, uuid for user recipes)
  "name": "Hacker News",
  "description": "Browse Hacker News stories and comments.",
  "version": 1,
  "matches": ["*://news.ycombinator.com/*"],   // Chrome match patterns
  "author": "WebMCP Anywhere",
  "tools": [
    {
      "name": "hn_top_stories",          // ^[A-Za-z0-9_.-]{1,128}$, unique per page, not a generic tool name
      "title": "List stories",
      "description": "…written for an LLM: what it does, what it returns, what to call next…",
      "sensitivity": "read",             // "read" | "write" | "sensitive"
      "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer", "default": 30 } } },
      "actions": [
        { "kind": "read", "selector": ".athing .titleline > a", "all": true, "limit": "{{limit}}", "as": "titles" }
      ]
    }
  ]
}
```

### Actions

Actions run in order. Any string field may contain `{{param}}` placeholders filled from the tool input (defaults from `inputSchema.properties.<p>.default` are applied first; a placeholder with no value fails the run).

| kind | fields | behaviour |
|---|---|---|
| `click` | `selector` | scrollIntoView, focus, `.click()`, then wait 300 ms |
| `type` | `selector`, `value`, `submit?` | sets the value through the native prototype setter (React/Vue/Angular notice), dispatches `input` + `change`; with `submit` also fires Enter key events and `form.requestSubmit()` |
| `select` | `selector`, `value` | picks an `<option>` by value, then exact label, then label contains; dispatches `input` + `change` |
| `scroll` | `selector?` or `to: "top" \| "bottom"` | scrolls the element into view or the window to top/bottom |
| `navigate` | `url` | `location.assign(url)`. The page unloads, so the run **returns immediately** with `navigated: <url>`; later actions never execute. `{{param}}` values are URL-encoded: query-string params via `encodeURIComponent`, path params per segment (slashes preserved). Only `http(s)` targets. |
| `wait` | `ms?`, `selector?` | with `selector`: poll until it matches a visible element (timeout `ms`, max 10 s); otherwise sleep `ms` (max 10 s) |
| `read` | `selector`, `attribute?`, `all?`, `as?`, `following?`, `limit?` | reads trimmed `textContent` (or form value, or an attribute — `href`/`src` are made absolute) into the result under `as` (default `result`). `all: true` returns an array (cap 50). A non-matching single read yields `null`. |
| `media` | `selector?`, `op`, `value?`, `relative?` | finds the `<video>`/`<audio>` (selector, else the first playing one, else the first) and applies `play`, `pause`, `toggle`, `seek`, `rate`, `volume`, `mute` (toggle, or `value` 0/1) or `state` (no change). Always returns the element state under `media`: `{paused, currentTime, duration, playbackRate, volume, muted, src?}` |
| `js` | `fn` | **refused** for remote recipes ("js actions are not allowed in remote recipes"); only first-party bundled recipes may use it (`allowJs`) |

Every run is timeboxed to 15 s and honours the WebMCP `AbortSignal`.

### Result shape

`runRecipeTool` returns a JSON string:

```json
{ "ok": true, "tool": "wiki_read_section", "did": ["read h2 \"History\" as \"heading\"", "read 8 block(s) after h2 \"History\" as \"paragraphs\""],
  "heading": "History", "paragraphs": ["…", "…"] }
```

`did` is a human-readable log of each step; every `read` adds a key named by its `as`; `media` adds `media`; `navigate` adds `navigated`. Failures reject with `"<tool>: action i/n (<kind>) failed: <reason>"`.

## Extensions beyond the shared types

These are implemented in the runner and accepted by `validateRecipe`. They are additive to `RecipeAction` in `shared/src/index.ts`:

**Selector pseudo-extensions** (work in every `selector` field, after any CSS including comma lists):

- `base:text=Some words` — the first element matching `base` whose text contains the words (case-insensitive, whitespace-collapsed). Exact matches are preferred over partial ones. Quotes are optional: `h2:text="Early life"`. Example: `#mw-content-text h2:text={{heading}}`.
- `base:nth=N` — the N-th (1-based) match of `base` in document order. Must come last. Example: `.athing .titleline > a:nth={{index}}`. Can follow `:text=`: `h2:text=history:nth=2`.

**Template builtins** (derived from the current `location`; never URL-encoded):

| placeholder | value |
|---|---|
| `{{$origin}}` | `location.origin`, e.g. `https://en.wikipedia.org` |
| `{{$host}}` | `location.host` |
| `{{$pathname}}` | `location.pathname` |
| `{{$href}}` | full current URL |
| `{{$repo}}` | first two path segments as `owner/name` (GitHub-style). Fails with a clear error when the URL has no such segments. |

**`read` additions**

- `following: N` — instead of reading the matched element, read the next N block elements (`<p>` with non-empty text) that follow it in document order, stopping at the next heading of the same or higher level (so an `h2` section includes its `h3` subsections; wrapper `<div class="mw-heading"><h2>` markup works because the walk is in document order, not sibling order). Returns an array.
- `limit: number | "{{param}}"` — caps `all: true` / `following` results (1..50). May be a template so callers can pass `limit`.

**`media` additions**

- `op: "state"` — read-only: returns the media state without changing playback (used by read-sensitivity tools like `yt_now_playing`).
- `value` may be a `"{{param}}"` string (parsed as a number) in addition to a number.
- `relative: true` on `seek` — treat `value` as an offset from `currentTime` (negative rewinds). `seek` clamps to `[0, duration]`.

## Sensitivity and approval

| sensitivity | meaning | WebMCP annotation | approval (default settings) |
|---|---|---|---|
| `read` | only reads the page; never changes state | `readOnlyHint: true` | never prompts |
| `write` | changes on-site state: navigation, playback, form input, clicking | `readOnlyHint: false` | prompts only if `approveWrites` is on |
| `sensitive` | anything that posts, purchases, deletes, sends messages, or touches account settings | `readOnlyHint: false` | click-to-approve in the badge (`approveSensitive`, default on) |

`untrustedContentHint: true` is set automatically whenever a tool contains a `read`, `media`, or `js` action, because its output includes scraped page content.

Rule of thumb: navigating and controlling playback on the site you're already on is `write`, not `sensitive`.

## Adding a recipe

1. Create `recipes/<site>.json` following the format above. One recipe per site; tool names should share a short prefix (`yt_`, `wiki_`, `hn_`, `gh_`) and must not collide with the generic tools (`describe_page`, `find_text`, `scroll_to`, `click`, `fill_field`, `select_option`, `submit_form`, `navigate`, `go_back`).
2. Write descriptions for a model: say what the tool does, what it returns (name the result keys), and what to call next. Give every parameter a `description`, mark `required`, and add `default`s where sensible.
3. Prefer stable selectors (ids, `data-*`, ARIA attributes) and comma-separated fallbacks for sites with several layouts, e.g. `"h1.ytd-watch-metadata yt-formatted-string, #title h1"`.
4. Prefer `navigate` to a URL over typing into a search box when the site has a clean URL scheme; it is more robust.
5. Register it in `extension/src/recipes/firstParty.ts` so it is bundled.
6. Validate: `validateRecipe(json)` in `extension/src/recipes/loader.ts` (the test suite runs it on every first-party recipe — `pnpm --filter @webmcp-anywhere/extension test`).
7. Try it live: load the unpacked extension, open the site, and call the tool from the Model Context Tool Inspector or the ChatGPT desktop browser.
