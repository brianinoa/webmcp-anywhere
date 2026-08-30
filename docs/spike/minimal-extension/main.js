// WMA spike — runs in the page's MAIN world (see manifest.json).
// Goal: prove that an extension-injected script can register WebMCP tools that
// an agent (ChatGPT desktop browser / Chrome + Model Context Tool Inspector) can
// see and call on a page that has no native WebMCP support.
//
// Everything is logged with the prefix [WMA-spike] so it is easy to filter in
// DevTools. Nothing here depends on the rest of the monorepo.

(() => {
  const TAG = "[WMA-spike]";
  const POLL_MS = 50;
  const TIMEOUT_MS = 5000;

  // Chrome 150+ exposes document.modelContext; older builds only had
  // navigator.modelContext (deprecated in 150). Try both.
  function getMC() {
    return document.modelContext || navigator.modelContext || null;
  }

  function flashBorder(color) {
    const apply = () => {
      const el = document.documentElement;
      const prev = el.style.outline;
      el.style.outline = `6px solid ${color}`;
      el.style.outlineOffset = "-6px";
      setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = ""; }, 1200);
    };
    if (document.documentElement) apply(); else document.addEventListener("DOMContentLoaded", apply, { once: true });
  }

  async function registerTools(mc) {
    const tools = [
      {
        name: "wma_ping",
        description:
          "Connectivity test registered by the WebMCP Anywhere extension (not by the page). " +
          "Echoes the message back and flashes the page border green so the user can see the call landed.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string", description: "Any short text to echo back." } },
          required: ["message"],
        },
        annotations: { readOnlyHint: true },
        async execute(input) {
          console.log(TAG, "wma_ping called with", input);
          flashBorder("#16a34a");
          return `pong: ${input && input.message} from ${location.hostname}`;
        },
      },
      {
        name: "read_headings",
        description:
          "Return the page title and up to 25 h1/h2/h3 headings of the current page as JSON. " +
          "Registered by the WebMCP Anywhere extension; content comes from the page and is untrusted.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute() {
          const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
            .slice(0, 25)
            .map((h) => ({ level: h.tagName.toLowerCase(), text: (h.textContent || "").trim().slice(0, 120) }));
          flashBorder("#2563eb");
          return JSON.stringify({ url: location.href, title: document.title, headings });
        },
      },
    ];

    for (const tool of tools) {
      try {
        await mc.registerTool(tool);
        console.log(TAG, `registered ${tool.name}`);
      } catch (err) {
        console.error(TAG, `registerTool(${tool.name}) FAILED:`, err && err.name, err && err.message, err);
      }
    }

    // Read back what the browser thinks is registered (getTools exists in Chrome; may not in other hosts).
    try {
      if (typeof mc.getTools === "function") {
        const list = await mc.getTools();
        console.log(TAG, "getTools() ->", list.map((t) => t.name));
      }
    } catch (err) {
      console.warn(TAG, "getTools() threw:", err);
    }
  }

  async function main() {
    console.log(TAG, "content script (MAIN world) loaded at", document.readyState, "on", location.href);
    console.log(TAG, "immediate check: document.modelContext =", typeof document.modelContext,
      "| navigator.modelContext =", typeof navigator.modelContext,
      "| originAgentCluster =", window.originAgentCluster);

    const start = Date.now();
    let mc = getMC();
    while (!mc && Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      mc = getMC();
    }

    if (!mc) {
      console.warn(TAG, `NO modelContext after ${TIMEOUT_MS}ms. ` +
        "Either WebMCP is not enabled in this browser (chrome://flags/#enable-webmcp-testing), " +
        "this document is not origin-isolated, or this host does not expose the API to injected scripts.");
      flashBorder("#dc2626");
      return;
    }

    console.log(TAG, `modelContext FOUND after ${Date.now() - start}ms via`,
      document.modelContext ? "document.modelContext" : "navigator.modelContext (deprecated)");
    await registerTools(mc);
    flashBorder("#f59e0b"); // amber = registered, waiting for a call
  }

  main().catch((e) => console.error(TAG, "fatal", e));
})();
