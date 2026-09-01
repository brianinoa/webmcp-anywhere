import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { JSONSchema, ToolSummary } from "@webmcp-anywhere/shared";
import { SensitivityChip } from "../components/SensitivityChip";
import { useRoom, type CallEntry } from "../room";

/** Normalize a URL param to the room-code shape the worker expects. */
function normalizeCode(raw: string | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "");
}

interface Group {
  key: string;
  label: string;
  tools: ToolSummary[];
}

function groupTools(tools: ToolSummary[]): Group[] {
  const map = new Map<string, Group>();
  for (const t of tools) {
    const key = t.source === "generic" ? "generic" : `recipe:${t.recipeId ?? "recipe"}`;
    const label = t.source === "generic" ? "Generic tools" : t.recipeId ?? "Recipe";
    let g = map.get(key);
    if (!g) {
      g = { key, label, tools: [] };
      map.set(key, g);
    }
    g.tools.push(t);
  }
  // Generic first, then recipes in insertion order.
  return [...map.values()].sort((a, b) => (a.key === "generic" ? -1 : b.key === "generic" ? 1 : 0));
}

function schemaProps(schema: JSONSchema | undefined): Array<[string, JSONSchema]> {
  return Object.entries(schema?.properties ?? {});
}

export function Remote() {
  const { code: rawCode } = useParams();
  const code = normalizeCode(rawCode);
  const { conn, peers, tools, page, log, call } = useRoom(code);
  const groups = useMemo(() => groupTools(tools), [tools]);

  const statusText =
    conn === "connecting"
      ? "Connecting…"
      : conn === "reconnecting"
        ? "Reconnecting…"
        : peers.targets === 0
          ? "Waiting for a device…"
          : `Connected · ${peers.targets} device${peers.targets === 1 ? "" : "s"}`;
  const statusKind = conn !== "open" ? "wait" : peers.targets === 0 ? "wait" : "live";

  return (
    <div className="remote">
      <header className="remote-head">
        <div className="remote-code" aria-label="Room code">
          {code || "—"}
        </div>
        <div className={`remote-status remote-status-${statusKind}`}>
          <span className="remote-status-dot" aria-hidden="true" />
          {statusText}
        </div>
        {page && (
          <div className="remote-page" title={page.url}>
            {page.title || page.url}
          </div>
        )}
      </header>

      {tools.length === 0 ? (
        <div className="remote-empty">
          {peers.targets === 0 ? (
            <p>Open this page's code on the device you want to control, then enable remote control from the extension.</p>
          ) : (
            <p>Connected. Waiting for the device to share its tools…</p>
          )}
        </div>
      ) : (
        <div className="remote-groups">
          {groups.map((g) => (
            <section key={g.key} className="remote-group">
              <h2 className="remote-group-title">{g.label}</h2>
              <div className="remote-cards">
                {g.tools.map((t) => (
                  <ToolCardRunner key={`${g.key}:${t.name}`} tool={t} onRun={call} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ResultsLog log={log} />
    </div>
  );
}

function ToolCardRunner({ tool, onRun }: { tool: ToolSummary; onRun: (tool: string, input: Record<string, unknown>) => void }) {
  const props = schemaProps(tool.inputSchema);
  const hasInputs = props.length > 0;
  const required = new Set(tool.inputSchema?.required ?? []);
  const sensitive = tool.sensitivity === "sensitive";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const buildInput = (): Record<string, unknown> => {
    const input: Record<string, unknown> = {};
    for (const [name, schema] of props) {
      const raw = values[name];
      if (raw === undefined || raw === "") continue;
      const type = schema.type;
      input[name] = type === "number" || type === "integer" ? Number(raw) : raw;
    }
    return input;
  };

  const run = () => {
    if (sensitive) return;
    onRun(tool.name, buildInput());
  };

  const onCardTap = () => {
    if (sensitive) return;
    if (hasInputs) setOpen((o) => !o);
    else onRun(tool.name, {});
  };

  return (
    <article className={`remote-card${sensitive ? " remote-card-disabled" : ""}`}>
      <button type="button" className="remote-card-tap" onClick={onCardTap} disabled={sensitive} aria-expanded={hasInputs ? open : undefined}>
        <div className="remote-card-top">
          <code className="remote-card-name">{tool.title || tool.name}</code>
          <SensitivityChip value={tool.sensitivity} />
        </div>
        <p className="remote-card-desc">{tool.description}</p>
        {sensitive && <span className="remote-card-note">Desktop only — sensitive tools can't run remotely</span>}
        {!sensitive && hasInputs && <span className="remote-card-hint">{open ? "Hide inputs" : "Tap to set inputs"}</span>}
        {!sensitive && !hasInputs && <span className="remote-card-hint">Tap to run</span>}
      </button>

      {sensitive && (
        <button className="btn btn-sm" type="button" disabled title="Sensitive tools must be approved on the desktop">
          Run
        </button>
      )}

      {!sensitive && hasInputs && open && (
        <div className="remote-form">
          {props.map(([name, schema]) => (
            <Field key={name} name={name} schema={schema} required={required.has(name)} value={values[name] ?? ""} onChange={(v) => set(name, v)} />
          ))}
          <button className="btn btn-primary btn-sm remote-run" type="button" onClick={run}>
            Run
          </button>
        </div>
      )}
    </article>
  );
}

function Field({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string;
  schema: JSONSchema;
  required: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = (
    <span>
      {schema.description || name}
      {required && <span className="remote-req"> *</span>}
    </span>
  );
  const enumVals = Array.isArray(schema.enum) ? (schema.enum as unknown[]) : null;
  return (
    <label className="field field-sm remote-field">
      {label}
      {enumVals ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {enumVals.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
      ) : schema.type === "number" || schema.type === "integer" ? (
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={name} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={name} />
      )}
    </label>
  );
}

function ResultsLog({ log }: { log: CallEntry[] }) {
  if (log.length === 0) return null;
  return (
    <section className="remote-log">
      <h2 className="remote-group-title">Activity</h2>
      <ul className="remote-log-list">
        {log.map((e) => (
          <li key={e.callId} className={`remote-log-item remote-log-${e.status}`}>
            <div className="remote-log-head">
              <code>{e.tool}</code>
              {e.status === "pending" && <span className="remote-spinner" aria-label="running" />}
              {e.status === "ok" && <span className="remote-badge remote-badge-ok">done</span>}
              {e.status === "error" && <span className="remote-badge remote-badge-err">error</span>}
              {e.status === "blocked" && <span className="remote-badge remote-badge-block">blocked</span>}
            </div>
            {e.status === "blocked" && <p className="remote-log-msg">Blocked: sensitive tools can't be run remotely.</p>}
            {e.status === "error" && e.error && <p className="remote-log-msg">{e.error}</p>}
            {e.status === "ok" && e.result && <pre className="remote-log-out">{e.result}</pre>}
          </li>
        ))}
      </ul>
    </section>
  );
}
