# Integration test checklist — WebMCP Anywhere

Run after `pnpm -r build`, with `extension/dist` loaded unpacked and the worker running (`pnpm --filter worker dev`, default `http://localhost:8787`) or deployed. Spike-level environment checks (flag, versions, extensions page in ChatGPT) live in `docs/spike/CHECKLIST.md` and are assumed done.

Client column: **C** = Chrome 150+ with flag + Inspector, **G** = ChatGPT desktop built-in browser (GPT-5.6 Sol/Terra). Test on both where possible.

## 1. Extension generic tools on three real sites

| # | Site | Tool | Input | Expected | C | G | Notes |
|---|---|---|---|---|---|---|---|
| 1.1 | https://example.com | `describe_page` | `{}` | JSON with title "Example Domain", one heading, one link; `untrustedContentHint` on the tool | | | |
| 1.2 | https://example.com | `find_text` | `{"query":"illustrative"}` | match with surrounding snippet | | | |
| 1.3 | https://example.com | `click` | `{"target":"More information..."}` | navigates to iana.org; result reports new URL | | | |
| 1.4 | https://example.com | `go_back` | `{}` | returns to example.com | | | |
| 1.5 | https://en.wikipedia.org/wiki/Main_Page | `fill_field` | `{"target":"Search Wikipedia","value":"WebMCP"}` | search box contains "WebMCP"; result echoes value | | | |
| 1.6 | same | `submit_form` | `{"target":"Search Wikipedia"}` | lands on search/article page; result gives new URL + title | | | |
| 1.7 | same | `scroll_to` | `{"target":"References"}` | page scrolls; heading visible | | | |
| 1.8 | https://developer.mozilla.org/en-US/ | `describe_page` | `{}` | structured summary of nav + hero, under size cap | | | |
| 1.9 | same | `select_option` | any `<select>` present, e.g. language switcher | option changes; result states selected value | | | |
| 1.10 | same | `navigate` | `{"url":"https://developer.mozilla.org/en-US/docs/Web"}` | navigates; tools re-register on the new document | | | |
| 1.11 | any | badge | — | badge shows "9 generic tools"; hidden when `showBadge=false` | | | |
| 1.12 | any | tool descriptions | — | every generic tool has description + inputSchema + annotations (`readOnlyHint` on describe/find, `untrustedContentHint` on describe/find) | | | |

## 2. First-party recipes

| # | Site | Recipe tool | Input | Expected | C | G | Notes |
|---|---|---|---|---|---|---|---|
| 2.1 | YouTube (CC video) | badge | — | badge shows "YouTube recipe" and its tool count alongside generic tools | | | |
| 2.2 | YouTube | `youtube_info` | `{}` | title, channel, duration, current time | | | |
| 2.3 | YouTube | `youtube_seek` | `{"seconds":90}` | player at 1:30; result reports current time | | | |
| 2.4 | YouTube | `youtube_rate` | `{"rate":1.5}` | playback 1.5x | | | |
| 2.5 | YouTube | `youtube_mute` / toggle | `{}` | muted; result reports state | | | |
| 2.6 | YouTube | `youtube_search` | `{"query":"blender open movie"}` | results page; list of top results | | | |
| 2.7 | Wikipedia | `wiki_search` | `{"query":"Origin-Agent-Cluster"}` | navigates to article or results | | | |
| 2.8 | Wikipedia | `wiki_toc` | `{}` | list of section headings | | | |
| 2.9 | Wikipedia | `wiki_section` | `{"heading":"History"}` | section text, `untrustedContentHint` | | | |
| 2.10 | any recipe site | name collision | — | a recipe tool named like a generic tool is rejected by the loader (log entry) | | | |
| 2.11 | any recipe site | remote `js` action | recipe from worker containing `{"kind":"js"}` | extension refuses the tool and logs why | | | |
| 2.12 | recipe `matches` | open a non-matching URL on the same domain | — | recipe tools not registered | | | |

## 3. Approval flow

| # | Scenario | Expected | C | G | Notes |
|---|---|---|---|---|---|
| 3.1 | Call a tool with `sensitivity: "sensitive"` (default settings) | approval card appears in page with tool name and pretty-printed input; tool does not run yet | | | |
| 3.2 | Click **Deny** | tool returns an error string "denied by user"; agent reports it; no side effect | | | |
| 3.3 | Click **Approve** | tool runs; result returned; card closes | | | |
| 3.4 | Ignore the card 60 s | call times out with a clear error, page not stuck | | | |
| 3.5 | `approveWrites=true` in settings | `write` tools also prompt | | | |
| 3.6 | `approveSensitive=false` | sensitive tools run without prompt (documented as unsafe) | | | |
| 3.7 | Abort signal from host during pending approval | card removed, tool rejects | | | |

## 4. Recipe Studio tools (via the agent)

| # | Studio tool | Prompt to agent | Expected | C | G | Notes |
|---|---|---|---|---|---|---|
| 4.1 | discovery | open studio URL | Site tools arrow / Inspector lists studio tools; `originAgentCluster === true`; response header `Origin-Agent-Cluster: ?1` | | | |
| 4.2 | `create_recipe` | "Create a recipe for developer.mozilla.org" | new draft appears in UI with id, name, matches | | | |
| 4.3 | `add_tool` | "Add a read-only tool `mdn_toc` that reads `.document-toc a`" | tool appears in editor with actions | | | |
| 4.4 | `test_selector` | "Test that selector against https://developer.mozilla.org/en-US/docs/Web/HTML" | returns count/sample text (or a clear 'needs extension' message if run server-side) | | | |
| 4.5 | `set_matches` / `update_tool` | "Restrict it to /docs/ pages" | matches updated | | | |
| 4.6 | `publish_recipe` | "Publish it" | worker `POST /api/recipes` succeeds; recipe listed with author | | | |
| 4.7 | `list_recipes` / `get_recipe` | "What recipes exist for youtube?" | returns first-party youtube recipe | | | |
| 4.8 | `delete_recipe` | "Delete the MDN recipe" | marked sensitive → approval/confirmation before deletion | | | |
| 4.9 | validation | ask for a tool named `click` or with a `js` action | studio rejects with a readable error | | | |

## 5. Recipe sync: worker -> extension

| # | Scenario | Expected | Notes |
|---|---|---|---|
| 5.1 | Fresh install, worker reachable | background fetches `GET /api/sync` on install; bundled recipes still present if worker down | |
| 5.2 | Publish recipe in studio (4.6) | within the sync interval (or on badge "Sync now") the extension has it; `GET /api/sync?since=` returns only newer recipes | |
| 5.3 | Open matching site after sync | new recipe's tools registered without reinstalling the extension | |
| 5.4 | Update recipe version in studio | extension replaces old version (version number increases) | |
| 5.5 | Delete recipe in studio | extension drops it on next sync | |
| 5.6 | Change `apiBase` in extension settings | next sync uses new base; bad URL logs an error and keeps cached recipes | |
| 5.7 | Worker CORS | extension origin and studio origin can call the API; others cannot write | |

## 6. Hygiene

| # | Check | Result |
|---|---|---|
| 6.1 | `pnpm -r typecheck` and `pnpm -r build` pass | |
| 6.2 | No console errors on load for the three sites in §1 | |
| 6.3 | Extension does nothing on `chrome://` and on pages without `modelContext` besides one log line | |
| 6.4 | No copyrighted media or third-party logos in demo assets | |
