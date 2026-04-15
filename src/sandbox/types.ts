/**
 * @tolu/cowork-core — Sandbox type definitions
 *
 * Configuration types, runtime schemas, and interfaces
 * for the sandbox execution layer.
 */

import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * Sandbox isolation level.
 * - `none`: Direct host execution (trusted environments only)
 * - `path-only`: Host execution with path-based access control
 * - `docker`: Full container isolation via Docker
 */
export enum SandboxLevel {
  None = "none",
  PathOnly = "path-only",
  Docker = "docker",
}

// ─── Zod Schemas ────────────────────────────────────────────────────────────

/**
 * Docker resource limit configuration.
 */
export const ResourceLimitsSchema = z.object({
  /** CPU shares (relative weight, default 1024). */
  cpuShares: z.number().int().positive().optional(),
  /** Memory limit in megabytes. */
  memoryMB: z.number().int().positive().optional(),
  /** Per-command timeout in seconds. */
  timeoutSeconds: z.number().int().positive().optional(),
  /** Maximum number of processes inside the container. */
  maxProcesses: z.number().int().positive().optional(),
  /** Maximum size of a single file in bytes. */
  maxFileSize: z.number().int().positive().optional(),
});

/**
 * Docker-specific sandbox configuration.
 */
export const DockerConfigSchema = z.object({
  /** Docker image to use (e.g. "ubuntu:22.04"). */
  image: z.string().min(1),
  /** Name for the created container. */
  containerName: z.string().min(1),
  /** Workspace mount specification (e.g. "/host/path:/workspace"). */
  workspaceMount: z.string().min(1),
  /** Optional resource limits applied to the container. */
  resourceLimits: ResourceLimitsSchema.optional(),
});

/**
 * Path-based sandbox configuration.
 */
export const PathSandboxConfigSchema = z.object({
  /** List of directory roots that are accessible. */
  allowedRoots: z.array(z.string()).min(1),
  /** List of specific paths that are explicitly denied. */
  deniedPaths: z.array(z.string()),
});

/**
 * Full sandbox configuration.
 */
export const SandboxConfigSchema = z.object({
  /** Isolation level. */
  level: z.nativeEnum(SandboxLevel),
  /** Docker configuration (required when level is "docker"). */
  docker: DockerConfigSchema.optional(),
  /** Path sandbox configuration (required when level is "path-only"). */
  pathSandbox: PathSandboxConfigSchema.optional(),
  /** Default command timeout in milliseconds. */
  timeout: z.number().int().positive().optional(),
});

// ─── Inferred Types ─────────────────────────────────────────────────────────

/** Docker resource limit configuration. */
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;

/** Docker-specific sandbox configuration. */
export type DockerConfig = z.infer<typeof DockerConfigSchema>;

/** Path-based sandbox configuration. */
export type PathSandboxConfig = z.infer<typeof PathSandboxConfigSchema>;

/** Full sandbox configuration. */
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

// ─── Execution Types ────────────────────────────────────────────────────────

/**
 * Result of a sandboxed command execution.
 */
export interface ExecResult {
  /** Captured standard output (truncated at 10 MB). */
  stdout: string;
  /** Captured standard error (truncated at 10 MB). */
  stderr: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  /** Whether the command was killed due to timeout. */
  timedOut: boolean;
  /** Wall-clock execution duration in milliseconds. */
  duration: number;
}

/**
 * Options passed to individual execute() calls.
 */
export interface ExecOptions {
  /** Per-command timeout in milliseconds (overrides sandbox default). */
  timeout?: number;
  /** Working directory for the command. */
  cwd?: string;
  /** Environment variables to set for the command. */
  env?: Record<string, string>;
  /** AbortSignal to cancel the running command. */
  signal?: AbortSignal;
}

// ─── File Access ────────────────────────────────────────────────────────────

/**
 * File access policy for path-based sandboxing.
 */
export interface FileAccessPolicy {
  /** Whether `paths` is a whitelist or blacklist. */
  mode: "whitelist" | "blacklist";
  /** Paths affected by the policy. */
  paths: string[];
}

// ─── Sandbox Info ───────────────────────────────────────────────────────────

/**
 * Runtime metadata about a sandbox instance.
 */
export interface SandboxInfo {
  /** Unique sandbox identifier. */
  id: string;
  /** Isolation level. */
  level: SandboxLevel;
  /** Epoch timestamp (ms) when the sandbox was created. */
  createdAt: number;
  /** Current sandbox status. */
  status: "running" | "stopped" | "error";
}

// ─── File System Interface ─────────────────────────────────────────────────

/**
 * File system operations scoped to a sandbox.
 * All paths are relative to the sandbox root.
 */
export interface SandboxFileSystem {
  /**
   * Read a file's contents as UTF-8 text.
   * @param path - File path within the sandbox.
   * @returns File contents as a string.
   */
  readFile(path: string): Promise<string>;

  /**
   * Write content to a file, creating parent directories as needed.
   * @param path - File path within the sandbox.
   * @param content - Content to write.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * List files and directories at the given path.
   * @param path - Directory path within the sandbox.
   * @returns Array of entry names.
   */
  listFiles(path: string): Promise<string[]>;

  /**
   * Check whether a path exists within the sandbox.
   * @param path - Path to check.
   * @returns `true` if the path exists.
   */
  exists(path: string): Promise<boolean>;
}
