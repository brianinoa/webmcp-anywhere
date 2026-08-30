# WebMCP Anywhere

**Bring WebMCP to every website.** A Chrome extension that retrofits structured agent tools (`document.modelContext.registerTool`) onto any page, plus a Recipe Studio for authoring and sharing per-site tool recipes.

Built for the [WebMCP Challenge](https://webmcp.devpost.com). Repo: https://github.com/brianinoa/webmcp-anywhere

## Quick start (try it in 2 minutes)

1. **Chrome 149+**: open `chrome://flags/#enable-webmcp-testing`, set **Enabled**, relaunch. (The ChatGPT desktop app's built-in browser needs no flag.)
2. `pnpm install && pnpm build:extension`, then `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.
3. Visit any site (try Wikipedia or YouTube). A **⚡ N tools** badge appears bottom-right listing the WebMCP tools now registered on that page.
4. Call them from an agent: ChatGPT's built-in browser shows a **Site tools** indicator in the address bar; in Chrome, install the [Model Context Tool Inspector](https://chromewebstore.google.com/detail/gbpdfapgefenggkahomfgkhfehlcenpd) and open its side panel.

See `extension/README.md`, `recipes/README.md`, and `docs/` for details, the demo script, and test checklists.

## Packages

| Package | What |
|---|---|
| `extension/` | MV3 Chrome extension — generic tools + recipe loader + safety badge |
| `recipes/` | First-party recipes (YouTube, Wikipedia, ...) |
| `studio/` | Recipe Studio web app (a WebMCP site itself) |
| `worker/` | Cloudflare Worker — recipe storage & sync |
| `shared/` | Shared types and protocol |

## Development

```sh
pnpm install
pnpm build:extension   # then load extension/dist as unpacked in chrome://extensions
pnpm dev:worker        # http://localhost:8787
pnpm dev:studio        # http://localhost:5173
```

## License

MIT
