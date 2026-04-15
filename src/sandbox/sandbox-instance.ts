/**
 * @tolu/cowork-core — Abstract SandboxInstance
 *
 * Base class for all sandbox implementations.
 * Concrete subclasses handle execution strategy
 * (host, path-restricted, or Docker-isolated).
 */

import type { SandboxConfig, SandboxInfo, SandboxLevel, ExecResult, ExecOptions, SandboxFileSystem } from "./types.js";

/**
 * Abstract sandbox providing a uniform interface for command execution
 * and file operations regardless of isolation level.
 */
export abstract class SandboxInstance {
  /** Unique identifier for this sandbox. */
  protected readonly id: string;
  /** Original configuration used to create this sandbox. */
  protected readonly config: SandboxConfig;
  /** Epoch timestamp (ms) when the sandbox was created. */
  protected readonly createdAt: number;
  /** Current lifecycle status. */
  protected status: "running" | "stopped" | "error" = "running";

  protected constructor(id: string, config: SandboxConfig) {
    this.id = id;
    this.config = config;
    this.createdAt = Date.now();
  }

  /**
   * Execute a command inside this sandbox.
   *
   * @param command - The shell command or binary to run.
   * @param args - Optional positional arguments forwarded to the command.
   * @param options - Execution options (timeout, cwd, env, signal).
   * @returns The execution result including stdout, stderr, exit code, and timing.
   */
  abstract execute(command: string, args?: string[], options?: ExecOptions): Promise<ExecResult>;

  /**
   * Map a host-absolute path to the corresponding path visible inside
   * this sandbox.
   *
   * - Host sandbox → returns the path unchanged.
   * - Docker sandbox → maps to `/workspace/...` inside the container.
   *
   * @param hostPath - Absolute path on the host machine.
   * @returns The path as seen from within the sandbox.
   */
  abstract resolvePath(hostPath: string): string;

  /**
   * Get a file-system interface scoped to this sandbox.
   * All operations are subject to the sandbox's access policy.
   */
  abstract getFileSystem(): SandboxFileSystem;

  /**
   * Tear down the sandbox — stop containers, release resources, etc.
   * After destruction the instance must not be reused.
   */
  abstract destroy(): Promise<void>;

  /**
   * Return runtime metadata about this sandbox.
   */
  getInfo(): SandboxInfo {
    return {
      id: this.id,
      level: this.config.level as SandboxLevel,
      createdAt: this.createdAt,
      status: this.status,
    };
  }

  /**
   * The unique sandbox identifier.
   */
  getId(): string {
    return this.id;
  }
}
