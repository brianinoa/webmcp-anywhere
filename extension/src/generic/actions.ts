/** Generic tools that change page state: scroll_to, click, fill_field, select_option, submit_form, navigate, go_back. */
import type { GenericToolDef } from "./types";
import {
  assignRef,
  byRef,
  describeElement,
  fillElement,
  pressEnter,
  resolveElement,
  selectOption,
  sleep,
  submitForm,
  visibleText,
  isVisible,
  normalizeText,
} from "./dom";

const SETTLE_MS = 300;

function pageState() {
  return { title: document.title, url: location.href };
}

/** Track whether a navigation started between two points in time. */
function navigationWatcher() {
  const startUrl = location.href;
  let unloading = false;
  const onUnload = () => {
    unloading = true;
  };
  window.addEventListener("beforeunload", onUnload, { once: true });
  window.addEventListener("pagehide", onUnload, { once: true });
  return {
    done(): boolean {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      return unloading || location.href !== startUrl;
    },
  };
}

export const scrollTo: GenericToolDef = {
  name: "scroll_to",
  title: "Scroll to",
  description:
    "Scroll the page so that a target is in view. Pass exactly one of: `ref` (from describe_page/find_text), `text` (visible text to find and scroll to), or `to` (\"top\" | \"bottom\"). Scrolls smoothly and returns `{scrolledTo, ref?, y}`. Does not change page data.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref such as \"e12\"." },
      text: { type: "string", description: "Visible text to scroll to (case-insensitive substring)." },
      to: { type: "string", enum: ["top", "bottom"], description: "Scroll to the top or bottom of the page." },
    },
    required: [],
  },
  sensitivity: "read",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async (input, signal) => {
    const to = input.to as string | undefined;
    if (to === "top" || to === "bottom") {
      window.scrollTo({ top: to === "top" ? 0 : document.documentElement.scrollHeight, behavior: "smooth" });
      await sleep(SETTLE_MS, signal);
      return { scrolledTo: to, y: Math.round(window.scrollY) };
    }
    let el: Element | null = null;
    if (input.ref) el = byRef(String(input.ref));
    else if (input.text) {
      const q = String(input.text).toLowerCase();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode())) {
        if (n.nodeValue?.toLowerCase().includes(q) && n.parentElement && isVisible(n.parentElement)) {
          el = n.parentElement;
          break;
        }
      }
      if (!el) throw new Error(`No visible text matching "${input.text}".`);
    } else throw new Error("Provide ref, text, or to.");
    if (!el) throw new Error(`No element with ref "${input.ref}". Call describe_page to refresh refs.`);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(SETTLE_MS, signal);
    return { scrolledTo: describeElement(el), ref: assignRef(el), y: Math.round(window.scrollY) };
  },
};

export const click: GenericToolDef = {
  name: "click",
  title: "Click",
  description:
    "Click a button, link, or other clickable element. Pass one of: `ref` (preferred, from describe_page), `text` (visible text of a button/link, exact match preferred, partial accepted), or `selector` (CSS). Scrolls the element into view, dispatches a real click, waits ~300ms, then returns `{clicked, title, url, navigationStarted}`. If navigationStarted is true, call describe_page again on the new page.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref such as \"e12\"." },
      text: { type: "string", description: "Visible text of the button or link." },
      selector: { type: "string", description: "CSS selector, used only if ref and text are absent." },
    },
    required: [],
  },
  sensitivity: "write",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async (input, signal) => {
    const el = resolveElement({ ref: input.ref as string, text: input.text as string, selector: input.selector as string });
    const he = el as HTMLElement;
    const before = pageState();
    const watch = navigationWatcher();
    he.scrollIntoView?.({ block: "center", behavior: "instant" as ScrollBehavior });
    const desc = describeElement(el);
    he.focus?.();
    // Dispatch a realistic pointer sequence so frameworks that listen on pointerdown/mousedown react.
    const opts = { bubbles: true, cancelable: true, composed: true, view: window } as MouseEventInit;
    he.dispatchEvent(new PointerEvent("pointerdown", opts));
    he.dispatchEvent(new MouseEvent("mousedown", opts));
    he.dispatchEvent(new PointerEvent("pointerup", opts));
    he.dispatchEvent(new MouseEvent("mouseup", opts));
    he.click();
    await sleep(SETTLE_MS, signal);
    const after = pageState();
    return {
      clicked: desc,
      ref: assignRef(el),
      ...after,
      navigationStarted: watch.done() || after.url !== before.url,
    };
  },
};

export const fillField: GenericToolDef = {
  name: "fill_field",
  title: "Fill field",
  description:
    "Type a value into a form field (input, textarea, select, or contenteditable editor). Target it with `ref` (preferred), `label` (visible label/placeholder/name text), or `selector` (CSS). Replaces the current value, firing input/change events so React/Vue apps notice. Checkboxes accept true/false. Set `submit: true` to press Enter afterwards (submits the surrounding form / search box). Returns `{field, kind, value, submitted, url}`.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref such as \"e12\"." },
      label: { type: "string", description: "Label, placeholder or name of the field." },
      selector: { type: "string", description: "CSS selector for the field." },
      value: { type: "string", description: "Text to enter. For checkboxes use \"true\"/\"false\"." },
      submit: { type: "boolean", description: "Press Enter after filling (default false)." },
    },
    required: ["value"],
  },
  sensitivity: "write",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async (input, signal) => {
    if (input.value === undefined || input.value === null) throw new Error("value is required");
    const el = resolveElement({ ref: input.ref as string, label: input.label as string, selector: input.selector as string });
    (el as HTMLElement).scrollIntoView?.({ block: "center", behavior: "instant" as ScrollBehavior });
    const res = fillElement(el, input.value as string | boolean | number);
    let submitted = false;
    if (input.submit) {
      await sleep(50, signal);
      submitted = pressEnter(el);
      await sleep(SETTLE_MS, signal);
    }
    return { field: describeElement(el), ref: assignRef(el), kind: res.kind, value: res.value, submitted, url: location.href };
  },
};

export const selectOptionTool: GenericToolDef = {
  name: "select_option",
  title: "Select option",
  description:
    "Choose an option in a <select> dropdown. Target the select with `ref`, `label`, or `selector`; pick the option by `value` (option value attribute) or `optionLabel` (visible option text, case-insensitive, partial allowed). Returns `{field, selected, value}`. For custom (non-<select>) dropdowns use click instead.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref of the <select>." },
      label: { type: "string", description: "Label of the <select>." },
      selector: { type: "string", description: "CSS selector for the <select>." },
      value: { type: "string", description: "Option value to select." },
      optionLabel: { type: "string", description: "Visible option text to select." },
    },
    required: [],
  },
  sensitivity: "write",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async (input) => {
    const el = resolveElement({
      ref: input.ref as string,
      label: input.label as string,
      selector: input.selector as string,
      scope: "select",
    });
    if (!(el instanceof HTMLSelectElement)) throw new Error(`${describeElement(el)} is not a <select>.`);
    const wanted = (input.value ?? input.optionLabel ?? input.label_option) as string | undefined;
    if (!wanted) throw new Error("Provide value or optionLabel.");
    const selected = selectOption(el, String(wanted));
    return { field: describeElement(el), ref: assignRef(el), selected, value: el.value };
  },
};

export const submitFormTool: GenericToolDef = {
  name: "submit_form",
  title: "Submit form",
  description:
    "Submit a form. Pass `ref` of the form or of any field inside it, or a CSS `selector`; with no input the first visible form on the page is submitted. Fires the form's submit handling (respects the page's own validation and handlers), waits ~300ms and returns `{form, submitted, title, url, navigationStarted}`. This may place orders or send data, so it requires user approval.",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "Ref of the form or of a field inside it." },
      selector: { type: "string", description: "CSS selector of the form or a field inside it." },
    },
    required: [],
  },
  sensitivity: "sensitive",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async (input, signal) => {
    let target: Element | null = null;
    if (input.ref || input.selector) target = resolveElement({ ref: input.ref as string, selector: input.selector as string });
    let form: HTMLFormElement | null = null;
    if (target) form = target instanceof HTMLFormElement ? target : ((target as HTMLInputElement).form ?? target.closest("form"));
    else form = Array.from(document.forms).find(isVisible) ?? document.forms[0] ?? null;
    if (!form) throw new Error("No form found.");
    const before = location.href;
    const watch = navigationWatcher();
    submitForm(form);
    await sleep(SETTLE_MS, signal);
    return {
      form: describeElement(form),
      ref: assignRef(form),
      submitted: true,
      ...pageState(),
      navigationStarted: watch.done() || location.href !== before,
    };
  },
};

export const navigate: GenericToolDef = {
  name: "navigate",
  title: "Navigate",
  description:
    "Navigate the current tab to a URL (http or https, absolute or relative to the current page). Starts a full page load; the tools will re-register on the new page, so call describe_page afterwards. Returns `{navigatingTo}`. Requires user approval.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL or a path relative to the current page." },
    },
    required: ["url"],
  },
  sensitivity: "sensitive",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async (input) => {
    const raw = String(input.url ?? "").trim();
    if (!raw) throw new Error("url is required");
    let target: URL;
    try {
      target = new URL(raw, location.href);
    } catch {
      throw new Error(`Invalid URL: ${raw}`);
    }
    if (!/^https?:$/.test(target.protocol)) throw new Error("Only http(s) URLs are allowed.");
    setTimeout(() => location.assign(target.href), 0);
    return { navigatingTo: target.href, from: location.href };
  },
};

export const goBack: GenericToolDef = {
  name: "go_back",
  title: "Go back",
  description:
    "Go back one entry in the tab's history (like the browser Back button). Returns `{from, historyLength}`; call describe_page afterwards to see the resulting page.",
  inputSchema: { type: "object", properties: {}, required: [] },
  sensitivity: "write",
  readOnlyHint: false,
  untrustedContentHint: false,
  run: async () => {
    const from = location.href;
    if (history.length <= 1) throw new Error("No previous page in history.");
    setTimeout(() => history.back(), 0);
    return { from, historyLength: history.length };
  },
};

// Keep these imports referenced for tree-shaking clarity.
void visibleText;
void normalizeText;
