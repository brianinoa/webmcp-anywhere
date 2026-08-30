// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Recipe, RecipeTool } from "@webmcp-anywhere/shared";
import { runRecipeTool, substitute, resolveElement, resolveElements, builtins, type ExtRecipeAction } from "../src/recipes/runner";
import { recipesForUrl, validateRecipe, toModelContextTool } from "../src/recipes/loader";
import youtube from "../../recipes/youtube.json";
import wikipedia from "../../recipes/wikipedia.json";
import hackernews from "../../recipes/hackernews.json";
import github from "../../recipes/github.json";
import twitch from "../../recipes/twitch.json";

const FIRST_PARTY = [youtube, wikipedia, hackernews, github, twitch] as unknown as Recipe[];

const tool = (actions: ExtRecipeAction[], extra: Partial<RecipeTool> = {}): RecipeTool => ({
  name: "t",
  description: "test tool",
  sensitivity: "write",
  actions: actions as RecipeTool["actions"],
  ...extra,
});

const run = (t: RecipeTool, input: Record<string, unknown> = {}, signal = new AbortController().signal) =>
  runRecipeTool(t, input, signal).then((s) => JSON.parse(s) as Record<string, unknown> & { did: string[] });

// ---------------------------------------------------------------------------
describe("substitute", () => {
  it("replaces params", () => {
    expect(substitute("hello {{name}}!", { name: "world" })).toBe("hello world!");
    expect(substitute("{{ a }}-{{b}}", { a: 1, b: true })).toBe("1-true");
  });
  it("throws on missing params", () => {
    expect(() => substitute("{{missing}}", {})).toThrow(/Missing required parameter "missing"/);
  });
  it("url-encodes query params but keeps slashes in path params", () => {
    const out = substitute("{{$origin}}/{{$repo}}/blob/HEAD/{{path}}?q={{q}}", { path: "src/a b.ts", q: "x&y=z" }, {
      url: true,
      extra: { $origin: "https://github.com", $repo: "o/r" },
    });
    expect(out).toBe("https://github.com/o/r/blob/HEAD/src/a%20b.ts?q=x%26y%3Dz");
  });
  it("resolves builtins from a URL", () => {
    const b = builtins(new URL("https://github.com/owner/repo/tree/main/src"));
    expect(b.$repo).toBe("owner/repo");
    expect(b.$origin).toBe("https://github.com");
    expect(b.$pathname).toBe("/owner/repo/tree/main/src");
    expect(builtins(new URL("https://github.com/")).$repo).toBeUndefined();
    expect(() => substitute("{{$repo}}", {}, { extra: {} })).toThrow(/\$repo/);
  });
});

// ---------------------------------------------------------------------------
describe("resolveElement", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h2>Intro</h2><h2>History of things</h2><h2>History</h2>
      <ul><li class="x">one</li><li class="x">two</li><li class="x">three</li></ul>`;
  });
  it("supports :text= (exact first, then contains, case-insensitive)", () => {
    expect(resolveElement("h2:text=history")?.textContent).toBe("History");
    expect(resolveElements("h2:text=history").map((e) => e.textContent)).toEqual(["History", "History of things"]);
    expect(resolveElement('h2:text="of things"')?.textContent).toBe("History of things");
    expect(resolveElement("h2:text=nope")).toBeNull();
  });
  it("supports :nth= (1-based)", () => {
    expect(resolveElement("li.x:nth=2")?.textContent).toBe("two");
    expect(resolveElement("li.x:nth=9")).toBeNull();
    expect(resolveElement("h2:text=history:nth=2")?.textContent).toBe("History of things");
  });
  it("throws on invalid css", () => {
    expect(() => resolveElement("li[")).toThrow(/Invalid selector/);
  });
});

// ---------------------------------------------------------------------------
describe("validateRecipe", () => {
  it("accepts all first-party recipes", () => {
    for (const r of FIRST_PARTY) {
      const v = validateRecipe(r);
      expect(v.ok, `${(r as Recipe).id}: ${JSON.stringify((v as { errors?: string[] }).errors)}`).toBe(true);
    }
  });
  it("rejects bad recipes with useful errors", () => {
    const bad = {
      id: "",
      name: "x",
      description: 1,
      version: "1",
      matches: ["youtube.com"],
      tools: [
        { name: "click", description: "collides", sensitivity: "read", actions: [{ kind: "click", selector: "a" }] },
        { name: "bad name!", description: "", sensitivity: "nope", inputSchema: { type: "array" }, actions: [] },
        { name: "dup", description: "d", sensitivity: "read", actions: [{ kind: "explode" }] },
        { name: "dup", description: "d", sensitivity: "read", actions: [{ kind: "media", op: "seek" }, { kind: "navigate", url: "javascript:alert(1)" }, { kind: "wait" }] },
      ],
    };
    const v = validateRecipe(bad);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const all = v.errors.join("\n");
    expect(all).toMatch(/id must be/);
    expect(all).toMatch(/version must be a number/);
    expect(all).toMatch(/invalid pattern "youtube.com"/);
    expect(all).toMatch(/collides with a generic tool/);
    expect(all).toMatch(/name must match/);
    expect(all).toMatch(/sensitivity must be one of/);
    expect(all).toMatch(/inputSchema.type must be "object"/);
    expect(all).toMatch(/actions must be a non-empty array/);
    expect(all).toMatch(/unknown action kind "explode"/);
    expect(all).toMatch(/duplicate tool name "dup"/);
    expect(all).toMatch(/media seek requires "value"/);
    expect(all).toMatch(/url scheme not allowed/);
    expect(all).toMatch(/wait needs/);
    expect(validateRecipe(null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("recipesForUrl", () => {
  it("matches by pattern", () => {
    const ids = (url: string) => recipesForUrl(FIRST_PARTY, url).map((r) => r.id);
    expect(ids("https://www.youtube.com/watch?v=abc")).toEqual(["youtube"]);
    expect(ids("https://en.wikipedia.org/wiki/Paris")).toEqual(["wikipedia"]);
    expect(ids("https://news.ycombinator.com/")).toEqual(["hackernews"]);
    expect(ids("https://github.com/o/r")).toEqual(["github"]);
    expect(ids("https://gist.github.com/x")).toEqual([]);
    expect(ids("https://example.com/")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("toModelContextTool", () => {
  it("sets annotations from sensitivity and read actions", () => {
    const recipe = FIRST_PARTY[0];
    const np = recipe.tools.find((t) => t.name === "yt_now_playing")!;
    const desc = toModelContextTool(recipe, np, async () => "ok");
    expect(desc.name).toBe("yt_now_playing");
    expect(desc.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(desc.inputSchema?.type).toBe("object");
    const nav = toModelContextTool(recipe, recipe.tools.find((t) => t.name === "yt_search")!, async () => "ok");
    expect(nav.annotations).toEqual({ readOnlyHint: false, untrustedContentHint: false });
  });
});

// ---------------------------------------------------------------------------
describe("runner actions", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form id="f"><input id="q" name="q"><select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select></form>
      <button id="b">Press me</button>
      <div id="content">
        <div class="mw-heading"><h2>Intro</h2></div>
        <p>Intro para 1</p>
        <div class="mw-heading"><h2>History</h2></div>
        <p>H para 1</p><p>   </p><p>H para 2</p>
        <h3>Sub</h3><p>H sub para 3</p>
        <div class="mw-heading"><h2>Geography</h2></div>
        <p>G para 1</p>
      </div>
      <ul id="list"><li><a href="/one">One</a></li><li><a href="/two">Two</a></li><li><a href="/three">Three</a></li></ul>
      <video id="v"></video>`;
    Element.prototype.scrollIntoView = vi.fn();
    // jsdom does not implement media playback; stub it.
    const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
    let paused = true;
    Object.defineProperty(proto, "paused", { configurable: true, get: () => paused });
    Object.defineProperty(proto, "duration", { configurable: true, get: () => 120 });
    proto.play = vi.fn(async () => { paused = false; });
    proto.pause = vi.fn(() => { paused = true; });
  });

  it("click dispatches and logs", async () => {
    const onClick = vi.fn();
    document.getElementById("b")!.addEventListener("click", onClick);
    const out = await run(tool([{ kind: "click", selector: "button:text=press me" }]));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
    expect(out.did[0]).toMatch(/clicked button#b "Press me"/);
  });

  it("type sets value via native setter, fires input/change, and submits", async () => {
    const input = document.getElementById("q") as HTMLInputElement;
    const events: string[] = [];
    for (const t of ["input", "change", "keydown"]) input.addEventListener(t, () => events.push(t));
    const form = document.getElementById("f") as HTMLFormElement;
    form.requestSubmit = vi.fn();
    const out = await run(tool([{ kind: "type", selector: "#q", value: "hello {{who}}", submit: true }]), { who: "there" });
    expect(input.value).toBe("hello there");
    expect(events).toEqual(["input", "change", "keydown"]);
    expect(form.requestSubmit).toHaveBeenCalled();
    expect(out.did).toEqual([expect.stringMatching(/typed "hello there"/), "submitted form"]);
  });

  it("select picks by value or label", async () => {
    const sel = document.getElementById("s") as HTMLSelectElement;
    await run(tool([{ kind: "select", selector: "#s", value: "beta" }]));
    expect(sel.value).toBe("b");
    await expect(run(tool([{ kind: "select", selector: "#s", value: "gamma" }]))).rejects.toThrow(/No option matching "gamma"/);
  });

  it("read: single, attribute (absolute href), all with limit, missing -> null", async () => {
    const out = await run(
      tool([
        { kind: "read", selector: "#list a:nth=2", as: "second" },
        { kind: "read", selector: "#list a:nth=2", attribute: "href", as: "href" },
        { kind: "read", selector: "#list a", all: true, limit: "{{n}}", as: "items" },
        { kind: "read", selector: "#nope", as: "missing" },
        { kind: "read", selector: "#list li", all: true },
      ]),
      { n: 2 },
    );
    expect(out.second).toBe("Two");
    expect(out.href).toBe("http://localhost:3000/two");
    expect(out.items).toEqual(["One", "Two"]);
    expect(out.missing).toBeNull();
    expect(out.result).toEqual(["One", "Two", "Three"]);
  });

  it("read with following collects paragraphs until next same-level heading, including subsections", async () => {
    const out = await run(tool([{ kind: "read", selector: "#content h2:text={{h}}", following: 10, as: "paras" }]), { h: "history" });
    expect(out.paras).toEqual(["H para 1", "H para 2", "H sub para 3"]);
    const out2 = await run(tool([{ kind: "read", selector: "#content h2:text=History", following: 10, limit: 1, as: "paras" }]));
    expect(out2.paras).toEqual(["H para 1"]);
  });

  it("scroll to element and to bottom", async () => {
    window.scrollTo = vi.fn();
    const out = await run(tool([{ kind: "scroll", selector: "#content h2:text=Geography" }, { kind: "scroll", to: "bottom" }]));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(window.scrollTo).toHaveBeenCalled();
    expect(out.did).toEqual(['scrolled to h2 "Geography"', "scrolled to bottom"]);
  });

  it("media play/pause/toggle/seek(relative)/rate/volume/mute/state", async () => {
    const out = await run(
      tool([
        { kind: "media", op: "play" },
        { kind: "media", op: "seek", value: "{{t}}" },
        { kind: "media", op: "seek", value: -5, relative: true },
        { kind: "media", op: "rate", value: 1.5 },
        { kind: "media", op: "volume", value: 0.5 },
        { kind: "media", op: "mute" },
        { kind: "media", op: "toggle" },
        { kind: "media", op: "state" },
      ]),
      { t: 30 },
    );
    const v = document.getElementById("v") as HTMLVideoElement;
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(v.currentTime).toBe(25);
    expect(v.playbackRate).toBe(1.5);
    expect(v.volume).toBe(0.5);
    expect(out.media).toEqual({ paused: true, currentTime: 25, duration: 120, playbackRate: 1.5, volume: 0.5, muted: true });
    expect(out.did).toContain("skipped -5s to 25s");
    // seek clamps to duration
    const c = await run(tool([{ kind: "media", op: "seek", value: 999 }]));
    expect((c.media as { currentTime: number }).currentTime).toBe(120);
    await expect(run(tool([{ kind: "media", op: "rate", value: 99 }]))).rejects.toThrow(/out of range/);
  });

  it("media with no element fails clearly", async () => {
    document.getElementById("v")!.remove();
    await expect(run(tool([{ kind: "media", op: "play" }]))).rejects.toThrow(/No <video> or <audio>/);
  });

  it("wait for selector resolves when it appears and times out otherwise", async () => {
    setTimeout(() => { document.body.insertAdjacentHTML("beforeend", '<div id="late">x</div>'); }, 150);
    const out = await run(tool([{ kind: "wait", selector: "#late", ms: 2000 }]));
    expect(out.did[0]).toMatch(/waited \d+ms for div#late/);
    await expect(run(tool([{ kind: "wait", selector: "#never", ms: 200 }]))).rejects.toThrow(/Timed out after 200ms/);
  });

  it("navigate returns early with the target url", async () => {
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...orig, href: orig.href, origin: orig.origin, host: orig.host, pathname: "/o/r", assign } });
    try {
      const out = await run(
        tool([{ kind: "navigate", url: "{{$origin}}/{{$repo}}/search?q={{q}}" }, { kind: "click", selector: "#nope" }]),
        { q: "a b" },
      );
      expect(out.navigated).toBe("http://localhost:3000/o/r/search?q=a%20b");
      expect(assign).toHaveBeenCalledWith("http://localhost:3000/o/r/search?q=a%20b");
      await expect(run(tool([{ kind: "navigate", url: "javascript:alert(1)" }]))).rejects.toThrow(/non-http/);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: orig });
    }
  });

  it("js is refused unless allowJs", async () => {
    await expect(run(tool([{ kind: "js", fn: "return 1" }]))).rejects.toThrow(/js actions are not allowed in remote recipes/);
    const r = JSON.parse(await runRecipeTool(tool([{ kind: "js", fn: "return input.x * 2" }]), { x: 21 }, new AbortController().signal, { allowJs: true }));
    expect(r.js).toBe(42);
  });

  it("applies inputSchema defaults and reports missing params / bad selectors with action index", async () => {
    const t = tool([{ kind: "read", selector: "#list a", all: true, limit: "{{limit}}", as: "items" }], {
      inputSchema: { type: "object", properties: { limit: { type: "integer", default: 1 } } },
    });
    expect((await run(t)).items).toEqual(["One"]);
    await expect(run(tool([{ kind: "click", selector: "#b" }, { kind: "click", selector: "#{{id}}" }]))).rejects.toThrow(
      /t: action 2\/2 \(click\) failed: Missing required parameter "id"/,
    );
    await expect(run(tool([{ kind: "click", selector: "#nope" }]))).rejects.toThrow(/No element matches selector: #nope/);
  });

  it("honours the abort signal and the timebox", async () => {
    const ac = new AbortController();
    const p = run(tool([{ kind: "wait", ms: 5000 }]), {}, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow(/aborted/i);
    await expect(
      runRecipeTool(tool([{ kind: "wait", ms: 5000 }]), {}, new AbortController().signal, { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out after 50ms/);
  });
});
