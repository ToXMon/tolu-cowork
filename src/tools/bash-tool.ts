/**
 * @tolu/cowork-core — Bash execution tool
 *
 * Runs shell commands via sandbox or child_process.
 * Blocks dangerous commands and enforces buffer limits.
 */

import { z } from "zod";
import { exec } from "node:child_process";
import * as path from "node:path";
import type { ToluContent } from "../types/index.js";
import type { ToluToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./tool-interface.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT = 30_000; // 30 seconds

/** Patterns that match dangerous shell commands. */
const DANGEROUS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\brm\s+(-rf?\s+)?\/\s*$/, "Refusing to delete root filesystem"],
  [/\bmkfs\b/, "Refusing to format filesystem"],
  [/\bdd\s+if=\/dev\/zero/, "Refusing to zero device"],
  [/\bdd\s+if=\/dev\/urandom/, "Refusing to write random data to device"],
  [/\b:\(\)\s*\{\s*:.*\}\s*;/, "Refusing fork bomb pattern"],
  [/\bchmod\s+(-R\s+)?000\s+\//, "Refusing to revoke all permissions on root"],
  [/\bchown\s+(-R\s+)?\S+\s+\//, "Refusing to change ownership of root"],
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function textContent(text: string): ToluContent {
  return { type: "text", text };
}

function errorContent(message: string): ToluContent {
  return { type: "text", text: `Error: ${message}` };
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_BUFFER) return output;
  return output.slice(0, MAX_BUFFER) + "\n... (output truncated at 10MB)";
}

/** Check if a command matches any dangerous pattern. */
function checkDangerousCommand(command: string): string | null {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

// ─── BashTool ────────────────────────────────────────────────────────────────

const BashParamsSchema = z.object({
  command: z.string().min(1),
  timeout: z.number().int().min(100).max(600_000).optional(),
  workingDirectory: z.string().optional(),
});

export const BashTool: ToluToolDefinition = {
  name: "bash",
  description:
    "Execute a bash command and return stdout, stderr, and exit code. " +
    "Supports timeout and working directory options.",
  parameters: BashParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (100-600000, default 30000)",
      },
      workingDirectory: {
        type: "string",
        description: "Working directory for the command",
      },
    },
    required: ["command"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = BashParamsSchema.safeParse(args);
    if (!parsed.success) {
      return {
        toolCallId: "",
        toolName: this.name,
        content: [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        isError: true,
        duration: Date.now() - start,
      };
    }

    const { command, timeout = DEFAULT_TIMEOUT, workingDirectory } = parsed.data;

    // Block dangerous commands
    const danger = checkDangerousCommand(command);
    if (danger) {
      return {
        toolCallId: "",
        toolName: this.name,
        content: [errorContent(danger)],
        isError: true,
        duration: Date.now() - start,
      };
    }

    const cwd = workingDirectory
      ? path.resolve(context.workingDirectory, workingDirectory)
      : context.workingDirectory;

    // Use sandbox if available
    if (context.sandboxManager && context.sandboxId) {
      const sandbox = context.sandboxManager.getSandbox(context.sandboxId);
      if (sandbox) {
        try {
          const result = await sandbox.execute(command, [], {
            timeout,
            cwd,
            signal: context.signal,
          });
          const output = [
            result.exitCode !== 0 ? `Exit code: ${result.exitCode}` : "",
            result.stdout ? truncateOutput(result.stdout) : "",
            result.stderr ? `stderr:\n${truncateOutput(result.stderr)}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          return {
            toolCallId: "",
            toolName: this.name,
            content: [textContent(output || "(no output)")],
            isError: result.exitCode !== 0,
            duration: Date.now() - start,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            toolCallId: "",
            toolName: this.name,
            content: [errorContent(message)],
            isError: true,
            duration: Date.now() - start,
          };
        }
      }
    }

    // Fall back to child_process
    return new Promise<ToolExecutionResult>((resolve) => {
      const proc = exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer: MAX_BUFFER,
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          const duration = Date.now() - start;
          const exitCode = error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0;
          const timedOut = error?.killed === true;

          const parts: string[] = [];
          if (exitCode !== 0) {
            parts.push(`Exit code: ${exitCode}`);
          }
          if (timedOut) {
            parts.push("Command timed out");
          }
          if (stdout) {
            parts.push(truncateOutput(stdout));
          }
          if (stderr) {
            parts.push(`stderr:\n${truncateOutput(stderr)}`);
          }

          resolve({
            toolCallId: "",
            toolName: "bash",
            content: [textContent(parts.join("\n") || "(no output)")],
            isError: exitCode !== 0,
            duration,
          });
        },
      );

      // Wire up abort signal
      if (context.signal) {
        const onAbort = (): void => {
          proc.kill("SIGTERM");
        };
        context.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  },
};
