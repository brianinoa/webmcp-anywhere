import type { Sensitivity } from "@webmcp-anywhere/shared";

const LABEL: Record<Sensitivity, string> = { read: "read", write: "write", sensitive: "sensitive" };

export function SensitivityChip({ value }: { value: Sensitivity }) {
  return <span className={`chip chip-${value}`}>{LABEL[value] ?? value}</span>;
}
