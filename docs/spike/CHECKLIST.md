# Day-1 spike checklist — can an extension-registered WebMCP tool be seen and called?

Kit: `docs/spike/minimal-extension/` (load unpacked, no build) and `docs/spike/test-page.html`.
Background and citations: `FINDINGS.md`. Fill in the results table at the bottom and paste it into the team channel.

Legend for the spike's visual signals (page border flashes):
- red = no `modelContext` after 5 s
- amber = `modelContext` found, tools registered, waiting for calls
- green = `wma_ping` executed; blue = `read_headings` executed
- test page body turns yellow when its own `native_ping` runs

Console filter: `[WMA-spike]` (extension) and `[test-page]` (page).

---

## Part A — Chrome + Model Context Tool Inspector

### 1. Chrome version and flag
1. Open `chrome://version`. Need **>= 150.0.7861** (Inspector minimum). Stable is 152 as of 2026-08-25; if lower, update via `chrome://settings/help`. Canary is not needed.
2. Open `chrome://flags/#enable-webmcp-testing`, set **Enabled**, click **Relaunch**.
3. Expected: after relaunch, DevTools (F12) on any https page shows a **WebMCP** panel (may be under the `>>` overflow). Presence of the panel confirms the flag took.

### 2. Load the spike extension
1. `chrome://extensions` → toggle **Developer mode** (top right) → **Load unpacked** → select `docs/spike/minimal-extension/`.
2. Expected: card "WMA Spike: WebMCP ping 0.0.1" with no errors. If you plan to test `file://`, also enable **Allow access to file URLs** on the card.
3. Install the Inspector: https://chromewebstore.google.com/detail/gbpdfapgefenggkahomfgkhfehlcenpd (or clone https://github.com/beaufortfrancois/model-context-tool-inspector, `npm install`, load unpacked). Pin it to the toolbar.

### 3. Open the test page three ways
1. Local server (preferred): from repo root run `npx serve docs/spike` (or `python3 -m http.server -d docs/spike 8000`) and open `http://localhost:3000/test-page.html` (or `:8000`). `localhost` is a secure context and origin-keyed by default.
2. Expected on the page's status box: `isSecureContext: true`, `originAgentCluster: true`, `modelContext: FOUND after Nms via document`, `native_ping: registered`, and after ~1 s `getTools(): native_ping, read_headings, wma_ping`.
3. Expected in console: `[WMA-spike] modelContext FOUND after Nms via document.modelContext`, `registered wma_ping`, `registered read_headings`, `getTools() -> [...]`. Border flashes amber.
4. `file://` variant: open `docs/spike/test-page.html` directly. Per spec `file:` is exempt from the origin-keying check, so `modelContext` should still be present. Record whether it is; record whether the extension's tools appear (needs the file-URL toggle from step 2).
5. Real sites with no WebMCP: open https://example.com and https://en.wikipedia.org/wiki/Main_Page. Expected: console shows `modelContext FOUND`, amber flash, `getTools() -> ["wma_ping","read_headings"]`.

### 4. Inspector side panel
1. On each page from step 3, click the Inspector toolbar icon → side panel opens.
2. Expected: table lists **wma_ping** and **read_headings** (plus **native_ping** on the test page). If the panel was open before the tools registered, click its refresh / reopen it.
3. Select `wma_ping`, args `{"message":"hello"}`, **Execute Tool**. Expected result: `pong: hello from localhost` (or `from example.com`), page border flashes green, console logs `wma_ping called with {message: "hello"}`.
4. Execute `read_headings` with `{}`. Expected: JSON with `title` and a `headings` array; border flashes blue.
5. Optional LLM loop: **Set Gemini API key** in the side panel (key from https://aistudio.google.com/apikey), then prompt "call the wma_ping tool with message hello". Expected: Gemini selects `wma_ping`, and the same green flash occurs.
6. DevTools → WebMCP panel: confirm the same tools are listed there (secondary confirmation).

## Part B — ChatGPT desktop app built-in browser

### 5. Setup and test
1. Update the ChatGPT desktop app to the latest version (macOS or Windows). Site tools shipped 2026-08-27. In the model picker choose **GPT-5.6 Sol** or **GPT-5.6 Terra** (Luna has WebMCP off). Personal/Plus/Pro/Work account; Enterprise/Edu workspaces do not have Site tools.
2. Confirm Site tools are on: **Settings > Browser > Permissions** → site tools enabled. Optional: **Settings > Browser > Developer mode > Enable full CDP access** so you can ask ChatGPT to read the console.
3. Control test first: open https://codex-modeling-studio.openai.chatgpt.site/ in the built-in browser. Expected: an **arrow / "Site tools" indicator** appears in the address bar; clicking it shows "Available site tools". This proves your app build and model support WebMCP before we introduce the extension.
4. Install the spike extension in the **built-in** browser (it uses its own profile, not Chrome's). The exact path is **unverified** — try in order and record which works:
   a. Type `chrome://extensions` in the built-in browser's address bar → Developer mode → Load unpacked → `docs/spike/minimal-extension/`.
   b. Browser `⋯` or profile menu → "Extensions" / "Manage extensions".
   c. If neither exists: the built-in browser may only accept Web Store installs. Record this as a blocker (see step 6).
5. Open https://example.com in the built-in browser. Expected: address bar shows the Site tools arrow; "Available site tools" lists `wma_ping` and `read_headings` with their read-only marker.
6. In the chat, with the tab active, ask: **"call the wma_ping tool with message hello"**. Expected: ChatGPT runs the tool, replies with `pong: hello from example.com`, page border flashes green, and **Sources** shows the call.
7. Ask: **"use read_headings and tell me the headings on this page"**. Expected: a list containing "Example Domain".
8. Repeat 5–7 on https://en.wikipedia.org/wiki/Main_Page and on the local test page (`http://localhost:...`). Note: ChatGPT docs say HTTPS is required — `localhost` may or may not count; record it.

### 6. Failure modes and what to try next
| Symptom | Likely cause | Try |
|---|---|---|
| Red flash / `NO modelContext` in Chrome | flag not enabled, Chrome < 146, page opted out with `Origin-Agent-Cluster: ?0`, or non-secure http origin | recheck flag + relaunch; check `window.originAgentCluster` in console; use https/localhost |
| `modelContext` present but `registerTool` throws `SecurityError` | not origin-keyed (only possible on non-file schemes) | check response headers for `Origin-Agent-Cluster: ?0`; try another site |
| Tools register but Inspector shows nothing | Inspector snapshot taken before registration | reopen side panel; try `run_at: "document_idle"` in manifest; add a `toolchange` listener log |
| Chrome works, ChatGPT shows no Site tools arrow on example.com but shows it on the OpenAI demo site | ChatGPT enumerates at a different time, or ignores injected registrations | (1) change `run_at` to `document_idle`; (2) register again after 2 s; (3) re-register on `toolchange`; (4) reload tab after extension loads; (5) test on `https://` only |
| No arrow even on the OpenAI demo site | wrong model (Luna), old app, Enterprise/Edu workspace, site tools disabled in Settings | switch model; update app; check Settings > Browser > Permissions |
| Built-in browser has no way to load unpacked | ChatGPT browser restricts extension installs | record as blocker; ask ChatGPT (with CDP access on) "what is `typeof document.modelContext` on this tab" to at least confirm API presence; fall back to Chrome + Inspector for the demo; consider publishing the extension to the Web Store as unlisted if that path works |
| Only `navigator.modelContext` exists | older build | the spike already falls back to `navigator.modelContext`; note the build |
| `file://` page: page tool works but extension tools missing | "Allow access to file URLs" off | toggle it on the extension card |

---

## Results table (fill in)

| # | Test | Host | Expected | Result (pass/fail) | Notes / build numbers |
|---|---|---|---|---|---|
| 1 | Flag enabled, DevTools WebMCP panel visible | Chrome ___ | panel visible | | |
| 3a | test-page over localhost: 3 tools in `getTools()` | Chrome | native_ping, read_headings, wma_ping | | |
| 3b | test-page over `file://` | Chrome | modelContext present; tools ___ | | |
| 3c | example.com: extension tools registered | Chrome | amber flash, 2 tools | | |
| 3d | wikipedia.org: extension tools registered | Chrome | amber flash, 2 tools | | |
| 4a | Inspector lists extension tools | Chrome | wma_ping, read_headings visible | | |
| 4b | Inspector executes wma_ping | Chrome | `pong: hello from ...`, green flash | | |
| 4c | Inspector Gemini mode calls wma_ping | Chrome | same via LLM | | |
| 5c | OpenAI demo site shows Site tools arrow | ChatGPT app ___ / model ___ | arrow present | | |
| 5d | Extensions page reachable in built-in browser | ChatGPT | path: ___ | | |
| 5e | example.com shows Site tools arrow with our 2 tools | ChatGPT | arrow + 2 tools | | |
| 5f | "call wma_ping with hello" | ChatGPT | pong reply, green flash, Sources entry | | |
| 5g | read_headings via chat | ChatGPT | headings listed | | |
| 5h | wikipedia.org via chat | ChatGPT | pong | | |
| 5i | localhost test page in ChatGPT | ChatGPT | arrow present? | | |

Decision rule: if 4a–4b pass we have a demoable product on Chrome. If 5e–5f pass we have the primary demo. If 5d fails, switch DEMO.md to the Chrome + Inspector path and keep ChatGPT as a stretch goal.
