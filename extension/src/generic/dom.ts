/**
 * DOM helpers for the generic tools: stable element refs, visibility checks,
 * element resolution (ref / text / label / selector) and framework-friendly
 * value setting. Pure DOM, no chrome.* APIs, so it is unit-testable in jsdom.
 */

export const REF_ATTR = "data-wma-ref";

let refCounter = 0;
const refMap = new WeakMap<Element, string>();

/** Return the element's ref, assigning one (stamped as data-wma-ref) if needed. */
export function assignRef(el: Element): string {
  const existing = el.getAttribute(REF_ATTR);
  if (existing) return existing;
  const known = refMap.get(el);
  if (known) {
    el.setAttribute(REF_ATTR, known);
    return known;
  }
  refCounter += 1;
  const ref = `e${refCounter}`;
  refMap.set(el, ref);
  el.setAttribute(REF_ATTR, ref);
  return ref;
}

export function byRef(ref: string): Element | null {
  const clean = ref.trim();
  if (!clean) return null;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(clean) : clean.replace(/["\\]/g, "\\$&");
  return document.querySelector(`[${REF_ATTR}="${escaped}"]`);
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
  if (el.closest("[hidden],[aria-hidden='true']")) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  if (typeof el.getClientRects === "function") {
    const rects = el.getClientRects();
    // jsdom returns empty rects for everything; treat "no layout engine" as visible.
    if (rects.length === 0 && typeof (el as HTMLElement).offsetParent !== "undefined" && (el as HTMLElement).offsetParent === null && !isJsdom()) {
      return false;
    }
  }
  return true;
}

function isJsdom(): boolean {
  return typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
}

export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Visible text for an element, capped. */
export function visibleText(el: Element, max = 80): string {
  let t = normalizeText((el as HTMLElement).innerText ?? el.textContent);
  if (!t) {
    t = normalizeText(
      el.getAttribute("aria-label") ??
        el.getAttribute("title") ??
        el.getAttribute("alt") ??
        (el as HTMLInputElement).value ??
        el.getAttribute("placeholder"),
    );
  }
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Best-effort accessible label for a form control. */
export function labelFor(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return normalizeText(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const txt = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (normalizeText(txt)) return normalizeText(txt);
  }
  if ("labels" in el) {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const t = normalizeText(Array.from(labels).map((l) => l.textContent).join(" "));
      if (t) return t;
    }
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const t = normalizeText(wrapping.textContent);
    if (t) return t;
  }
  return normalizeText(
    el.getAttribute("placeholder") ?? el.getAttribute("name") ?? el.getAttribute("title") ?? el.getAttribute("id"),
  );
}

export const CLICKABLE_SELECTOR =
  "button, a[href], [role='button'], [role='link'], [role='menuitem'], [role='tab'], input[type='submit'], input[type='button'], input[type='reset'], summary, [onclick]";

export const FIELD_SELECTOR =
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']), textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox'], [role='searchbox']";

export interface ResolveOptions {
  ref?: string;
  text?: string;
  label?: string;
  selector?: string;
  /** Candidate scope for text/label matching. */
  scope?: string;
}

function textMatches(el: Element, query: string): number {
  const q = query.toLowerCase();
  const t = visibleText(el, 500).toLowerCase();
  if (!t) return 0;
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 1;
  return 0;
}

/**
 * Resolve an element from a ref, visible text, label, or CSS selector.
 * Preference order: ref > text/label > selector. Throws with a helpful message.
 */
export function resolveElement(opts: ResolveOptions): Element {
  const { ref, text, label, selector } = opts;
  if (ref) {
    const el = byRef(ref);
    if (!el) throw new Error(`No element with ref "${ref}". Call describe_page again to refresh refs.`);
    return el;
  }
  if (text) {
    const scope = opts.scope ?? CLICKABLE_SELECTOR;
    const candidates = Array.from(document.querySelectorAll(scope)).filter(isVisible);
    let best: { el: Element; score: number } | null = null;
    for (const el of candidates) {
      const score = textMatches(el, text);
      if (score > (best?.score ?? 0)) best = { el, score };
      if (score === 3) break;
    }
    if (!best) throw new Error(`No visible element with text matching "${text}".`);
    return best.el;
  }
  if (label) {
    const scope = opts.scope ?? FIELD_SELECTOR;
    const candidates = Array.from(document.querySelectorAll(scope)).filter(isVisible);
    const q = label.toLowerCase();
    let best: { el: Element; score: number } | null = null;
    for (const el of candidates) {
      const l = labelFor(el).toLowerCase();
      const score = l === q ? 3 : l.startsWith(q) ? 2 : l.includes(q) ? 1 : 0;
      if (score > (best?.score ?? 0)) best = { el, score };
      if (score === 3) break;
    }
    if (!best) throw new Error(`No visible field with label matching "${label}".`);
    return best.el;
  }
  if (selector) {
    let el: Element | null;
    try {
      el = document.querySelector(selector);
    } catch {
      throw new Error(`Invalid CSS selector: ${selector}`);
    }
    if (!el) throw new Error(`No element matches selector "${selector}".`);
    return el;
  }
  throw new Error("Provide one of: ref, text, label, or selector.");
}

/** Set a value on input/textarea using the native setter so React/Vue observe it. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, value);
  else (el as HTMLInputElement).value = value;
}

export function fireInputEvents(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export interface FillResult {
  kind: "input" | "textarea" | "select" | "contenteditable" | "checkbox" | "radio";
  value: string;
}

/** Fill a form control (input/textarea/select/contenteditable/checkbox) with a value. */
export function fillElement(el: Element, value: string | boolean | number): FillResult {
  const str = String(value);
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const on = typeof value === "boolean" ? value : !/^(false|0|off|no|unchecked)$/i.test(str);
    if (el.checked !== on) el.click();
    if (el.checked !== on) {
      el.checked = on;
      fireInputEvents(el);
    }
    return { kind: el.type as "checkbox" | "radio", value: String(el.checked) };
  }
  if (el instanceof HTMLSelectElement) {
    const chosen = selectOption(el, str);
    return { kind: "select", value: chosen };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    setNativeValue(el, str);
    fireInputEvents(el);
    return { kind: el instanceof HTMLTextAreaElement ? "textarea" : "input", value: el.value };
  }
  if ((el as HTMLElement).isContentEditable || el.getAttribute("contenteditable") !== null || el.getAttribute("role") === "textbox") {
    const he = el as HTMLElement;
    he.focus();
    // Try execCommand first (keeps editor frameworks happy), fall back to textContent.
    let ok = false;
    try {
      const sel = window.getSelection();
      sel?.selectAllChildren(he);
      ok = document.execCommand?.("insertText", false, str) ?? false;
    } catch {
      ok = false;
    }
    if (!ok || normalizeText(he.textContent) !== normalizeText(str)) {
      he.textContent = str;
      he.dispatchEvent(new InputEvent("input", { bubbles: true, data: str, inputType: "insertText" }));
    }
    return { kind: "contenteditable", value: normalizeText(he.textContent) };
  }
  throw new Error(`Element <${el.tagName.toLowerCase()}> is not a fillable field.`);
}

/** Choose a <select> option by value or by visible label (case-insensitive, partial allowed). */
export function selectOption(el: HTMLSelectElement, valueOrLabel: string): string {
  const q = valueOrLabel.trim().toLowerCase();
  const options = Array.from(el.options);
  const match =
    options.find((o) => o.value.toLowerCase() === q) ??
    options.find((o) => normalizeText(o.textContent).toLowerCase() === q) ??
    options.find((o) => normalizeText(o.textContent).toLowerCase().includes(q));
  if (!match) {
    const available = options.slice(0, 20).map((o) => normalizeText(o.textContent) || o.value);
    throw new Error(`No option matching "${valueOrLabel}". Available: ${available.join(" | ")}`);
  }
  setNativeValue(el, match.value);
  fireInputEvents(el);
  return normalizeText(match.textContent) || match.value;
}

/** Press Enter on an element (keydown/keypress/keyup), then submit its form if any and not prevented. */
export function pressEnter(el: Element): boolean {
  const init: KeyboardEventInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit;
  const down = el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  if (!down) return true; // page handled it
  const form = (el as HTMLInputElement).form ?? el.closest("form");
  if (form) {
    submitForm(form);
    return true;
  }
  return false;
}

export function submitForm(form: HTMLFormElement): void {
  if (typeof form.requestSubmit === "function") {
    try {
      form.requestSubmit();
      return;
    } catch {
      /* fall through */
    }
  }
  const ev = new Event("submit", { bubbles: true, cancelable: true });
  if (form.dispatchEvent(ev)) form.submit();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const t = visibleText(el, 40);
  return `<${tag}${id}>${t ? ` "${t}"` : ""}`;
}
