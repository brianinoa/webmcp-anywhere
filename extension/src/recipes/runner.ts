/**
 * Recipe action runner.
 *
 * Executes a RecipeTool's declarative actions against the live DOM (MAIN world)
 * and returns a compact JSON string the calling agent can verify against.
 *
 * Additions on top of the shared RecipeAction contract (all additive, see
 * recipes/README.md):
 *   - selector pseudo-extensions `:text=` and `:nth=` (resolveElement)
 *   - template builtins `{{$origin}}`, `{{$host}}`, `{{$pathname}}`, `{{$href}}`, `{{$repo}}`
 *   - read: `following?: number` (read the N block elements after the match),
 *           `limit?: number | string` (cap for `all: true`, may be a template)
 *   - media: op `"state"` (read-only), `value?: number | string` (template ok),
 *            `relative?: boolean` (seek by offset instead of absolute time)
 */
import type { RecipeAction, RecipeTool } from "@webmcp-anywhere/shared";

// ---------------------------------------------------------------------------
// Extended action types (superset of shared RecipeAction)
// ---------------------------------------------------------------------------

type SharedRead = Extract<RecipeAction, { kind: "read" }>;
type SharedMedia = Extract<RecipeAction, { kind: "media" }>;

export type ReadAction = SharedRead & {
  /** Read the next N block elements (default `p`) that follow the matched element in document order. */
  following?: number;
  /** Cap for `all: true` results (1..50). May be a `{{param}}` template. */
  limit?: number | string;
};

export type MediaAction = Omit<SharedMedia, "op" | "value"> & {
  op: SharedMedia["op"] | "state";
  /** Number or `{{param}}` template. */
  value?: number | string;
  /** For `seek`: treat `value` as an offset from currentTime (negative rewinds). */
  relative?: boolean;
};

export type ExtRecipeAction = Exclude<RecipeAction, { kind: "read" | "media" }> | ReadAction | MediaAction;

export interface RunOptions {
  /** Allow `js` actions (first-party bundled recipes only). Default false. */
  allowJs?: boolean;
  /** Overall timebox in ms. Default 15000. */
  timeoutMs?: number;
}

export interface MediaState {
  paused: boolean;
  currentTime: number;
  duration: number | null;
  playbackRate: number;
  volume: number;
  muted: boolean;
  src?: string;
}

export const RUN_TIMEOUT_MS = 15_000;
export const WAIT_MAX_MS = 10_000;
export const READ_ALL_CAP = 50;
const CLICK_SETTLE_MS = 300;

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*(\$?[A-Za-z0-9_.-]+)\s*\}\}/g;

/** Values for `{{$builtin}}` placeholders, derived from the current location. */
export function builtins(loc: Location | URL = location): Record<string, string> {
  const pathname = loc.pathname;
  const segs = pathname.split("/").filter(Boolean);
  const out: Record<string, string> = {
    $origin: loc.origin,
    $host: loc.host,
    $pathname: pathname,
    $href: loc.href,
  };
  // $repo: "owner/name" for GitHub-style URLs (first two path segments).
  if (segs.length >= 2 && !segs[0].startsWith(".") && /^[A-Za-z0-9_.-]+$/.test(segs[0]) && /^[A-Za-z0-9_.-]+$/.test(segs[1])) {
    out.$repo = `${segs[0]}/${segs[1]}`;
  }
  return out;
}

export interface SubstituteOptions {
  /** Treat the template as a URL: params in the query string are encodeURIComponent'd, params in the path are segment-encoded. */
  url?: boolean;
  /** Extra values (e.g. builtins) checked before `input`. Keys typically start with `$`. */
  extra?: Record<string, string>;
}

/**
 * Replace `{{param}}` placeholders in `template` with values from `input`.
 * Throws when a placeholder has no value. `{{$name}}` placeholders resolve from
 * `opts.extra` (defaults to location-derived builtins) and are never encoded.
 */
export function substitute(template: string, input: Record<string, unknown>, opts: SubstituteOptions = {}): string {
  const extra = opts.extra ?? (typeof location !== "undefined" ? builtins() : {});
  const queryStart = opts.url ? template.indexOf("?") : -1;
  return template.replace(PLACEHOLDER_RE, (_m, name: string, offset: number) => {
    if (name.startsWith("$")) {
      const v = extra[name];
      if (v === undefined) {
        throw new Error(name === "$repo"
          ? "{{$repo}} is unavailable: the current URL is not an owner/name repository page"
          : `Unknown builtin placeholder {{${name}}}`);
      }
      return v;
    }
    const raw = input[name];
    if (raw === undefined || raw === null) throw new Error(`Missing required parameter "${name}"`);
    const s = typeof raw === "string" ? raw : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    if (!opts.url) return s;
    if (queryStart >= 0 && offset > queryStart) return encodeURIComponent(s);
    return s.split("/").map(encodeURIComponent).join("/");
  });
}

/** Names of all non-builtin placeholders used anywhere in a tool's actions. */
export function placeholdersIn(actions: RecipeAction[]): string[] {
  const names = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(PLACEHOLDER_RE)) if (!m[1].startsWith("$")) names.add(m[1]);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) visit(x);
    }
  };
  visit(actions);
  return [...names];
}

// ---------------------------------------------------------------------------
// Selector resolution (CSS + `:text=` + `:nth=` extensions)
// ---------------------------------------------------------------------------

interface ParsedSelector {
  css: string;
  text?: string;
  nth?: number;
}

function parseSelector(selector: string): ParsedSelector {
  let css = selector.trim();
  let text: string | undefined;
  let nth: number | undefined;
  // `:nth=N` must be last (or followed only by whitespace)
  const nthM = css.match(/:nth=(\d+)\s*$/);
  if (nthM) {
    nth = parseInt(nthM[1], 10);
    css = css.slice(0, nthM.index).trim();
  }
  const ti = css.indexOf(":text=");
  if (ti >= 0) {
    let t = css.slice(ti + ":text=".length).trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
    text = t;
    css = css.slice(0, ti).trim() || "*";
  }
  return { css, text, nth };
}

function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Resolve every element matching `selector`. Supports:
 *   - plain CSS (including comma lists)
 *   - `base:text=Some words`  — elements whose text contains the words (case-insensitive;
 *                               exact matches are ordered first)
 *   - `base:nth=N`            — the N-th (1-based) match of the preceding selector
 */
export function resolveElements(selector: string, root: ParentNode = document): Element[] {
  const { css, text, nth } = parseSelector(selector);
  let els: Element[];
  try {
    els = Array.from(root.querySelectorAll(css));
  } catch {
    throw new Error(`Invalid selector: ${selector}`);
  }
  if (text !== undefined) {
    const needle = norm(text).toLowerCase();
    const exact: Element[] = [];
    const partial: Element[] = [];
    for (const el of els) {
      const t = norm(el.textContent).toLowerCase();
      if (t === needle) exact.push(el);
      else if (t.includes(needle)) partial.push(el);
    }
    els = [...exact, ...partial];
  }
  if (nth !== undefined) {
    if (nth < 1) throw new Error(`:nth= index must be >= 1 (got ${nth})`);
    const el = els[nth - 1];
    els = el ? [el] : [];
  }
  return els;
}

/** Resolve the first element matching `selector` (see resolveElements), or null. */
export function resolveElement(selector: string, root: ParentNode = document): Element | null {
  return resolveElements(selector, root)[0] ?? null;
}

function mustResolve(selector: string): Element {
  const el = resolveElement(selector);
  if (!el) throw new Error(`No element matches selector: ${selector}`);
  return el;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const text = norm(el.textContent).slice(0, 60);
  return `${tag}${id}${text ? ` "${text}"` : ""}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" ? reason : "Recipe run aborted");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function toNumber(v: number | string | undefined, what: string, input: Record<string, unknown>): number {
  if (v === undefined) throw new Error(`${what} requires a numeric value`);
  const s = typeof v === "string" ? substitute(v, input) : v;
  const n = typeof s === "number" ? s : parseFloat(s);
  if (!Number.isFinite(n)) throw new Error(`${what}: "${v}" is not a number`);
  return n;
}

function isHidden(el: Element): boolean {
  const he = el as HTMLElement;
  if (typeof getComputedStyle !== "function") return false;
  const cs = getComputedStyle(he);
  return cs.display === "none" || cs.visibility === "hidden";
}

/** Set a form control's value via the prototype setter so React/Vue/Angular observe the change. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else (el as HTMLInputElement).value = value;
}

function fire(el: Element, type: string, init: EventInit & Record<string, unknown> = {}): void {
  const isKey = type.startsWith("key");
  const ev = isKey && typeof KeyboardEvent === "function"
    ? new KeyboardEvent(type, { bubbles: true, cancelable: true, composed: true, ...init })
    : new Event(type, { bubbles: true, cancelable: true, composed: true, ...init });
  el.dispatchEvent(ev);
}

function mediaState(m: HTMLMediaElement): MediaState {
  const duration = Number.isFinite(m.duration) ? round(m.duration) : null;
  const st: MediaState = {
    paused: m.paused,
    currentTime: round(m.currentTime),
    duration,
    playbackRate: m.playbackRate,
    volume: round(m.volume),
    muted: m.muted,
  };
  if (m.currentSrc) st.src = m.currentSrc.slice(0, 200);
  return st;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function findMedia(selector?: string): HTMLMediaElement {
  if (selector) {
    const el = mustResolve(selector);
    if (!(el instanceof HTMLMediaElement)) throw new Error(`Selector did not match a <video>/<audio>: ${selector}`);
    return el;
  }
  const all = Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio"));
  if (all.length === 0) throw new Error("No <video> or <audio> element on this page");
  return all.find((m) => !m.paused) ?? all.find((m) => m.readyState > 0) ?? all[0];
}

const HEADINGS = "h1,h2,h3,h4,h5,h6";

function headingLevel(el: Element): number | null {
  const m = /^H([1-6])$/.exec(el.tagName);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Collect up to `count` block elements (`p` by default) after `start` in document
 * order, stopping at the next heading of the same or higher level than `start`
 * (or any heading if `start` is not one).
 */
function collectFollowing(start: Element, count: number, match = "p"): Element[] {
  const level = headingLevel(start) ?? 7;
  const candidates = document.querySelectorAll(`${match},${HEADINGS}`);
  const out: Element[] = [];
  for (const c of Array.from(candidates)) {
    if (c === start) continue;
    const pos = start.compareDocumentPosition(c);
    if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING) || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) continue;
    const lvl = headingLevel(c);
    if (lvl !== null && lvl <= level) break;
    if (lvl === null && c.matches(match)) {
      const t = norm(c.textContent);
      if (t) out.push(c);
      if (out.length >= count) break;
    }
  }
  return out;
}

function readValue(el: Element, attribute?: string): string {
  if (attribute) {
    const v = el.getAttribute(attribute) ?? "";
    if ((attribute === "href" || attribute === "src") && v) {
      try { return new URL(v, location.href).href; } catch { /* keep raw */ }
    }
    return v;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return norm(el.textContent);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface RunContext {
  input: Record<string, unknown>;
  signal: AbortSignal;
  did: string[];
  reads: Record<string, unknown>;
  allowJs: boolean;
}

/** Fill in `default`s from the tool's inputSchema for params the caller omitted. */
function withDefaults(tool: RecipeTool, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(input ?? {}) };
  const props = tool.inputSchema?.properties ?? {};
  for (const [k, schema] of Object.entries(props)) {
    if (out[k] === undefined && schema && schema.default !== undefined) out[k] = schema.default;
  }
  return out;
}

/**
 * Execute `tool.actions` in order against the live DOM. Resolves to a JSON string:
 *   { ok: true, tool, did: string[], ...reads }   — reads keyed by their `as` (default "result");
 *   media actions add a `media` state object; `navigate` returns early with `navigated: url`.
 * Rejects with a descriptive Error on the first failing action, on abort, or after the 15s timebox.
 */
export async function runRecipeTool(
  tool: RecipeTool,
  input: Record<string, unknown>,
  signal: AbortSignal,
  options: RunOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Recipe tool "${tool.name}" timed out after ${timeoutMs}ms`)), timeoutMs);
  const onOuterAbort = () => ctrl.abort(abortError(signal));
  if (signal.aborted) onOuterAbort();
  else signal.addEventListener("abort", onOuterAbort, { once: true });

  const ctx: RunContext = {
    input: withDefaults(tool, input),
    signal: ctrl.signal,
    did: [],
    reads: {},
    allowJs: options.allowJs ?? false,
  };

  try {
    for (let i = 0; i < tool.actions.length; i++) {
      throwIfAborted(ctx.signal);
      const action = tool.actions[i] as ExtRecipeAction;
      let early: string | undefined;
      try {
        early = await runAction(action, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${tool.name}: action ${i + 1}/${tool.actions.length} (${action.kind}) failed: ${msg}`);
      }
      if (early !== undefined) {
        return JSON.stringify({ ok: true, tool: tool.name, did: ctx.did, navigated: early, ...ctx.reads });
      }
    }
    return JSON.stringify({ ok: true, tool: tool.name, did: ctx.did, ...ctx.reads });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onOuterAbort);
  }
}

/** Runs one action. Returns a string only for `navigate` (the target URL) to signal early return. */
async function runAction(action: ExtRecipeAction, ctx: RunContext): Promise<string | undefined> {
  const { input, signal } = ctx;
  const sub = (s: string) => substitute(s, input);

  switch (action.kind) {
    case "click": {
      const selector = sub(action.selector);
      const el = mustResolve(selector);
      (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
      (el as HTMLElement).focus?.();
      (el as HTMLElement).click();
      ctx.did.push(`clicked ${describe(el)}`);
      await sleep(CLICK_SETTLE_MS, signal);
      return;
    }

    case "type": {
      const selector = sub(action.selector);
      const value = sub(action.value);
      const el = mustResolve(selector);
      (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
      (el as HTMLElement).focus?.();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        setNativeValue(el, value);
        fire(el, "input", { data: value, inputType: "insertText" });
        fire(el, "change");
      } else if ((el as HTMLElement).isContentEditable) {
        el.textContent = value;
        fire(el, "input", { data: value, inputType: "insertText" });
      } else {
        throw new Error(`Element is not typeable: ${describe(el)}`);
      }
      ctx.did.push(`typed ${JSON.stringify(value.slice(0, 80))} into ${describe(el)}`);
      if (action.submit) {
        const keyInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13 };
        fire(el, "keydown", keyInit);
        fire(el, "keypress", keyInit);
        fire(el, "keyup", keyInit);
        const form = (el as HTMLInputElement).form ?? el.closest("form");
        if (form) {
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
          ctx.did.push("submitted form");
        } else {
          ctx.did.push("pressed Enter");
        }
        await sleep(CLICK_SETTLE_MS, signal);
      }
      return;
    }

    case "select": {
      const selector = sub(action.selector);
      const value = sub(action.value);
      const el = mustResolve(selector);
      if (!(el instanceof HTMLSelectElement)) throw new Error(`Not a <select>: ${describe(el)}`);
      const opts = Array.from(el.options);
      const match = opts.find((o) => o.value === value)
        ?? opts.find((o) => norm(o.textContent).toLowerCase() === value.toLowerCase())
        ?? opts.find((o) => norm(o.textContent).toLowerCase().includes(value.toLowerCase()));
      if (!match) throw new Error(`No option matching "${value}" in ${describe(el)}; options: ${opts.map((o) => o.value || norm(o.textContent)).slice(0, 20).join(", ")}`);
      setNativeValue(el, match.value);
      fire(el, "input");
      fire(el, "change");
      ctx.did.push(`selected "${norm(match.textContent) || match.value}" in ${describe(el)}`);
      return;
    }

    case "scroll": {
      if (action.selector) {
        const selector = sub(action.selector);
        const el = mustResolve(selector);
        (el as HTMLElement).scrollIntoView?.({ block: "start", inline: "nearest", behavior: "auto" });
        ctx.did.push(`scrolled to ${describe(el)}`);
      } else {
        const to = action.to ?? "top";
        const y = to === "bottom" ? document.documentElement.scrollHeight : 0;
        window.scrollTo(0, y);
        ctx.did.push(`scrolled to ${to}`);
      }
      return;
    }

    case "navigate": {
      const url = substitute(action.url, input, { url: true });
      let abs: URL;
      try { abs = new URL(url, location.href); } catch { throw new Error(`Invalid URL: ${url}`); }
      if (abs.protocol !== "https:" && abs.protocol !== "http:") throw new Error(`Refusing to navigate to non-http(s) URL: ${abs.href}`);
      ctx.did.push(`navigating to ${abs.href}`);
      location.assign(abs.href);
      return abs.href;
    }

    case "wait": {
      if (action.selector) {
        const selector = sub(action.selector);
        const max = Math.min(action.ms ?? WAIT_MAX_MS, WAIT_MAX_MS);
        const start = Date.now();
        for (;;) {
          throwIfAborted(signal);
          const el = resolveElement(selector);
          if (el && !isHidden(el)) {
            ctx.did.push(`waited ${Date.now() - start}ms for ${describe(el)}`);
            return;
          }
          if (Date.now() - start >= max) throw new Error(`Timed out after ${max}ms waiting for selector: ${selector}`);
          await sleep(100, signal);
        }
      }
      const ms = Math.min(Math.max(action.ms ?? 0, 0), WAIT_MAX_MS);
      await sleep(ms, signal);
      ctx.did.push(`waited ${ms}ms`);
      return;
    }

    case "read": {
      const a = action as ReadAction;
      const selector = sub(a.selector);
      const key = a.as ?? "result";
      if (a.following !== undefined) {
        const el = mustResolve(selector);
        let n = Math.min(Math.max(a.following, 1), READ_ALL_CAP);
        if (a.limit !== undefined) n = Math.min(n, Math.max(Math.floor(toNumber(a.limit, "read.limit", input)), 1));
        const blocks = collectFollowing(el, n);
        ctx.reads[key] = blocks.map((b) => readValue(b, a.attribute));
        ctx.did.push(`read ${blocks.length} block(s) after ${describe(el)} as "${key}"`);
        return;
      }
      if (a.all) {
        const limit = a.limit === undefined ? READ_ALL_CAP : Math.min(Math.max(Math.floor(toNumber(a.limit, "read.limit", input)), 1), READ_ALL_CAP);
        const els = resolveElements(selector).slice(0, limit);
        ctx.reads[key] = els.map((e) => readValue(e, a.attribute));
        ctx.did.push(`read ${els.length} element(s) matching ${selector} as "${key}"`);
        return;
      }
      const el = resolveElement(selector);
      if (!el) {
        ctx.reads[key] = null;
        ctx.did.push(`nothing matched ${selector} (${key} = null)`);
        return;
      }
      ctx.reads[key] = readValue(el, a.attribute);
      ctx.did.push(`read ${describe(el)} as "${key}"`);
      return;
    }

    case "media": {
      const a = action as MediaAction;
      const m = findMedia(a.selector ? sub(a.selector) : undefined);
      const tag = m.tagName.toLowerCase();
      switch (a.op) {
        case "state":
          ctx.did.push(`read ${tag} state`);
          break;
        case "play":
          await playSafely(m);
          ctx.did.push(`played ${tag}`);
          break;
        case "pause":
          m.pause();
          ctx.did.push(`paused ${tag}`);
          break;
        case "toggle":
          if (m.paused) { await playSafely(m); ctx.did.push(`played ${tag}`); }
          else { m.pause(); ctx.did.push(`paused ${tag}`); }
          break;
        case "seek": {
          const v = toNumber(a.value, "media seek", input);
          let target = a.relative ? m.currentTime + v : v;
          if (target < 0) target = 0;
          if (Number.isFinite(m.duration) && target > m.duration) target = m.duration;
          m.currentTime = target;
          ctx.did.push(`${a.relative ? `skipped ${v >= 0 ? "+" : ""}${v}s to` : "seeked to"} ${round(target)}s`);
          break;
        }
        case "rate": {
          const v = toNumber(a.value, "media rate", input);
          if (v <= 0 || v > 16) throw new Error(`playback rate out of range (0, 16]: ${v}`);
          m.playbackRate = v;
          ctx.did.push(`set playback rate to ${v}`);
          break;
        }
        case "volume": {
          const v = toNumber(a.value, "media volume", input);
          if (v < 0 || v > 1) throw new Error(`volume must be between 0 and 1: ${v}`);
          m.volume = v;
          if (v > 0 && m.muted) m.muted = false;
          ctx.did.push(`set volume to ${v}`);
          break;
        }
        case "mute":
          m.muted = a.value === undefined ? !m.muted : toNumber(a.value, "media mute", input) !== 0;
          ctx.did.push(m.muted ? `muted ${tag}` : `unmuted ${tag}`);
          break;
        default:
          throw new Error(`Unknown media op: ${String((a as { op: unknown }).op)}`);
      }
      await sleep(50, signal);
      ctx.reads.media = mediaState(m);
      return;
    }

    case "js": {
      if (!ctx.allowJs) throw new Error("js actions are not allowed in remote recipes");
      // First-party only. Evaluate with (input, document) in scope; result stored under "js".
      const fn = new Function("input", "document", "window", action.fn);
      const out = await fn(input, document, window);
      ctx.reads.js = out ?? null;
      ctx.did.push("ran js");
      return;
    }

    default:
      throw new Error(`Unknown action kind: ${String((action as { kind: unknown }).kind)}`);
  }
}

async function playSafely(m: HTMLMediaElement): Promise<void> {
  try {
    const p = m.play();
    if (p && typeof (p as Promise<void>).then === "function") await p;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`play() was rejected (autoplay policy or no source): ${msg}`);
  }
}
