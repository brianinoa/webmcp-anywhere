/**
 * In-page badge: a floating pill ("⚡ N tools") in a closed Shadow DOM. Click
 * to expand a panel with registered tools, a live call log, and approval cards.
 * Vanilla DOM only.
 */
import type { MainToIsolated, Recipe, ToolSummary } from "@webmcp-anywhere/shared";
import { summarize, type SavedRecipeResult } from "../messaging";
import { buildDraftRecipe } from "../recipes/draft";
import { BADGE_CSS } from "./styles";

type ToolCall = Extract<MainToIsolated, { type: "tool-call" }>;
type ToolResult = Extract<MainToIsolated, { type: "tool-result" }>;
type ApprovalRequest = Extract<MainToIsolated, { type: "approval-request" }>;

/** Saves a draft recipe via the content script's runtime channel (never fetches from the badge). */
export type RecipeSaver = (recipe: Recipe) => Promise<SavedRecipeResult>;

export interface Badge {
  setVisible(visible: boolean): void;
  setStatus(hasModelContext: boolean, url: string): void;
  setTools(tools: ToolSummary[]): void;
  onCall(msg: ToolCall): void;
  onResult(msg: ToolResult): void;
  requestApproval(msg: ApprovalRequest, respond: (approved: boolean) => void): void;
  /** Wire the save path (content script owns the runtime channel) and the Studio base URL for links. */
  setRecipeSaver(save: RecipeSaver): void;
  setStudioBase(base: string): void;
}

interface LogEntry {
  callId: string;
  tool: string;
  input: unknown;
  status: "running" | "ok" | "err";
  text: string;
  ms?: number;
}

const LOG_LIMIT = 30;

const BOLT_SVG =
  '<svg class="bolt" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.5 4.5 9h3l-1 5.5L11.5 7h-3z" fill="#facc15"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createBadge(opts: { visible: boolean }): Badge {
  const host = document.createElement("webmcp-anywhere-badge");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = BADGE_CSS;
  shadow.appendChild(style);

  const root = el("div", "root" + (opts.visible ? "" : " hidden"));
  const pill = el("button", "pill off");
  pill.innerHTML = BOLT_SVG;
  const dot = el("span", "dot off");
  const label = el("span", "", "WebMCP");
  pill.append(dot, label);
  pill.title = "WebMCP Anywhere — click for tools and activity";

  const panel = el("div", "panel closed");
  const hdr = el("div", "hdr");
  const title = el("b", "", "WebMCP Anywhere");
  const status = el("span", "muted", "waiting…");
  const closeBtn = el("button", "small", "close");
  hdr.append(title, status, closeBtn);
  const approvals = el("div");
  const toolsSec = el("div", "sec");
  const toolsHdr = el("div", "sec-hdr");
  toolsHdr.append(el("h4", "", "Tools"));
  const buildBtn = el("button", "small build", "＋ Build recipe");
  buildBtn.title = "Scan this page and draft a WebMCP recipe you can save and edit in Studio";
  toolsHdr.append(buildBtn);
  toolsSec.append(toolsHdr);
  const draftHost = el("div");
  toolsSec.append(draftHost);
  const toolsList = el("div");
  toolsSec.append(toolsList);
  const logSec = el("div", "sec");
  logSec.append(el("h4", "", "Activity"));
  const logList = el("div", "log");
  logSec.append(logList);
  panel.append(hdr, approvals, toolsSec, logSec);
  root.append(panel, pill);
  shadow.appendChild(root);
  (document.body ?? document.documentElement).appendChild(host);

  let open = false;
  const setOpen = (v: boolean) => {
    open = v;
    panel.classList.toggle("closed", !open);
  };
  pill.addEventListener("click", () => setOpen(!open));
  closeBtn.addEventListener("click", () => setOpen(false));

  let tools: ToolSummary[] = [];
  const entries: LogEntry[] = [];
  let hasMc = false;
  let running = 0;
  let pending = 0;
  let recipeSaver: RecipeSaver | null = null;
  let studioBase = "";

  // ---- "Build a recipe from this page" ------------------------------------
  function openDraft() {
    setOpen(true);
    draftHost.replaceChildren();
    let draft: Recipe;
    try {
      draft = buildDraftRecipe();
    } catch (err) {
      draftHost.append(el("div", "draft err", `Could not scan this page: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    renderDraftCard(draft);
  }

  function renderDraftCard(draft: Recipe) {
    draftHost.replaceChildren();
    const card = el("div", "draft");
    card.append(el("div", "draft-name", draft.name));
    card.append(el("div", "muted", `${draft.tools.length} tool${draft.tools.length === 1 ? "" : "s"} · review before relying on these`));
    const list = el("div", "draft-tools");
    for (const t of draft.tools) list.append(el("span", "draft-chip", t.name));
    card.append(list);
    const status = el("div", "draft-status");
    const btns = el("div", "btns");
    const cancel = el("button", "deny", "Cancel");
    const save = el("button", "approve", "Quick save");
    cancel.addEventListener("click", () => draftHost.replaceChildren());
    save.addEventListener("click", async () => {
      if (!recipeSaver) {
        status.textContent = "Save channel unavailable — reload the page and try again.";
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      status.textContent = "Saving…";
      let result: SavedRecipeResult;
      try {
        result = await recipeSaver(draft);
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (result.ok) {
        renderSaved(result.recipe);
      } else {
        status.textContent = `Save failed: ${result.error}`;
        save.disabled = false;
        cancel.disabled = false;
      }
    });
    btns.append(cancel, save);
    card.append(status, btns);
    draftHost.append(card);
  }

  function renderSaved(saved: Recipe) {
    draftHost.replaceChildren();
    const card = el("div", "draft saved");
    card.append(el("div", "draft-name", `Saved as ${saved.id} ✓`));
    card.append(el("div", "muted", "Tools will appear on this page shortly."));
    if (studioBase) {
      const link = document.createElement("a");
      link.className = "draft-link";
      link.href = `${studioBase.replace(/\/+$/, "")}/recipes/${encodeURIComponent(saved.id)}/edit`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Edit in Studio ↗";
      card.append(link);
    }
    const btns = el("div", "btns");
    const done = el("button", "deny", "Close");
    done.addEventListener("click", () => draftHost.replaceChildren());
    btns.append(done);
    card.append(btns);
    draftHost.append(card);
  }

  buildBtn.addEventListener("click", openDraft);

  function renderPill() {
    label.textContent = hasMc ? `${tools.length} tool${tools.length === 1 ? "" : "s"}` : "WebMCP off";
    pill.classList.toggle("off", !hasMc);
    pill.classList.toggle("busy", running > 0);
    dot.className = "dot " + (pending > 0 ? "pending" : hasMc ? "" : "off");
  }

  function renderTools() {
    toolsList.replaceChildren();
    if (!tools.length) {
      toolsList.append(el("div", "empty", hasMc ? "No tools registered yet." : "document.modelContext unavailable — enable chrome://flags/#enable-webmcp-testing."));
      return;
    }
    for (const t of tools) {
      const row = el("div", "tool");
      const name = el("span", "name", t.name);
      name.title = t.description;
      row.append(name);
      if (t.source === "recipe") row.append(el("span", "chip recipe", t.recipeId ?? "recipe"));
      row.append(el("span", `chip ${t.sensitivity}`, t.sensitivity));
      toolsList.append(row);
    }
  }

  function renderLog() {
    logList.replaceChildren();
    if (!entries.length) {
      logList.append(el("div", "empty", "No tool calls yet."));
      return;
    }
    for (const e of entries.slice().reverse()) {
      const row = el("div", `entry ${e.status}`);
      const top = el("div", "top");
      top.append(el("span", "name", e.tool));
      if (e.ms !== undefined) top.append(el("span", "ms", `${e.ms} ms`));
      row.append(top);
      const inputStr = summarize(e.input, 120);
      if (inputStr && inputStr !== "{}") row.append(el("div", "body", `→ ${inputStr}`));
      if (e.text) row.append(el("div", "body", `← ${e.text}`));
      logList.append(row);
    }
  }

  const api: Badge = {
    setVisible(visible) {
      root.classList.toggle("hidden", !visible);
    },
    setStatus(has, url) {
      hasMc = has;
      status.textContent = has ? new URL(url).host : "no modelContext";
      renderPill();
      renderTools();
    },
    setTools(list) {
      tools = list;
      renderPill();
      renderTools();
    },
    onCall(msg) {
      entries.push({ callId: msg.callId, tool: msg.tool, input: msg.input, status: "running", text: "" });
      if (entries.length > LOG_LIMIT) entries.shift();
      running += 1;
      renderPill();
      renderLog();
    },
    onResult(msg) {
      const e = entries.find((x) => x.callId === msg.callId);
      if (e) {
        e.status = msg.ok ? "ok" : "err";
        e.text = msg.ok ? summarize(msg.result, 200) : (msg.error ?? "error");
        e.ms = msg.durationMs;
      }
      running = Math.max(0, running - 1);
      renderPill();
      renderLog();
    },
    requestApproval(msg, respond) {
      pending += 1;
      setOpen(true);
      renderPill();
      const card = el("div", "approval");
      const head = el("div");
      head.append("Agent wants to run ", el("b", "", msg.tool));
      const pre = el("pre");
      let pretty: string;
      try {
        pretty = JSON.stringify(msg.input ?? {}, null, 2);
      } catch {
        pretty = String(msg.input);
      }
      pre.textContent = pretty;
      const btns = el("div", "btns");
      const deny = el("button", "deny", "Deny");
      const approve = el("button", "approve", "Approve");
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        pending = Math.max(0, pending - 1);
        card.remove();
        renderPill();
        respond(ok);
      };
      deny.addEventListener("click", () => finish(false));
      approve.addEventListener("click", () => finish(true));
      btns.append(deny, approve);
      card.append(head, pre, btns);
      approvals.append(card);
      approve.focus();
      // Auto-deny slightly before the main-world timeout so the card doesn't linger.
      setTimeout(() => finish(false), 58_000);
    },
    setRecipeSaver(save) {
      recipeSaver = save;
    },
    setStudioBase(base) {
      studioBase = base;
    },
  };

  renderPill();
  renderTools();
  renderLog();
  return api;
}
