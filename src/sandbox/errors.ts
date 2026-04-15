/**
 * @tolu/cowork-core — Sandbox error classes
 *
 * Custom error hierarchy for sandbox operations.
 * All errors extend SandboxError for unified catch handling.
 */

/**
 * Base error for all sandbox-related failures.
 */
export class SandboxError extends Error {
  /** Sandbox identifier this error originated from. */
  public readonly sandboxId?: string;

  constructor(message: string, sandboxId?: string) {
    super(message);
    this.name = "SandboxError";
    this.sandboxId = sandboxId;
  }
}

/**
 * Thrown when a sandbox cannot be created (e.g. Docker unavailable).
 */
export class SandboxCreationError extends SandboxError {
  constructor(message: string, sandboxId?: string) {
    super(message, sandboxId);
    this.name = "SandboxCreationError";
  }
}

/**
 * Thrown when command execution inside a sandbox fails.
 */
export class SandboxExecutionError extends SandboxError {
  /** Exit code returned by the process. */
  public readonly exitCode: number;
  /** Captured standard error output. */
  public readonly stderr: string;

  constructor(message: string, exitCode: number, stderr: string, sandboxId?: string) {
    super(message, sandboxId);
    this.name = "SandboxExecutionError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Thrown when a command exceeds its configured timeout.
 */
export class SandboxTimeoutError extends SandboxError {
  /** Configured timeout in milliseconds. */
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, sandboxId?: string) {
    super(message, sandboxId);
    this.name = "SandboxTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when a path access is denied by sandbox policy.
 */
export class PathAccessDeniedError extends SandboxError {
  /** The path that was accessed. */
  public readonly path: string;
  /** Whether the access attempt was read, write, or execute. */
  public readonly mode: "read" | "write" | "execute";

  constructor(message: string, path: string, mode: "read" | "write" | "execute", sandboxId?: string) {
    super(message, sandboxId);
    this.name = "PathAccessDeniedError";
    this.path = path;
    this.mode = mode;
  }
}
