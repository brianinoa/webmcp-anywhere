import type { GenericToolName, JSONSchema, Sensitivity } from "@webmcp-anywhere/shared";

/** A generic tool definition; main-world.ts wraps `run` with the common invoke() pipeline. */
export interface GenericToolDef {
  name: GenericToolName;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  sensitivity: Sensitivity;
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> | unknown;
}
