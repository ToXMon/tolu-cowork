/**
 * @tolu/cowork-core — Tool interface definitions
 *
 * Defines the contract for tool implementations, including
 * parameter validation via Zod, execution context, and
 * conversion helpers for LLM consumption.
 */

import { z } from "zod";
import type { ToluTool, ToluContent } from "../types/index.js";

// ─── Tool Execution Context ─────────────────────────────────────────────────

/**
 * Context passed to every tool execution call.
 * Provides sandbox access, working directory, and cancellation.
 */
export interface ToolExecutionContext {
  /** Active sandbox ID, if sandboxing is enabled. */
  sandboxId?: string;
  /** Sandbox manager instance for path resolution and access checks. */
  sandboxManager?: import("../sandbox/sandbox-manager.js").SandboxManager;
  /** Working directory for relative path resolution. */
  workingDirectory: string;
  /** AbortSignal for cancelling the tool execution. */
  signal?: AbortSignal;
  /** Session ID of the invoking agent session. */
  sessionId: string;
}

// ─── Tool Execution Result ───────────────────────────────────────────────────

/**
 * Result returned from a tool execution.
 */
export interface ToolExecutionResult {
  /** The tool call ID this result corresponds to. */
  toolCallId: string;
  /** Name of the executed tool. */
  toolName: string;
  /** Content blocks produced by the tool. */
  content: ToluContent[];
  /** Whether the execution resulted in an error. */
  isError: boolean;
  /** Wall-clock execution duration in milliseconds. */
  duration: number;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * Full tool definition implementing this interface can be registered
 * with ToluAgent and invoked during the agentic loop.
 */
export interface ToluToolDefinition {
  /** Unique tool name (e.g. "read_file", "bash"). */
  name: string;
  /** Human-readable description used by the LLM for tool selection. */
  description: string;
  /** Zod schema for runtime parameter validation. */
  parameters: z.ZodType;
  /** JSON Schema representation of parameters for LLM tool definitions. */
  parameterSchema: Record<string, unknown>;
  /** Execute the tool with validated arguments. */
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}

// ─── Conversion Helper ───────────────────────────────────────────────────────

/**
 * Convert a ToluToolDefinition into the slim ToluTool shape
 * consumed by the LLM during tool-use requests.
 */
export function toToluTool(def: ToluToolDefinition): ToluTool {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameterSchema as unknown as import("../types/index.js").ToluToolParameter,
  };
}
