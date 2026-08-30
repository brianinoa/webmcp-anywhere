import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignRef, byRef, fillElement, labelFor, resolveElement, selectOption, pressEnter } from "../src/generic/dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("refs", () => {
  it("assigns stable data-wma-ref ids and resolves them", () => {
    document.body.innerHTML = `<button id="b">Go</button>`;
    const btn = document.getElementById("b")!;
    const ref = assignRef(btn);
    expect(ref).toMatch(/^e\d+$/);
    expect(assignRef(btn)).toBe(ref);
    expect(btn.getAttribute("data-wma-ref")).toBe(ref);
    expect(byRef(ref)).toBe(btn);
  });
});

describe("resolveElement", () => {
  it("prefers ref over text and selector", () => {
    document.body.innerHTML = `<button id="a">Save</button><button id="b">Save</button>`;
    const ref = assignRef(document.getElementById("b")!);
    expect(resolveElement({ ref, text: "Save", selector: "#a" }).id).toBe("b");
  });

  it("matches visible text exactly before partially", () => {
    document.body.innerHTML = `<a href="#">Save draft</a><button>Save</button><button>Cancel</button>`;
    expect(resolveElement({ text: "save" }).tagName).toBe("BUTTON");
    expect(resolveElement({ text: "save dr" }).tagName).toBe("A");
  });

  it("matches fields by label, placeholder and aria-label", () => {
    document.body.innerHTML = `
      <label for="email">Email address</label><input id="email" />
      <input id="q" placeholder="Search videos" />
      <textarea id="bio" aria-label="Biography"></textarea>`;
    expect(resolveElement({ label: "email" }).id).toBe("email");
    expect(resolveElement({ label: "Search videos" }).id).toBe("q");
    expect(resolveElement({ label: "biography" }).id).toBe("bio");
    expect(labelFor(document.getElementById("email")!)).toBe("Email address");
  });

  it("falls back to CSS selector and reports missing elements", () => {
    document.body.innerHTML = `<div class="x"></div>`;
    expect(resolveElement({ selector: ".x" }).className).toBe("x");
    expect(() => resolveElement({ selector: ".nope" })).toThrow(/No element matches/);
    expect(() => resolveElement({ ref: "e999" })).toThrow(/describe_page/);
    expect(() => resolveElement({})).toThrow(/Provide one of/);
  });
});

describe("fillElement", () => {
  it("sets input values with the native setter and fires input/change", () => {
    document.body.innerHTML = `<input id="i" />`;
    const el = document.getElementById("i") as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener("input", () => seen.push("input"));
    el.addEventListener("change", () => seen.push("change"));
    const res = fillElement(el, "hello");
    expect(res).toEqual({ kind: "input", value: "hello" });
    expect(el.value).toBe("hello");
    expect(seen).toEqual(["input", "change"]);
  });

  it("handles checkboxes with boolean-ish values", () => {
    document.body.innerHTML = `<input id="c" type="checkbox" />`;
    const el = document.getElementById("c") as HTMLInputElement;
    expect(fillElement(el, "true").value).toBe("true");
    expect(el.checked).toBe(true);
    expect(fillElement(el, false).value).toBe("false");
    expect(el.checked).toBe(false);
  });

  it("selects options by value or visible label", () => {
    document.body.innerHTML = `<select id="s"><option value="us">United States</option><option value="de">Germany</option></select>`;
    const el = document.getElementById("s") as HTMLSelectElement;
    expect(selectOption(el, "germany")).toBe("Germany");
    expect(el.value).toBe("de");
    expect(fillElement(el, "us")).toEqual({ kind: "select", value: "United States" });
    expect(() => selectOption(el, "france")).toThrow(/Available/);
  });

  it("fills contenteditable editors", () => {
    document.body.innerHTML = `<div id="ed" contenteditable="true"></div>`;
    const el = document.getElementById("ed")!;
    const res = fillElement(el, "typed text");
    expect(res.kind).toBe("contenteditable");
    expect(el.textContent).toBe("typed text");
  });

  it("pressEnter submits the surrounding form unless the page prevents it", () => {
    document.body.innerHTML = `<form id="f"><input id="i" /></form>`;
    const form = document.getElementById("f") as HTMLFormElement;
    const input = document.getElementById("i")!;
    const submit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", submit);
    form.requestSubmit = () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(pressEnter(input)).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);

    input.addEventListener("keydown", (e) => e.preventDefault());
    expect(pressEnter(input)).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
