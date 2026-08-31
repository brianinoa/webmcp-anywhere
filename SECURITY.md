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
  Mutations require a known browser `Origin`; an origin-less client (curl, a server) is refused,
  so the library can't be rewritten with a one-line script.
- **Prompt injection via page content.** Every tool that returns scraped page text sets
  `untrustedContentHint: true`, and `describe_page`/`find_text`/chat-reading tools say so in
  their descriptions, so the agent treats returned content as data, not instructions.
- **The page clicking its own approval button.** The badge is a **closed** shadow DOM, so page
  scripts cannot reach the approve/deny controls.

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
