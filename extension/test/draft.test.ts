// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { RESERVED_TOOL_NAMES } from "@webmcp-anywhere/shared";
import { buildDraftRecipe } from "../src/recipes/draft";
import { validateRecipe, TOOL_NAME_RE } from "../src/recipes/loader";

/** A jsdom Location-like object (buildDraftRecipe only reads `hostname`). */
const loc = (hostname: string): Location => ({ hostname }) as unknown as Location;

const RICH_HTML = `
  <h1>Weekly Roundup</h1>
  <h2>Section A</h2>
  <h3>Sub A</h3>
  <main><p>First paragraph of body text.</p><p>Second paragraph.</p></main>
  <form>
    <input type="search" name="q" />
    <button type="submit">Search</button>
  </form>
  <a href="/about">About us</a>
  <a href="/contact">Contact</a>
  <video src="movie.mp4"></video>
`;

describe("buildDraftRecipe", () => {
  beforeEach(() => {
    document.title = "Example — Weekly Roundup";
    document.body.innerHTML = "";
  });

  it("produces a valid, id-less draft recipe", () => {
    document.body.innerHTML = RICH_HTML;
    const draft = buildDraftRecipe(document, loc("www.example.com"));

    expect(draft.id).toBeUndefined();
    // As a draft it must validate with allowMissingId, and be rejected without it.
    expect(validateRecipe(draft, { allowMissingId: true }).ok).toBe(true);
    expect(validateRecipe(draft).ok).toBe(false);

    expect(draft.version).toBe(1);
    expect(draft.author).toBe("Captured on www.example.com");
    expect(draft.name).toBe("Example — Weekly Roundup");
    expect(draft.description).toMatch(/review and edit before relying/i);
  });

  it("derives matches from the host with a wildcard base", () => {
    document.body.innerHTML = RICH_HTML;
    const draft = buildDraftRecipe(document, loc("www.example.com"));
    expect(draft.matches).toContain("*://*.example.com/*");
    expect(draft.matches).toContain("*://www.example.com/*");
    // Only http(s) via the "*" scheme.
    expect(draft.matches.every((m) => m.startsWith("*://"))).toBe(true);
  });

  it("gives every tool a unique, valid, non-reserved name and a 4-8 count", () => {
    document.body.innerHTML = RICH_HTML;
    const draft = buildDraftRecipe(document, loc("example.com"));
    expect(draft.tools.length).toBeGreaterThanOrEqual(4);
    expect(draft.tools.length).toBeLessThanOrEqual(8);
    const names = draft.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length); // unique
    for (const t of draft.tools) {
      expect(TOOL_NAME_RE.test(t.name)).toBe(true);
      expect(RESERVED_TOOL_NAMES.has(t.name)).toBe(false);
      expect(t.description.trim().length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeDefined();
      expect(t.actions.length).toBeGreaterThan(0);
    }
  });

  it("emits media and search tools when those elements exist", () => {
    document.body.innerHTML = RICH_HTML;
    const draft = buildDraftRecipe(document, loc("example.com"));
    const names = draft.tools.map((t) => t.name);
    expect(names.some((n) => n.endsWith("_play"))).toBe(true);
    expect(names.some((n) => n.endsWith("_media_state"))).toBe(true);
    expect(names.some((n) => n.endsWith("_search"))).toBe(true);
    // A submitting search tool is gated as sensitive.
    const search = draft.tools.find((t) => t.name.endsWith("_search"))!;
    expect(search.sensitivity).toBe("sensitive");
  });

  it("omits media and search tools when those elements are absent", () => {
    document.body.innerHTML = `<h1>Plain</h1><p>Just text.</p><a href="/x">link</a>`;
    const draft = buildDraftRecipe(document, loc("plainsite.org"));
    const names = draft.tools.map((t) => t.name);
    expect(names.some((n) => n.endsWith("_play"))).toBe(false);
    expect(names.some((n) => n.endsWith("_search"))).toBe(false);
    // Still a valid draft with the baseline reads.
    expect(validateRecipe(draft, { allowMissingId: true }).ok).toBe(true);
    expect(draft.tools.length).toBeGreaterThanOrEqual(4);
  });

  it("falls back to the host when the document has no title", () => {
    document.title = "";
    document.body.innerHTML = `<p>no title here</p>`;
    const draft = buildDraftRecipe(document, loc("news.example.co"));
    expect(draft.name).toBe("news.example.co");
  });
});
