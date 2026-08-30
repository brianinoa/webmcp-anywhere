import type { RecipeAction } from "@webmcp-anywhere/shared";
import { MEDIA_OPS } from "../validate";

interface Props {
  action: RecipeAction;
  index: number;
  count: number;
  onChange: (a: RecipeAction) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}

const HINT: Record<RecipeAction["kind"], string> = {
  click: "Click the first element matching the selector.",
  type: "Type a value (use {{param}}) into an input; optionally press Enter.",
  select: "Choose an <option> by value in a <select>.",
  scroll: "Scroll an element, or the page to top/bottom.",
  navigate: "Go to a URL (may contain {{param}}).",
  wait: "Wait for a duration and/or for a selector to appear.",
  read: "Read text or an attribute; `all` returns every match.",
  media: "Control a <video>/<audio> element.",
  js: "First-party only: inline function body. Rejected in remote recipes.",
};

export function ActionEditor({ action, index, count, onChange, onRemove, onMove }: Props) {
  // Field helpers keep the switch below short.
  const set = (patch: Record<string, unknown>) => onChange({ ...action, ...patch } as RecipeAction);
  const str = (key: string, label: string, placeholder?: string, required = false) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={String((action as Record<string, unknown>)[key] ?? "")}
        placeholder={placeholder}
        required={required}
        onChange={(e) => set({ [key]: e.target.value === "" && !required ? undefined : e.target.value })}
      />
    </label>
  );
  const num = (key: string, label: string) => (
    <label className="field field-sm">
      <span>{label}</span>
      <input
        type="number"
        value={(action as Record<string, unknown>)[key] === undefined ? "" : String((action as Record<string, unknown>)[key])}
        onChange={(e) => set({ [key]: e.target.value === "" ? undefined : Number(e.target.value) })}
      />
    </label>
  );
  const bool = (key: string, label: string) => (
    <label className="field field-check">
      <input type="checkbox" checked={Boolean((action as Record<string, unknown>)[key])} onChange={(e) => set({ [key]: e.target.checked || undefined })} />
      <span>{label}</span>
    </label>
  );

  let fields;
  switch (action.kind) {
    case "click":
      fields = str("selector", "Selector", "button.play", true);
      break;
    case "type":
      fields = (
        <>
          {str("selector", "Selector", "input[name=q]", true)}
          {str("value", "Value", "{{query}}", true)}
          {bool("submit", "Press Enter after typing")}
        </>
      );
      break;
    case "select":
      fields = (
        <>
          {str("selector", "Selector", "select#sort", true)}
          {str("value", "Option value", "", true)}
        </>
      );
      break;
    case "scroll":
      fields = (
        <>
          {str("selector", "Selector (optional)")}
          <label className="field field-sm">
            <span>To</span>
            <select value={action.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })}>
              <option value="">(element)</option>
              <option value="top">top</option>
              <option value="bottom">bottom</option>
            </select>
          </label>
        </>
      );
      break;
    case "navigate":
      fields = str("url", "URL", "https://example.com/search?q={{query}}", true);
      break;
    case "wait":
      fields = (
        <>
          {num("ms", "Milliseconds")}
          {str("selector", "Wait for selector (optional)")}
        </>
      );
      break;
    case "read":
      fields = (
        <>
          {str("selector", "Selector", "h1", true)}
          {str("attribute", "Attribute (optional)", "href")}
          {str("as", "Result name (optional)", "results")}
          {bool("all", "Read all matches")}
        </>
      );
      break;
    case "media":
      fields = (
        <>
          {str("selector", "Selector (optional)", "video")}
          <label className="field field-sm">
            <span>Op</span>
            <select value={action.op} onChange={(e) => set({ op: e.target.value })}>
              {MEDIA_OPS.map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
          </label>
          {num("value", "Value")}
        </>
      );
      break;
    case "js":
      fields = (
        <label className="field">
          <span>Function body</span>
          <textarea rows={3} value={action.fn} onChange={(e) => set({ fn: e.target.value })} />
        </label>
      );
      break;
  }

  return (
    <div className="action-row">
      <div className="action-row-head">
        <span className="action-index">{index + 1}</span>
        <code className="action-kind">{action.kind}</code>
        <span className="muted action-hint">{HINT[action.kind]}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-xs" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
          ↑
        </button>
        <button type="button" className="btn btn-ghost btn-xs" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
          ↓
        </button>
        <button type="button" className="btn btn-ghost btn-xs danger" onClick={onRemove} aria-label="Remove action">
          Remove
        </button>
      </div>
      <div className="action-fields">{fields}</div>
    </div>
  );
}
