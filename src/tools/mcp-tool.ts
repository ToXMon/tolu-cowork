/**
 * @tolu/cowork-core — MCP (Model Context Protocol) tool
 *
 * Factory for creating tool wrappers around MCP servers.
 * Transport implementation is a placeholder for now.
 */

import { z } from "zod";
import type { ToluContent } from "../types/index.js";
import type { ToluToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./tool-interface.js";

// ─── MCP Server Configuration ────────────────────────────────────────────────

/** Configuration for an MCP server connection. */
export interface MCPServerConfig {
  /** Display name for the server. */
  name: string;
  /** Transport mechanism. */
  transport: "stdio" | "http" | "ws";
  /** Command to launch the server (for stdio transport). */
  command?: string;
  /** URL for HTTP/WebSocket transport. */
  url?: string;
  /** Environment variables for the server process. */
  env?: Record<string, string>;
}

// ─── MCP Tool Parameters ─────────────────────────────────────────────────────

const MCPParamsSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.unknown()).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function textContent(text: string): ToluContent {
  return { type: "text", text };
}

function errorContent(message: string): ToluContent {
  return { type: "text", text: `Error: ${message}` };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a ToluToolDefinition that wraps an MCP server.
 *
 * The returned tool dispatches calls to the named MCP server.
 * Actual transport communication is not yet implemented — the execute
 * method returns a placeholder response indicating the MCP call would
 * occur.
 *
 * @param serverConfig - Configuration for the target MCP server.
 * @returns A ToluToolDefinition whose execute proxies to the MCP server.
 */
export function createMCPTool(serverConfig: MCPServerConfig): ToluToolDefinition {
  const toolName = `mcp_${serverConfig.name}`;

  return {
    name: toolName,
    description:
      `Call tool on MCP server "${serverConfig.name}" ` +
      `(transport: ${serverConfig.transport}). ` +
      `Specify the tool name and arguments.`,
    parameters: MCPParamsSchema,
    parameterSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "Name of the MCP tool to call" },
        arguments: {
          type: "object",
          description: "Arguments to pass to the MCP tool",
          additionalProperties: true,
        },
      },
      required: ["tool"],
    },
    async execute(
      args: Record<string, unknown>,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      const start = Date.now();
      const parsed = MCPParamsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          toolCallId: "",
          toolName,
          content: [
            errorContent(
              `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
            ),
          ],
          isError: true,
          duration: Date.now() - start,
        };
      }

      const { tool, arguments: toolArgs } = parsed.data;

      // TODO: Implement actual MCP transport (stdio/http/ws)
      // For now, return a placeholder indicating the call structure works.
      return {
        toolCallId: "",
        toolName,
        content: [
          textContent(
            `[MCP placeholder] Server: ${serverConfig.name}, ` +
              `Tool: ${tool}, Args: ${JSON.stringify(toolArgs ?? {})}`,
          ),
        ],
        isError: false,
        duration: Date.now() - start,
      };
    },
  };
}
