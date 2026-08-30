# Devpost submission draft — WebMCP Anywhere

**Tagline:** Every website gets WebMCP tools today — and the agent helps you write the good ones.

## Feature bullets
- Chrome (MV3) extension that registers WebMCP tools via `document.modelContext.registerTool` on any page: nine generic tools (`describe_page`, `find_text`, `scroll_to`, `click`, `fill_field`, `select_option`, `submit_form`, `navigate`, `go_back`).
- Per-site **recipes** — pure JSON, no scripts — that add purpose-built tools (YouTube: seek/rate/mute/info; Wikipedia: search/TOC/section), synced from a Cloudflare Worker.
- In-page badge showing which tools are live, and a click-to-approve card for tools marked `sensitive` before they run.
- **Recipe Studio**, a web app that is itself a WebMCP site, so an agent can author, test, and publish recipes by calling the studio's own tools.
- Works in the ChatGPT desktop app's built-in browser (Site tools) and in Chrome 149+ with the WebMCP flag.

## Description (~550 words)

**The problem.** WebMCP is the right idea — a page tells the agent what it can do, with names, schemas, and annotations, instead of the agent reverse-engineering the DOM from screenshots. But it only helps on sites that have adopted it, and today that is a rounding error of the web. Agents still spend most of their time guessing.

**What we built.** WebMCP Anywhere is a Chrome extension plus a hosted Recipe Studio. The extension runs a content script in each page's main world, waits for `document.modelContext`, and registers tools exactly as a first-party site would. On an unknown page it registers a generic layer: describe the page as structured text, find text, scroll, click, fill and submit forms, navigate. On sites it recognises it also loads a *recipe* — a JSON file of tools built from declarative actions (`click`, `type`, `read`, `media`, `wait`…) with `{{param}}` placeholders — which gives the agent tools like `youtube_seek` or `wiki_section` instead of clicks. Recipes are stored on a Cloudflare Worker (KV) and synced to the extension; first-party ones are bundled.

**Why WebMCP suits this.** The imperative API is document-scoped and origin-isolated, which is precisely the boundary an extension already lives in: our tools are indistinguishable from the site's own, the browser applies the same safety review, and every host that consumes WebMCP (ChatGPT's browser, Chrome + Gemini, the Inspector) sees them without any integration work from us. Tool `annotations` let us mark scraped content as untrusted and reads as read-only, so the agent's host can make sensible decisions about confirmation.

**How it improves the experience.** For the person: they ask in plain language and watch the page do the thing, with a badge that shows what tools exist and an approval card that shows the exact input before anything sensitive runs. For the agent: fewer, more reliable calls — one `youtube_seek` instead of a fragile sequence of coordinate clicks — and every tool returns what changed so it can verify the result rather than re-screenshot.

**What people and agents can now do together.** The studio is the part we are proudest of. It is a WebMCP site itself, exposing `create_recipe`, `add_tool`, `test_selector`, `publish_recipe` and friends. That means the loop for making a site agent-ready is: open the site and the studio side by side, and tell the agent "make a recipe for this site's search and results list". The agent proposes selectors, tests them live through the extension's `find_text`/`describe_page` on the real page, writes the recipe through the studio's tools, and publishes it. The human reviews the JSON, adjusts a description, flips a tool to `sensitive`. Minutes later the recipe is live in every browser running the extension. Previously this required a developer writing and maintaining automation code per site; now it is a conversation, and the artefact is reviewable data rather than code.

**Implementation.** pnpm monorepo, TypeScript throughout. `shared/` holds the recipe schema, WebMCP typings, and the MAIN⇄ISOLATED⇄background message protocol. `extension/` (Vite, MV3) has a MAIN-world registrar, an isolated bridge for settings/recipes/approvals, a background sync worker, and an in-page badge. `recipes/` are the JSON files. `studio/` is Vite + React, served as static assets by `worker/` (Cloudflare Workers + KV) with `Origin-Agent-Cluster: ?1`. Remote recipes may not contain a `js` action; only bundled first-party recipes can.

**Honest limits.** Generic tools are heuristics and will misfire on heavy SPAs. We register on top-level documents only. WebMCP is behind a flag/origin trial in Chrome, so judging requires the setup below.

## How to test (judges)

**Path A — ChatGPT desktop app (primary).** Update to the latest ChatGPT desktop app; pick model GPT-5.6 Sol or Terra. Open the built-in browser, load the unpacked extension from `extension/dist` (see `docs/spike/CHECKLIST.md` §5 for the extensions-page path), visit https://en.wikipedia.org and confirm the Site tools arrow in the address bar. Ask: "Search for 'WebMCP' and give me the first paragraph." Then open the studio URL in the README and ask it to create and publish a recipe.

**Path B — Chrome 149+ with flag.** Enable `chrome://flags/#enable-webmcp-testing`, relaunch, load `extension/dist` unpacked, install the Model Context Tool Inspector (Web Store id `gbpdfapgefenggkahomfgkhfehlcenpd`). On any page open the Inspector side panel: the tools are listed and can be executed manually, or with Gemini after setting an API key.
