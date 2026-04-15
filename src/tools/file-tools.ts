/**
 * @tolu/cowork-core — File operation tools
 *
 * Provides read, write, and list tools for file system access.
 * Edit operations live in ./file-edit.ts.
 * All operations route through the sandbox manager when available.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToluContent } from "../types/index.js";
import type { ToluToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./tool-interface.js";

// Re-export EditTool for backward compatibility
export { EditTool } from "./file-edit.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_OUTPUT_LENGTH = 100_000;

function textContent(text: string): ToluContent {
  return { type: "text", text };
}

function errorContent(message: string): ToluContent {
  return { type: "text", text: `Error: ${message}` };
}

/** Resolve a path relative to workingDirectory, optionally through sandbox. */
function resolvePath(filePath: string, context: ToolExecutionContext): string {
  const resolved = path.resolve(context.workingDirectory, filePath);
  if (context.sandboxManager && context.sandboxId) {
    const sandbox = context.sandboxManager.getSandbox(context.sandboxId);
    if (sandbox) {
      return sandbox.resolvePath(resolved);
    }
  }
  return resolved;
}

function makeResult(
  toolCallId: string,
  toolName: string,
  content: ToluContent[],
  isError: boolean,
  start: number,
): ToolExecutionResult {
  return {
    toolCallId,
    toolName,
    content,
    isError,
    duration: Date.now() - start,
  };
}

// ─── ReadTool ────────────────────────────────────────────────────────────────

const ReadParamsSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});

export const ReadTool: ToluToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file. Returns content with line numbers. " +
    "Optionally specify startLine and endLine to read a specific range.",
  parameters: ReadParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to read" },
      startLine: { type: "number", description: "First line to read (1-based)" },
      endLine: { type: "number", description: "Last line to read (inclusive)" },
    },
    required: ["path"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = ReadParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        "",
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { path: filePath, startLine, endLine } = parsed.data;

    try {
      const resolved = resolvePath(filePath, context);
      const raw = await fs.readFile(resolved, "utf-8");
      const lines = raw.split("\n");

      const from = startLine ? startLine - 1 : 0;
      const to = endLine ?? lines.length;
      const sliced = lines.slice(from, to);

      // Format with line numbers
      const numbered = sliced
        .map((line, i) => `${from + i + 1}: ${line}`)
        .join("\n");

      const output =
        numbered.length > MAX_OUTPUT_LENGTH
          ? numbered.slice(0, MAX_OUTPUT_LENGTH) + "\n... (truncated)"
          : numbered;

      return makeResult("", this.name, [textContent(output)], false, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult("", this.name, [errorContent(message)], true, start);
    }
  },
};

// ─── WriteTool ───────────────────────────────────────────────────────────────

const WriteParamsSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const WriteTool: ToluToolDefinition = {
  name: "write_file",
  description:
    "Write content to a file. Creates parent directories if they do not exist.",
  parameters: WriteParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = WriteParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        "",
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { path: filePath, content: fileContent } = parsed.data;

    try {
      const resolved = resolvePath(filePath, context);
      const dir = path.dirname(resolved);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(resolved, fileContent, "utf-8");
      return makeResult(
        "",
        this.name,
        [textContent(`Successfully wrote ${fileContent.length} bytes to ${filePath}`)],
        false,
        start,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult("", this.name, [errorContent(message)], true, start);
    }
  },
};

// ─── ListTool ────────────────────────────────────────────────────────────────

const ListParamsSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  maxDepth: z.number().int().min(1).max(20).optional(),
});

export const ListTool: ToluToolDefinition = {
  name: "list_directory",
  description: "List directory contents with file type and size information.",
  parameters: ListParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
      recursive: { type: "boolean", description: "List recursively" },
      maxDepth: { type: "number", description: "Maximum recursion depth (1-20)" },
    },
    required: ["path"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = ListParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        "",
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { path: dirPath, recursive = false, maxDepth = 5 } = parsed.data;

    try {
      const resolved = resolvePath(dirPath, context);

      async function listDir(dir: string, depth: number): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const result: string[] = [];

        for (const entry of entries) {
          const prefix = "  ".repeat(depth);
          if (entry.isDirectory()) {
            result.push(`${prefix}${entry.name}/`);
            if (recursive && depth < maxDepth) {
              const subPath = path.join(dir, entry.name);
              const subEntries = await listDir(subPath, depth + 1);
              result.push(...subEntries);
            }
          } else if (entry.isFile()) {
            try {
              const stat = await fs.stat(path.join(dir, entry.name));
              result.push(`${prefix}${entry.name} (${stat.size} bytes)`);
            } catch {
              result.push(`${prefix}${entry.name}`);
            }
          } else {
            result.push(`${prefix}${entry.name}`);
          }
        }
        return result;
      }

      const entries = await listDir(resolved, 0);
      const output =
        entries.length > 500
          ? entries.slice(0, 500).join("\n") + "\n... (truncated)"
          : entries.join("\n");

      return makeResult("", this.name, [textContent(output || "(empty directory)")], false, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult("", this.name, [errorContent(message)], true, start);
    }
  },
};
