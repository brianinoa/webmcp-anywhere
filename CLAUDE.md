# WebMCP Anywhere — agent guide

Hackathon project for the WebMCP Challenge (deadline Sept 3, 2026, 1 PM PT). Monorepo, pnpm workspaces, TypeScript everywhere.

## What we're building
A Chrome extension that retrofits WebMCP tools (`document.modelContext.registerTool`) onto any website — a generic layer (click/fill/scroll/describe) plus per-site "recipes" (YouTube, Wikipedia, ...) — and a hosted **Recipe Studio** web app (itself a WebMCP site) where recipes are authored, tested, and shared. Primary demo client: the ChatGPT desktop app's built-in browser (Chromium; supports extensions and consumes WebMCP natively). Secondary: Chrome 149+ with `chrome://flags/#enable-webmcp-testing` + the Model Context Tool Inspector extension.

## Layout
- `shared/` — **the contracts**. Recipe JSON format, WebMCP typings, messaging protocol, settings. Read `shared/src/index.ts` before writing anything. Do not change types without noting it in your final report.
- `extension/` — MV3 extension. `src/main-world.ts` (registers tools, runs in `world: "MAIN"`), `src/content.ts` (ISOLATED bridge), `src/background.ts`, `src/badge/` (in-page UI), `src/generic/` (generic tools), `src/recipes/` (loader + action runner). Build with Vite; output `extension/dist` loadable as unpacked.
- `recipes/` — first-party recipe JSON files (`youtube.json`, `wikipedia.json`, ...), bundled into the extension and seeded into the worker.
- `studio/` — Vite + React (TS) web app. Registers its own WebMCP tools. Deployed to Cloudflare (Workers static assets) with `Origin-Agent-Cluster: ?1`.
- `worker/` — Cloudflare Worker: recipe CRUD + sync on KV. Serves the studio's static assets in production.
- `docs/` — test checklist, demo script, submission text.

## Rules of the road
- Use `document.modelContext` (NOT `navigator.modelContext`, deprecated). Always resolve it via `waitForModelContext()` from shared — it can attach after scripts run.
- Every registered tool needs a clear `description`, an `inputSchema`, and `annotations` (`readOnlyHint` for reads, `untrustedContentHint` when returning scraped page content).
- Tools return short, structured strings/JSON the agent can verify against (what changed, current state).
- Recipes are declarative JSON actions; never ship arbitrary JS in remote recipes.
- Keep packages independent: `pnpm --filter <pkg> build|dev|typecheck` must work per package.
- Deploy with `pnpm --filter @webmcp-anywhere/worker run deploy` (the `run` matters: bare `pnpm deploy` is a pnpm built-in). The predeploy step regenerates `worker/src/seed.ts` from `recipes/*.json`; after adding a recipe, hit `/api/seed?force=1` to push it into KV. Live URL: https://webmcp-anywhere.briandaniloinoa.workers.dev
- No copyrighted media or third-party logos in anything that ends up in the demo video.
- Commit only when asked. Don't push.
