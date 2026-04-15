/**
 * @tolu/cowork-core — Sandbox manager
 *
 * Factory and registry for sandbox instances.
 * Creates the appropriate SandboxInstance subclass based on
 * the configured isolation level and manages their lifecycle.
 */

import * as crypto from "node:crypto";
import type { SandboxConfig } from "./types.js";
import { SandboxConfigSchema, SandboxLevel } from "./types.js";
import { SandboxInstance } from "./sandbox-instance.js";
import { HostSandbox } from "./host-executor.js";
import { PathSandbox } from "./path-sandbox.js";
import { DockerSandbox } from "./docker-sandbox.js";
import { SandboxCreationError } from "./errors.js";

/**
 * Manages sandbox lifecycle — creation, lookup, validation, and teardown.
 *
 * Maintains an internal map of active sandbox instances keyed by unique IDs.
 */
export class SandboxManager {
  /** Active sandbox instances keyed by ID. */
  private readonly sandboxes: Map<string, SandboxInstance> = new Map();

  /**
   * Create a new sandbox based on the given configuration.
   *
   * Validates the config with zod, generates a unique ID, instantiates
   * the correct SandboxInstance subclass, and (for Docker) initialises
   * the container.
   *
   * @param config - Sandbox configuration.
   * @returns The created and initialised sandbox instance.
   * @throws {SandboxCreationError} When the config is invalid or sandbox initialisation fails.
   */
  async createSandbox(config: SandboxConfig): Promise<SandboxInstance> {
    // Validate configuration
    const parsed = SandboxConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new SandboxCreationError(
        `Invalid sandbox config: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }

    // Level-specific validation
    if (config.level === SandboxLevel.Docker && !config.docker) {
      throw new SandboxCreationError(
        "Docker sandbox requires 'docker' configuration block",
      );
    }

    if (config.level === SandboxLevel.PathOnly && !config.pathSandbox) {
      throw new SandboxCreationError(
        "Path-only sandbox requires 'pathSandbox' configuration block",
      );
    }

    const id = crypto.randomUUID();
    let sandbox: SandboxInstance;

    switch (config.level) {
      case SandboxLevel.None:
        sandbox = new HostSandbox(id, config);
        break;

      case SandboxLevel.PathOnly:
        sandbox = new PathSandbox(id, config);
        break;

      case SandboxLevel.Docker: {
        const dockerSandbox = new DockerSandbox(id, config);
        await dockerSandbox.initialize();
        sandbox = dockerSandbox;
        break;
      }

      default:
        throw new SandboxCreationError(
          `Unknown sandbox level: ${String(config.level)}`,
        );
    }

    this.sandboxes.set(id, sandbox);
    return sandbox;
  }

  /**
   * Destroy a sandbox and remove it from the registry.
   *
   * @param id - Sandbox identifier returned by `createSandbox`.
   * @throws {SandboxCreationError} When the sandbox does not exist.
   */
  async destroySandbox(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id);
    if (!sandbox) {
      throw new SandboxCreationError(`Sandbox '${id}' not found`);
    }

    await sandbox.destroy();
    this.sandboxes.delete(id);
  }

  /**
   * Retrieve a sandbox by ID.
   *
   * @param id - Sandbox identifier.
   * @returns The sandbox instance, or `undefined` if not found.
   */
  getSandbox(id: string): SandboxInstance | undefined {
    return this.sandboxes.get(id);
  }

  /**
   * List all active sandbox instances.
   *
   * @returns Array of all registered sandbox instances.
   */
  listSandboxes(): SandboxInstance[] {
    return [...this.sandboxes.values()];
  }

  /**
   * Validate whether a given path may be accessed within a sandbox.
   *
   * - `none` level: all paths are accessible.
   * - `path-only` level: delegates to the PathSandbox validator.
   * - `docker` level: always allowed (isolation is handled by the container).
   *
   * @param sandboxId - Identifier of the sandbox to check.
   * @param targetPath - Absolute path to validate.
   * @param mode - Access mode (read, write, or execute).
   * @returns `true` if access is permitted, `false` otherwise.
   */
  validateAccess(
    sandboxId: string,
    targetPath: string,
    mode: "read" | "write" | "execute",
  ): boolean {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      return false;
    }

    // Host and Docker sandboxes do not restrict paths
    if (sandbox instanceof PathSandbox) {
      try {
        sandbox.validatePath(targetPath, mode);
        return true;
      } catch {
        return false;
      }
    }

    return true;
  }
}
