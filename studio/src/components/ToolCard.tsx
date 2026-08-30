import type { RecipeTool } from "@webmcp-anywhere/shared";
import { JsonBlock } from "./JsonBlock";
import { SensitivityChip } from "./SensitivityChip";

export function ToolCard({ tool }: { tool: RecipeTool }) {
  return (
    <article className="card tool-card">
      <header className="tool-card-head">
        <div>
          <code className="tool-name">{tool.name}</code>
          {tool.title && <span className="tool-title">{tool.title}</span>}
        </div>
        <SensitivityChip value={tool.sensitivity} />
      </header>
      <p>{tool.description}</p>
      <div className="tool-card-details">
        <JsonBlock summary={`inputSchema (${Object.keys(tool.inputSchema?.properties ?? {}).length} params)`} value={tool.inputSchema ?? {}} />
        <JsonBlock summary={`actions (${tool.actions.length})`} value={tool.actions} />
      </div>
    </article>
  );
}
