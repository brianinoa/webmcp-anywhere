# WebMCP Anywhere

**Bring WebMCP to every website.** A Chrome extension that retrofits structured agent tools (`document.modelContext.registerTool`) onto any page, plus a Recipe Studio for authoring and sharing per-site tool recipes.

Built for the [WebMCP Challenge](https://webmcp.devpost.com).

> Work in progress — install and demo instructions coming as the project lands.

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
