/**
 * @tolu/cowork-core — File edit tool
 *
 * Provides line-range patch editing for files.
 * All operations route through the sandbox manager when available.
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToluContent } from "../types/index.js";
import type { ToluToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./tool-interface.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── EditTool ────────────────────────────────────────────────────────────────

const EditParamsSchema = z.object({
  path: z.string().min(1),
  edits: z.array(
    z.object({
      from: z.number().int().min(1),
      to: z.number().int().min(1).optional(),
      content: z.string().optional(),
    }),
  ),
});

export const EditTool: ToluToolDefinition = {
  name: "edit_file",
  description:
    "Edit a file by applying line-range patches. Each edit specifies a " +
    "from/to line range and replacement content. Omit 'to' to insert before 'from'. " +
    "Omit 'content' to delete lines.",
  parameters: EditParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file to edit" },
      edits: {
        type: "array",
        description: "Array of line-range edits to apply",
        items: {
          type: "object",
          properties: {
            from: { type: "number", description: "Start line (1-based, inclusive)" },
            to: { type: "number", description: "End line (1-based, inclusive). Omit to insert." },
            content: { type: "string", description: "Replacement text. Omit to delete." },
          },
          required: ["from"],
        },
      },
    },
    required: ["path", "edits"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = EditParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        "",
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { path: filePath, edits } = parsed.data;

    try {
      const resolved = resolvePath(filePath, context);
      const raw = await fs.readFile(resolved, "utf-8");
      const lines = raw.split("\n");

      // Validate line numbers
      for (const edit of edits) {
        if (edit.from < 1 || edit.from > lines.length) {
          return makeResult(
            "",
            this.name,
            [errorContent(`Line ${edit.from} is out of range (file has ${lines.length} lines)`)],
            true,
            start,
          );
        }
        if (edit.to !== undefined && (edit.to < edit.from || edit.to > lines.length)) {
          return makeResult(
            "",
            this.name,
            [errorContent(`Line range ${edit.from}-${edit.to} is invalid`)],
            true,
            start,
          );
        }
      }

      // Sort edits in reverse order so line numbers stay stable
      const sorted = [...edits].sort((a, b) => b.from - a.from);

      let modifiedCount = 0;
      for (const edit of sorted) {
        const fromIdx = edit.from - 1;
        const deleteCount = edit.to !== undefined ? (edit.to - edit.from + 1) : 0;
        const replacement = edit.content !== undefined ? edit.content.split("\n") : [];
        lines.splice(fromIdx, deleteCount, ...replacement);
        modifiedCount++;
      }

      await fs.writeFile(resolved, lines.join("\n"), "utf-8");
      return makeResult(
        "",
        this.name,
        [textContent(`Applied ${modifiedCount} edit(s) to ${filePath}`)],
        false,
        start,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult("", this.name, [errorContent(message)], true, start);
    }
  },
};
