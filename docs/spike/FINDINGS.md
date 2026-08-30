# Spike findings — what is verified, what is not (as of 2026-08-30)

Research notes backing `CHECKLIST.md`. "Verified" = read in a primary source at the cited URL. "Inferred" = reasoned from a spec/doc, not tried. "Unverified" = no source found; the checklist tests it.

## 1. Chrome: which channel/version has WebMCP, and behind what

| Fact | Status | Source |
|---|---|---|
| Local-dev flag is `chrome://flags/#enable-webmcp-testing` ("WebMCP for testing"). | Verified | https://developer.chrome.com/docs/ai/webmcp |
| Flag exists from Chromium **146.0.7672.0** upward; older builds do not show it. | Verified | https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/nEoDnFOlvAY ; https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/webmcp/webmcp.md |
| Public **origin trial runs Chrome 149 through 156**. Sites with an OT token get the API for their users without the flag; everyone else needs the flag. | Verified | https://developer.chrome.com/blog/ai-webmcp-origin-trial ; https://www.spronta.com/blog/state-of-webmcp-july-2026/ |
| Current **Chrome Stable is 152** (promoted 2026-08-25). Stable has the flag; Canary is not required. | Verified | https://chromereleases.googleblog.com/2026/08/stable-channel-update-for-desktop_0256176589.html |
| WebMCP is not on by default in stable 152 (still OT/flag). | Inferred from OT range 149–156 | same |
| `navigator.modelContext` deprecated in **Chrome 150.0.7861.0**; use `document.modelContext`. `navigator.*` remains a warning-logging alias. | Verified | https://github.com/angular/angular/issues/68947 ; spec IDL `partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; }` at https://webmachinelearning.github.io/webmcp/ |
| Chrome 149+ DevTools shows a WebMCP panel when the flag is on. | Reported (secondary) | https://www.openhermit.com/blog/webmcp-debugging-chrome-devtools-2026 |
| Chrome 153+: aborting a tool's `signal` no longer breaks in-flight executions. | Verified | https://developer.chrome.com/docs/ai/webmcp/imperative-api |

## 2. Origin isolation, `file://`, localhost

| Fact | Status | Source |
|---|---|---|
| "WebMCP is only available in origin-isolated documents." Pages that opt out with `Origin-Agent-Cluster: ?0` (to keep `document.domain`) have WebMCP disabled. | Verified | https://developer.chrome.com/docs/ai/webmcp |
| Spec: `registerTool`/`getTools` throw `SecurityError` if the agent cluster is not origin-keyed **unless the URL scheme is `file`**. `file://` documents are explicitly exempt. | Verified (spec text) | https://webmachinelearning.github.io/webmcp/ |
| Chrome uses origin-keyed agent clusters **by default since Chrome 106**, so `http://localhost:PORT` and any site not sending `Origin-Agent-Cluster: ?0` is already origin-isolated. The studio's `?1` header is belt-and-braces. | Verified | https://developer.chrome.com/blog/document-domain-setter-deprecation ; https://web.dev/articles/origin-agent-cluster |
| `document.modelContext` is `[SecureContext]`: HTTPS, `localhost`, and `file:` qualify; `http://192.168.x.x` does not. | Verified (spec IDL) | spec |
| `executeTool` rejects opaque origins (`NotSupportedError`) — only matters for sandboxed frames. | Verified | spec |
| Headers checked 2026-08-30 with curl: **example.com, en.wikipedia.org, youtube.com, google.com, github.com send no `Origin-Agent-Cluster` header** — origin-keyed by default, eligible. | Verified (curl) | local run |
| For the spike extension to run on `file://` pages you must toggle **"Allow access to file URLs"** on its card in `chrome://extensions`. | Verified (standard Chrome behaviour) | https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns |

Recommendation: serve `test-page.html` from `http://localhost` (`npx serve docs/spike` or `python3 -m http.server -d docs/spike 8000`). Secure context, origin-keyed, no file-URL toggle. Test `file://` only as an extra data point.

## 3. ChatGPT desktop browser: flag? extensions?

| Fact | Status | Source |
|---|---|---|
| OpenAI shipped WebMCP ("Site tools") in the ChatGPT desktop app's built-in browser and ChatGPT Sites, announced 2026-08-27. No flag; update the app. | Verified | https://x.com/OpenAIDevs/status/2092344959248761263 ; https://www.searchenginejournal.com/chatgpt-adds-webmcp-support/587237/ ; https://community.openai.com/t/build-agent-ready-websites-with-chatgpt/1392588 |
| Models: **GPT-5.6 Sol or GPT-5.6 Terra**. GPT-5.6 Luna has WebMCP disabled. Not available in Enterprise/Edu workspaces. | Verified | https://learn.chatgpt.com/docs/webmcp ; https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app |
| API consumed: `document.modelContext.registerTool()` (imperative). **Declarative `<form>` API and iframe tools are NOT supported.** HTTPS required. Feature check: `typeof document.modelContext?.registerTool === "function"`. | Verified | https://learn.chatgpt.com/docs/webmcp |
| UI: an arrow / "Site tools" affordance in the address bar; "Available site tools" lists them; "Sources" shows recent calls. Every call gets a safety review; sensitive actions get confirmation. Toggle in **Settings > Browser > Permissions**. Tool definitions and results are treated as untrusted content. | Verified | https://learn.chatgpt.com/docs/webmcp |
| Built-in browser "supports richer sign-in, autofill, password management, **extensions**, downloads, and navigation" and uses a browser profile separate from Chrome. | Verified via search snippet (help page itself is Cloudflare-gated to bots) | https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app |
| **How to open the extensions page / load unpacked in the built-in browser: UNVERIFIED.** Neither Learn docs nor help center describe it. Try, in order: (1) type `chrome://extensions` in the built-in browser's address bar; (2) `⋯`/profile menu → "Extensions" / "Manage extensions" (how the discontinued Atlas browser did it); (3) Chrome Web Store "Add to Chrome" (works only for a published extension). If (1) opens, the standard "Developer mode → Load unpacked" flow applies. | Unverified | https://tactiq.io/learn/chrome-extensions-chatgpt-atlas (Atlas-era) |
| Dev mode: **Settings > Browser > Developer mode > "Enable full CDP access"** lets ChatGPT read console/DOM of the built-in browser (handy for reading the spike's logs). | Verified | https://learn.chatgpt.com/docs/browser |
| Whether ChatGPT enumerates tools registered by an **extension content script** rather than page script: UNVERIFIED — the point of the spike. Learn doc says "website-provided definitions" are untrusted, which does not exclude injected scripts. | Unverified | — |

Fallback if the built-in browser cannot load unpacked extensions: the desktop app can drive **regular Chrome** through the Codex Chrome extension ("use the Codex Chrome extension when a task needs your ... Chrome extensions"), but Site-tools discovery over that path is undocumented. Plan B for the demo: Chrome 152 + flag + Inspector in Gemini mode (real LLM in the loop).

## 4. Model Context Tool Inspector

| Fact | Status | Source |
|---|---|---|
| Web Store id `gbpdfapgefenggkahomfgkhfehlcenpd`; also loadable unpacked from a clone after `npm install`. Requires Chrome **150.0.7861.0+** with the flag. | Verified | https://github.com/beaufortfrancois/model-context-tool-inspector |
| Opens as a **side panel** from the toolbar icon; tools listed in a table; manual execution = pick tool, paste JSON args, "Execute Tool". | Verified | same |
| Gemini mode **requires a Gemini API key** via "Set Gemini API key" in the side panel (https://aistudio.google.com/apikey). v1.7 had a dead-button bug, fixed in the Web Store build. | Verified | https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/2BEkWvoEiF8 |
| The Inspector reads the document's model context, so it should list any tool on the document regardless of who registered it. | Inferred | — |

## 5. `exposedTo` and cross-origin behaviour

| Fact | Status | Source |
|---|---|---|
| Tools are scoped to the **document**. `registerTool(tool, { exposedTo: [origins] })` only exposes a tool to other documents in the same frame tree (parent/child). Origins must be potentially trustworthy or `SecurityError`. | Verified | spec ; https://developer.chrome.com/docs/ai/webmcp/imperative-api |
| Cross-origin iframes need `allow="tools"` permissions policy to register at all. | Verified | https://developer.chrome.com/docs/ai/webmcp |
| A MAIN-world content script executes in the page's own realm/origin, so its tools **are the page's tools** to the browser. No `exposedTo` needed for the top-level document. Our tools inherit the page's origin, permissions policy, and OT state. | Inferred (spec is silent on extensions) | — |
| We register on the top-level document only (`all_frames: false`); iframe tools are out of scope. | Design decision | — |

## 6. Threats to the plan (ranked)

1. **ChatGPT built-in browser may not expose an extensions page / Load unpacked.** Help center says extensions are supported; the path is undocumented. Test this first. Fallback: Chrome 152 + Inspector (Gemini mode), and describe ChatGPT support as "works wherever the extension loads".
2. **ChatGPT may snapshot tools at a particular moment** (load, or on `toolchange`). Ours register up to 5 s after load. If the Site-tools arrow never appears: try `run_at: document_idle`, re-register after a delay, dispatch/observe `toolchange`, and check whether the arrow refreshes on SPA navigation.
3. **Older Chrome**: Inspector needs 150+, flag needs 146+; stable is 152, so just update. Canary is unnecessary.
4. **Sites sending `Origin-Agent-Cluster: ?0`** silently disable WebMCP. None of the target sites do (checked); log `window.originAgentCluster` so the badge can explain it when it happens.
5. **CSP** does not block manifest-declared MAIN-world content scripts (browser-injected), but does block `<script>` tags we might add. Keep all code in the content script; never inject script elements.
