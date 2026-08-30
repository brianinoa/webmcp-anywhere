import { GENERIC_TOOL_NAMES } from "@webmcp-anywhere/shared";
import type { GenericToolDef } from "./types";
import { describePage, findText } from "./describe";
import { click, fillField, goBack, navigate, scrollTo, selectOptionTool, submitFormTool } from "./actions";

export type { GenericToolDef } from "./types";

export const GENERIC_TOOLS: GenericToolDef[] = [
  describePage,
  findText,
  scrollTo,
  click,
  fillField,
  selectOptionTool,
  submitFormTool,
  navigate,
  goBack,
];

// Sanity check at module load: names must match the shared contract exactly.
const names = new Set<string>(GENERIC_TOOLS.map((t) => t.name));
for (const n of GENERIC_TOOL_NAMES) {
  if (!names.has(n)) console.warn("[WebMCP Anywhere] missing generic tool implementation:", n);
}
