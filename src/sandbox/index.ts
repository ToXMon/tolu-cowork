/**
 * @tolu/cowork-core — Sandbox barrel export
 *
 * Re-exports all sandbox types, classes, and errors.
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export {
  SandboxLevel,
  ResourceLimitsSchema,
  DockerConfigSchema,
  PathSandboxConfigSchema,
  SandboxConfigSchema,
} from "./types.js";

export type {
  ResourceLimits,
  DockerConfig,
  PathSandboxConfig,
  SandboxConfig,
  ExecResult,
  ExecOptions,
  FileAccessPolicy,
  SandboxInfo,
  SandboxFileSystem,
} from "./types.js";

// ─── Errors ─────────────────────────────────────────────────────────────────
export {
  SandboxError,
  SandboxCreationError,
  SandboxExecutionError,
  SandboxTimeoutError,
  PathAccessDeniedError,
} from "./errors.js";

// ─── Base Class ─────────────────────────────────────────────────────────────
export { SandboxInstance } from "./sandbox-instance.js";

// ─── Implementations ────────────────────────────────────────────────────────
export { HostSandbox, killProcessTree, shellEscape } from "./host-executor.js";
export { PathSandbox } from "./path-sandbox.js";
export { DockerSandbox } from "./docker-sandbox.js";

// ─── Manager ────────────────────────────────────────────────────────────────
export { SandboxManager } from "./sandbox-manager.js";
