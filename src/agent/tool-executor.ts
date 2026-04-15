/**
 * @tolu/cowork-core — Tool executor
 *
 * Dispatches tool calls to registered tool definitions,
 * validates arguments via Zod, and handles errors gracefully.
 */

import type { ToluToolCallContent, ToluContent } from "../types/index.js";
import type {
  ToluToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../tools/tool-interface.js";

// ─── Error Classes ───────────────────────────────────────────────────────────

/** Thrown when a requested tool is not registered. */
export class ToolNotFoundError extends Error {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
    this.name = "ToolNotFoundError";
  }
}

/** Thrown when tool arguments fail Zod validation. */
export class ToolArgumentError extends Error {
  constructor(toolName: string, issues: string) {
    super(`Invalid arguments for tool '${toolName}': ${issues}`);
    this.name = "ToolArgumentError";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorContent(message: string): ToluContent {
  return { type: "text", text: `Error: ${message}` };
}

// ─── ToolExecutor ────────────────────────────────────────────────────────────

/**
 * Handles tool call dispatch: lookup, validate, execute, error-wrap.
 */
export class ToolExecutor {
  /**
   * Execute a single tool call.
   *
   * Looks up the tool by name, validates arguments against the tool's
   * Zod schema, calls execute(), and wraps errors into error results
   * instead of throwing.
   *
   * @param toolCall - The tool call content from the LLM response.
   * @param tools - Map of registered tools keyed by name.
   * @param context - Execution context (sandbox, working directory, signal).
   * @returns ToolExecutionResult with content or error information.
   */
  async executeTool(
    toolCall: ToluToolCallContent,
    tools: Map<string, ToluToolDefinition>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const { id: toolCallId, name: toolName, arguments: args } = toolCall;

    // Lookup
    const tool = tools.get(toolName);
    if (!tool) {
      return {
        toolCallId,
        toolName,
        content: [errorContent(new ToolNotFoundError(toolName).message)],
        isError: true,
        duration: Date.now() - start,
      };
    }

    // Validate
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(", ");
      return {
        toolCallId,
        toolName,
        content: [errorContent(new ToolArgumentError(toolName, issues).message)],
        isError: true,
        duration: Date.now() - start,
      };
    }

    // Execute with error guard
    try {
      const result = await tool.execute(args, context);
      // Ensure toolCallId is set
      result.toolCallId = toolCallId;
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolCallId,
        toolName,
        content: [errorContent(message)],
        isError: true,
        duration: Date.now() - start,
      };
    }
  }

  /**
   * Execute multiple tool calls, either in parallel or sequentially.
   *
   * @param toolCalls - Array of tool call contents to execute.
   * @param tools - Map of registered tools.
   * @param context - Execution context.
   * @param mode - 'parallel' or 'sequential'.
   * @returns Array of results in the same order as input tool calls.
   */
  async executeTools(
    toolCalls: ToluToolCallContent[],
    tools: Map<string, ToluToolDefinition>,
    context: ToolExecutionContext,
    mode: "parallel" | "sequential" = "parallel",
  ): Promise<ToolExecutionResult[]> {
    if (mode === "parallel") {
      return Promise.all(
        toolCalls.map((tc) => this.executeTool(tc, tools, context)),
      );
    }

    // Sequential execution
    const results: ToolExecutionResult[] = [];
    for (const tc of toolCalls) {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.executeTool(tc, tools, context);
      results.push(result);
    }
    return results;
  }
}
