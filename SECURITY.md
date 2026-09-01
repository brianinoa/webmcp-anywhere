# Security model

WebMCP Anywhere registers agent-callable tools on pages you visit and runs a shared,
publicly-writable recipe library. That surface deserves an explicit threat model.

## Trust boundaries

- **`main-world.ts`** runs in the page's own JavaScript world (`world: "MAIN"`), because
  that is the only place `document.modelContext.registerTool` is reachable. Code here shares
  a realm with the page, so it is **not** a place to keep secrets or make unforgeable decisions.
- **`content.ts`** runs in the extension's isolated world. The page cannot read or call into it.
- **`background.ts`** is the extension service worker.
- The **worker** is the public backend; the **studio** is a public, no-login recipe editor.

## What we defend against, and how

- **A recipe that mislabels its sensitivity to dodge the approval prompt.**
  Approval is gated on `effectiveSensitivity(declared, actions)` (`shared/src/index.ts`), the
  stricter of what the author declared and what the actions actually do. A tool full of
  `click`/`type`/`navigate` actions labelled `"read"` is still gated as a write; anything that
  submits a form or runs `js` is gated as `"sensitive"` and always prompts.
- **`"sensitive"` tools always require human approval.** `needsApproval` returns `true` for
  `"sensitive"` regardless of settings, so a forged `settings` message from a hostile page
  cannot globally disable the gate — settings can only make approval *stricter* (e.g. also
  approve plain writes), never weaker.
- **A poisoned recipe served by the backend.** Remote recipes are re-validated in the isolated
  world before they ever reach the page: malformed recipes are dropped, `js` actions are
  stripped (only bundled first-party recipes may script the page), and tool names that collide
  with the generic layer are removed. The worker enforces the same rules — this is defense in depth.
- **Overwriting the shared first-party library.** The seeded recipes (`youtube`, `twitch`, …)
  are read-only over the API (`PROTECTED_IDS`), so nobody can repoint `youtube` for every user.
  Overwrites and deletes (`PUT`/`DELETE`) require a known browser `Origin`; an origin-less client
  (curl, a server) is refused, so the library can't be rewritten with a one-line script. An
  origin-less **`POST`** (create) is the one exception: the extension's background service worker
  creates fresh-id *user* recipes and cannot present an `Origin`. A create is low-risk because the
  server assigns the id and a duplicate id `409`s — a create can only add a new recipe, never
  clobber or remove an existing one, so overwrite/delete still need a trusted origin.
- **Prompt injection via page content.** Every tool that returns scraped page text sets
  `untrustedContentHint: true`, and `describe_page`/`find_text`/chat-reading tools say so in
  their descriptions, so the agent treats returned content as data, not instructions.
- **The page clicking its own approval button.** The badge is a **closed** shadow DOM, so page
  scripts cannot reach the approve/deny controls.

## Remote control

The extension can "arm" a single browser tab so a remote device (a phone on the
`/remote/:code` page) can call that tab's WebMCP tools through a relay Durable Object.
The trust model:

- **Nothing is controllable until a human arms a tab.** Arming is an explicit action in
  the extension popup, on the target device, for the popup's current tab. No page, recipe,
  or backend can arm a tab. Disarming (a button, closing the tab, or the browser session
  ending) tears the connection down immediately.
- **Sensitive tools are blocked over remote control, in two independent places.** The
  background service worker refuses to forward a `call` for any tool whose summary is
  `"sensitive"`, and `main-world.ts` re-checks the *effective* sensitivity (the authority)
  and refuses to run one even if the background were bypassed. So the remote surface is
  reads and plain writes only; anything that submits a form, navigates, or runs `js` stays
  on the target device and cannot be triggered remotely.
- **The room code is unguessable.** It is 8 characters from a 30-symbol unambiguous alphabet
  (`ROOM_CODE_ALPHABET`, no `0/O/1/I/l`) drawn from `crypto.getRandomValues` — ~2^49 of
  entropy — and only one tab may be armed at a time.

**Residual risk (stated honestly):** anyone who learns the code can drive the armed tab's
non-sensitive tools until it is disarmed — the relay authenticates by knowledge of the code,
nothing more. Blast radius is one tab's read/write tools (never sensitive ones), the code is
single-tab and unguessable rather than enumerable, and the badge logs every remotely-triggered
call. Users should treat the code like a short-lived shared secret and disarm when done.

## Known residual limitation (stated honestly)

Because `main-world.ts` shares the page's realm, a **malicious page** can post a forged
`approval-response` for a specific in-flight `callId` — there is no realm-private channel between
the isolated and main worlds over `window.postMessage` that the page cannot observe. This means
the human-approval guarantee holds against a *recipe* or the *backend*, but a page that is itself
hostile **and** is being driven by a prompt-injected agent could auto-approve a sensitive call it
provoked. Mitigations in place: the "sensitive"-always-prompts floor limits which calls this
applies to, and the visible badge log makes any such call observable. Fully closing it needs an
unforgeable isolated↔main channel (e.g. a nonce injected out-of-band), which is future work.

User recipes are limited to declarative actions (no arbitrary JS) and are subject to the approval
gate above, so the blast radius of a malicious *user-authored* recipe is a declarative
navigate/click/type sequence that a human is asked to approve when it is state-changing.
