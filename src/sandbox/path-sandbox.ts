/**
 * @tolu/cowork-core — Path-restricted sandbox (level = "path-only")
 *
 * Host execution with filesystem access control.
 * Normalizes paths, enforces allowed-roots whitelist,
 * and blocks sensitive system paths by default.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SandboxInstance } from "./sandbox-instance.js";
import { HostSandbox, shellEscape } from "./host-executor.js";
import type { SandboxConfig, ExecResult, ExecOptions, SandboxFileSystem } from "./types.js";
import { PathAccessDeniedError } from "./errors.js";

/** Paths that are always denied regardless of configuration. */
const DEFAULT_DENIED_PATHS: string[] = [
  "/etc/passwd",
  "/etc/shadow",
  "/root/.ssh",
  path.join(process.env.HOME ?? "/root", ".gnupg"),
  "/proc",
  "/sys",
];

/**
 * Sandbox that restricts file access to whitelisted directories
 * while executing commands on the host.
 */
export class PathSandbox extends SandboxInstance {
  /** Underlying host sandbox used for command execution. */
  private readonly hostSandbox: HostSandbox;
  /** Roots the sandbox is allowed to access. */
  private readonly allowedRoots: string[];
  /** Paths explicitly denied (in addition to defaults). */
  private readonly deniedPaths: string[];

  constructor(id: string, config: SandboxConfig) {
    super(id, config);
    this.hostSandbox = new HostSandbox(id, config);

    const pathConfig = config.pathSandbox;
    if (!pathConfig) {
      throw new Error("PathSandbox requires pathSandbox configuration");
    }

    this.allowedRoots = pathConfig.allowedRoots.map((p) => path.resolve(p));
    this.deniedPaths = [
      ...DEFAULT_DENIED_PATHS.map((p) => path.resolve(p)),
      ...pathConfig.deniedPaths.map((p) => path.resolve(p)),
    ];
  }

  /**
   * Execute a command on the host after validating the working directory.
   * The command itself runs without path restrictions — only the cwd
   * is validated to ensure it falls within allowed roots.
   */
  async execute(command: string, args?: string[], options?: ExecOptions): Promise<ExecResult> {
    if (options?.cwd) {
      this.validatePath(options.cwd, "execute");
    }
    return this.hostSandbox.execute(command, args, options);
  }

  /**
   * Validate that a host path is within allowed roots, then return it.
   * Throws PathAccessDeniedError if the path is outside allowed roots
   * or matches a denied path.
   */
  resolvePath(hostPath: string): string {
    this.validatePath(hostPath, "read");
    return hostPath;
  }

  /**
   * Return a file-system interface that enforces path validation
   * on every operation.
   */
  getFileSystem(): SandboxFileSystem {
    return new PathRestrictedFileSystem(this);
  }

  /**
   * No additional cleanup beyond the host sandbox.
   */
  async destroy(): Promise<void> {
    this.status = "stopped";
  }

  /**
   * Check whether a path is within any allowed root and not denied.
   *
   * @param targetPath - The path to validate.
   * @param mode - Access mode for error reporting.
   * @throws {PathAccessDeniedError} When access is denied.
   */
  validatePath(targetPath: string, mode: "read" | "write" | "execute"): void {
    const resolved = path.resolve(targetPath);

    // Check denied paths first (highest priority)
    for (const denied of this.deniedPaths) {
      if (resolved === denied || resolved.startsWith(denied + path.sep)) {
        throw new PathAccessDeniedError(
          `Access denied: '${resolved}' is a restricted path`,
          resolved,
          mode,
          this.id,
        );
      }
    }

    // Check allowed roots
    const isAllowed = this.allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    );

    if (!isAllowed) {
      throw new PathAccessDeniedError(
        `Access denied: '${resolved}' is outside allowed roots [${this.allowedRoots.join(", ")}]`,
        resolved,
        mode,
        this.id,
      );
    }
  }
}

/**
 * File system that validates every path against the PathSandbox policy.
 */
class PathRestrictedFileSystem implements SandboxFileSystem {
  constructor(private readonly sandbox: PathSandbox) {}

  async readFile(filePath: string): Promise<string> {
    this.sandbox.validatePath(filePath, "read");
    return fs.readFile(filePath, "utf-8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.sandbox.validatePath(filePath, "write");
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  async listFiles(dirPath: string): Promise<string[]> {
    this.sandbox.validatePath(dirPath, "read");
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => entry.name);
  }

  async exists(filePath: string): Promise<boolean> {
    this.sandbox.validatePath(filePath, "read");
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
