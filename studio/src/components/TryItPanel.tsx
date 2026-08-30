import { useEffect, useState } from "react";
import type { ModelContextTool } from "@webmcp-anywhere/shared";
import { useWebMCPStatus } from "../hooks";
import { STUDIO_TOOLS, listRegisteredTools } from "../webmcp";

/**
 * The studio page is itself a WebMCP site. This panel shows the tools the
 * page has registered so a human can see what an agent sees.
 */
export function TryItPanel({ recipeId }: { recipeId: string }) {
  const status = useWebMCPStatus();
  const [tools, setTools] = useState<ModelContextTool[]>([]);

  useEffect(() => {
    let live = true;
    void listRegisteredTools().then((t) => live && setTools(t));
    return () => {
      live = false;
    };
  }, [status]);

  const shown = status === "native" ? tools : STUDIO_TOOLS;

  return (
    <aside className="card try-panel">
      <h3>Try it with an agent</h3>
      <p className={`status-line status-${status}`}>
        <span className={`status-dot status-${status}`} aria-hidden="true" />
        {status === "native" && "WebMCP: native — this page's tools are live in your browser."}
        {status === "pending" && "WebMCP: checking…"}
        {status === "unavailable" && (
          <>
            WebMCP: not available. Enable <code>chrome://flags/#enable-webmcp-testing</code> in Chrome 149+ or open this page in ChatGPT's browser.
          </>
        )}
      </p>
      <p className="muted">
        Ask your agent, for example: <em>"Open recipe {recipeId} and add a tool that reads the page title."</em>
      </p>
      <h4>
        Tools registered by this page {status === "native" && <span className="pill">{shown.length}</span>}
      </h4>
      <ul className="tool-list">
        {shown.map((t) => (
          <li key={t.name}>
            <code>{t.name}</code>
            <span className={`chip chip-${t.annotations?.readOnlyHint ? "read" : "write"}`}>{t.annotations?.readOnlyHint ? "read" : "write"}</span>
            <span className="muted tool-list-desc">{t.description}</span>
          </li>
        ))}
      </ul>
      {status !== "native" && <p className="muted small">Listing the tools the studio registers when WebMCP is available.</p>}
    </aside>
  );
}
