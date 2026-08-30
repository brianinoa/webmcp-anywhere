import { useState } from "react";
import type { JSONSchema, RecipeAction, RecipeTool, Sensitivity } from "@webmcp-anywhere/shared";
import { ACTION_KINDS, SENSITIVITIES, emptyAction, type ActionKind } from "../validate";
import { ActionEditor } from "./ActionEditor";

interface Props {
  tool: RecipeTool;
  index: number;
  onChange: (t: RecipeTool) => void;
  onRemove: () => void;
}

export function ToolEditor({ tool, index, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(true);
  const [schemaText, setSchemaText] = useState(() => JSON.stringify(tool.inputSchema ?? { type: "object", properties: {} }, null, 2));
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [kind, setKind] = useState<ActionKind>("click");

  const set = (patch: Partial<RecipeTool>) => onChange({ ...tool, ...patch });
  const setActions = (actions: RecipeAction[]) => set({ actions });

  const onSchema = (text: string) => {
    setSchemaText(text);
    try {
      const parsed = JSON.parse(text) as JSONSchema;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("must be an object");
      setSchemaError(null);
      set({ inputSchema: parsed });
    } catch (e) {
      setSchemaError(`Invalid JSON: ${(e as Error).message}`);
    }
  };

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= tool.actions.length) return;
    const next = [...tool.actions];
    [next[i], next[j]] = [next[j], next[i]];
    setActions(next);
  };

  return (
    <section className="card tool-editor">
      <header className="tool-editor-head">
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "▾" : "▸"}
        </button>
        <code className="tool-name">{tool.name || `tool ${index + 1}`}</code>
        <span className={`chip chip-${tool.sensitivity}`}>{tool.sensitivity}</span>
        <span className="muted">{tool.actions.length} actions</span>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-xs danger" onClick={onRemove}>
          Remove tool
        </button>
      </header>

      {open && (
        <div className="tool-editor-body">
          <div className="grid-2">
            <label className="field">
              <span>Name</span>
              <input value={tool.name} placeholder="search_videos" pattern="[A-Za-z0-9_.\-]{1,128}" onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>Title (optional)</span>
              <input value={tool.title ?? ""} placeholder="Search videos" onChange={(e) => set({ title: e.target.value || undefined })} />
            </label>
          </div>
          <label className="field">
            <span>Description (what an agent should know)</span>
            <textarea rows={2} value={tool.description} placeholder="Search YouTube for a query and return the top result titles." onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Sensitivity</span>
              <select value={tool.sensitivity} onChange={(e) => set({ sensitivity: e.target.value as Sensitivity })}>
                {SENSITIVITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Input schema (JSON Schema; params become {"{{param}}"} in actions)</span>
            <textarea className="mono" rows={5} value={schemaText} onChange={(e) => onSchema(e.target.value)} spellCheck={false} />
            {schemaError && <span className="field-error">{schemaError}</span>}
          </label>

          <div className="actions-editor">
            <div className="actions-editor-head">
              <strong>Actions</strong>
              <span className="spacer" />
              <select value={kind} onChange={(e) => setKind(e.target.value as ActionKind)} aria-label="Action kind">
                {ACTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" onClick={() => setActions([...tool.actions, emptyAction(kind)])}>
                Add action
              </button>
            </div>
            {tool.actions.length === 0 && <p className="muted empty">No actions yet. Add one above.</p>}
            {tool.actions.map((a, i) => (
              <ActionEditor
                key={i}
                action={a}
                index={i}
                count={tool.actions.length}
                onChange={(next) => setActions(tool.actions.map((x, j) => (j === i ? next : x)))}
                onRemove={() => setActions(tool.actions.filter((_, j) => j !== i))}
                onMove={(d) => move(i, d)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
