/**
 * @tolu/cowork-core — Search tools
 *
 * Grep, find, and glob tools for code search and file discovery.
 */

import { z } from "zod";
import { exec } from "node:child_process";
import { glob as globPackage } from "glob";
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

function execCommand(
  command: string,
  cwd: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? 1 : 0,
        });
      },
    );
  });
}

function makeResult(
  toolName: string,
  content: ToluContent[],
  isError: boolean,
  start: number,
): ToolExecutionResult {
  return {
    toolCallId: "",
    toolName,
    content,
    isError,
    duration: Date.now() - start,
  };
}

// ─── GrepTool ────────────────────────────────────────────────────────────────

const GrepParamsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1),
  include: z.string().optional(),
  maxResults: z.number().int().min(1).max(1000).optional(),
});

export const GrepTool: ToluToolDefinition = {
  name: "grep",
  description:
    "Search for a regex pattern in files. Returns matching lines with " +
    "file:line:content format.",
  parameters: GrepParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: { type: "string", description: "Directory or file to search in" },
      include: { type: "string", description: "Glob pattern for file inclusion (e.g. '*.ts')" },
      maxResults: { type: "number", description: "Maximum number of results (1-1000, default 100)" },
    },
    required: ["pattern", "path"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = GrepParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { pattern, path: searchPath, include, maxResults = 100 } = parsed.data;
    const cwd = path.resolve(context.workingDirectory, searchPath);

    // Build grep command
    const includeArg = include ? ` --include='${include}'` : "";
    const command = `grep -rn -E '${pattern.replace(/'/g, "'\''")}' .${includeArg} | head -n ${maxResults}`;

    try {
      const result = await execCommand(command, cwd, 30_000);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return makeResult(this.name, [textContent(result.stdout.trim())], false, start);
      }
      return makeResult(this.name, [textContent("No matches found")], false, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(this.name, [errorContent(message)], true, start);
    }
  },
};

// ─── FindTool ────────────────────────────────────────────────────────────────

const FindParamsSchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
  type: z.enum(["file", "directory"]).optional(),
  maxDepth: z.number().int().min(1).max(50).optional(),
});

export const FindTool: ToluToolDefinition = {
  name: "find",
  description: "Find files and directories by name, type, and depth.",
  parameters: FindParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Root directory for the search" },
      name: { type: "string", description: "Name pattern (supports wildcards)" },
      type: { type: "string", enum: ["file", "directory"], description: "Entry type filter" },
      maxDepth: { type: "number", description: "Maximum search depth (1-50)" },
    },
    required: ["path"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = FindParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { path: searchPath, name, type: entryType, maxDepth } = parsed.data;
    const cwd = path.resolve(context.workingDirectory, searchPath);

    const parts: string[] = ["find ."];
    if (maxDepth) parts.push(`-maxdepth ${maxDepth}`);
    if (name) parts.push(`-name '${name.replace(/'/g, "'\''")}'`);
    if (entryType === "file") parts.push("-type f");
    if (entryType === "directory") parts.push("-type d");
    parts.push("| head -n 500");

    const command = parts.join(" ");

    try {
      const result = await execCommand(command, cwd, 30_000);
      if (result.stdout.trim()) {
        return makeResult(this.name, [textContent(result.stdout.trim())], false, start);
      }
      return makeResult(this.name, [textContent("No results found")], false, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(this.name, [errorContent(message)], true, start);
    }
  },
};

// ─── GlobTool ────────────────────────────────────────────────────────────────

const GlobParamsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1),
});

export const GlobTool: ToluToolDefinition = {
  name: "glob",
  description: "Match files using glob patterns (e.g. 'src/**/*.ts').",
  parameters: GlobParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g. 'src/**/*.ts')" },
      path: { type: "string", description: "Base directory for glob matching" },
    },
    required: ["pattern", "path"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = GlobParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { pattern, path: searchPath } = parsed.data;
    const cwd = path.resolve(context.workingDirectory, searchPath);

    try {
      const matches = await globPackage(pattern, {
        cwd,
        absolute: false,
        nodir: false,
      });

      if (matches.length === 0) {
        return makeResult(this.name, [textContent("No files matched the pattern")], false, start);
      }

      const output =
        matches.length > 500
          ? matches.slice(0, 500).join("\n") + `\n... (${matches.length - 500} more)`
          : matches.join("\n");

      return makeResult(this.name, [textContent(output)], false, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(this.name, [errorContent(message)], true, start);
    }
  },
};
