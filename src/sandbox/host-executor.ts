/**
 * @tolu/cowork-core — Host sandbox (level = "none")
 *
 * Direct host execution via child_process.spawn.
 * No path restrictions — used only in trusted environments.
 * Implements buffer limits (10 MB), timeout via process-tree kill,
 * and AbortSignal support.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SandboxInstance } from "./sandbox-instance.js";
import type { SandboxConfig, ExecResult, ExecOptions, SandboxFileSystem } from "./types.js";
import { SandboxTimeoutError } from "./errors.js";

/** Maximum bytes kept per stdout / stderr stream. */
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Kill an entire process tree.
 * On Unix: sends SIGKILL to the process group (-pid).
 * On Windows: uses `taskkill /F /T /PID`.
 */
export function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
        stdio: "ignore",
        detached: true,
      });
    } catch {
      // Process may already be dead
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already dead
      }
    }
  }
}

/**
 * Escape a string for safe embedding in a single-quoted shell argument.
 * Wraps the result in single quotes, escaping internal single quotes.
 */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Sandbox that executes commands directly on the host.
 * Use only when the environment is fully trusted.
 */
export class HostSandbox extends SandboxInstance {
  constructor(id: string, config: SandboxConfig) {
    super(id, config);
  }

  /**
   * Execute a command on the host via `sh -c` (or `cmd /c` on Windows).
   *
   * Arguments are joined with the command so the shell can interpret them.
   * Respects buffer limits (10 MB per stream) and optional timeout.
   */
  execute(command: string, args?: string[], options?: ExecOptions): Promise<ExecResult> {
    const fullCommand = args && args.length > 0
      ? `${command} ${args.map(shellEscape).join(" ")}`
      : command;

    const timeoutMs = options?.timeout ?? this.config.timeout;
    const start = Date.now();

    return new Promise<ExecResult>((resolve, reject) => {
      const shell = process.platform === "win32" ? "cmd" : "sh";
      const shellFlag = process.platform === "win32" ? "/c" : "-c";

      const child = spawn(shell, [shellFlag, fullCommand], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options?.cwd,
        env: options?.env ?? process.env as Record<string, string>,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // ── Timeout handling ─────────────────────────────────────────────────
      const timeoutHandle = timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeoutMs)
        : undefined;

      // ── AbortSignal handling ──────────────────────────────────────────────
      const onAbort = (): void => {
        if (child.pid) killProcessTree(child.pid);
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      // ── Stream capture with buffer limits ────────────────────────────────
      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_BUFFER) {
          stdout = stdout.slice(0, MAX_BUFFER);
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > MAX_BUFFER) {
          stderr = stderr.slice(0, MAX_BUFFER);
        }
      });

      // ── Process completion ───────────────────────────────────────────────
      child.on("close", (code: number | null) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }

        const duration = Date.now() - start;
        const exitCode = code ?? 0;

        if (options?.signal?.aborted) {
          reject(new SandboxTimeoutError(
            `Command aborted by signal`,
            duration,
            this.id,
          ));
          return;
        }

        if (timedOut) {
          reject(new SandboxTimeoutError(
            `Command timed out after ${timeoutMs!}ms`,
            timeoutMs!,
            this.id,
          ));
          return;
        }

        resolve({ stdout, stderr, exitCode, timedOut: false, duration });
      });

      child.on("error", (err: Error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }
        reject(err);
      });
    });
  }

  /**
   * Host sandbox sees paths unchanged.
   */
  resolvePath(hostPath: string): string {
    return hostPath;
  }

  /**
   * Return a host-based file system interface.
   */
  getFileSystem(): SandboxFileSystem {
    return new HostFileSystem();
  }

  /**
   * No resources to clean up for host sandbox.
   */
  async destroy(): Promise<void> {
    this.status = "stopped";
  }
}

/**
 * Host-based SandboxFileSystem — delegates directly to Node.js `fs`.
 */
class HostFileSystem implements SandboxFileSystem {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => entry.name);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
