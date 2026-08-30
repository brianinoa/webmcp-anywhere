import { useState, type KeyboardEvent } from "react";

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  validate?: (v: string) => boolean;
  id?: string;
}

/** Text input that turns Enter/comma/blur into chips. */
export function ChipInput({ values, onChange, placeholder, validate, id }: Props) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (!values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="chip-input">
      {values.map((v) => (
        <span key={v} className={`chip chip-token ${validate && !validate(v) ? "chip-invalid" : ""}`}>
          <code>{v}</code>
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input id={id} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit} />
    </div>
  );
}
