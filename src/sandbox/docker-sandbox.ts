/**
 * @tolu/cowork-core — Docker sandbox (level = "docker")
 *
 * Full container isolation using Docker CLI.
 * Commands run via `docker exec <container> sh -c <command>`.
 * Container lifecycle managed through `docker create/start/stop/rm`.
 * Uses child_process.spawn — no dockerode dependency.
 */

import * as path from "node:path";
import { SandboxInstance } from "./sandbox-instance.js";
import { HostSandbox, shellEscape } from "./host-executor.js";
import type { SandboxConfig, ExecResult, ExecOptions, SandboxFileSystem } from "./types.js";
import { SandboxCreationError, SandboxExecutionError } from "./errors.js";

/** Default directory mounted inside the container. */
const CONTAINER_WORKSPACE = "/workspace";

/** Maximum bytes kept per stdout / stderr stream. */
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Sandbox that executes commands inside a Docker container.
 *
 * Uses the Docker CLI directly (`docker exec`, `docker create`, etc.)
 * via child_process.spawn — no Docker SDK required.
 */
export class DockerSandbox extends SandboxInstance {
  /** Underlying host sandbox used to invoke Docker CLI commands. */
  private readonly hostSandbox: HostSandbox;
  /** Docker image used for this sandbox. */
  private readonly image: string;
  /** Name of the Docker container. */
  private readonly containerName: string;
  /** Host path that is mounted as the workspace. */
  private readonly workspaceMount: string;
  /** Whether the container was created by this instance. */
  private ownsContainer = false;

  constructor(id: string, config: SandboxConfig) {
    super(id, config);
    this.hostSandbox = new HostSandbox(id, config);

    if (!config.docker) {
      throw new SandboxCreationError(
        "DockerSandbox requires docker configuration",
        id,
      );
    }

    this.image = config.docker.image;
    this.containerName = config.docker.containerName;
    this.workspaceMount = config.docker.workspaceMount;
  }

  /**
   * Create and start the Docker container.
   * Called automatically by the SandboxManager after construction.
   *
   * @throws {SandboxCreationError} When Docker is unavailable or container creation fails.
   */
  async initialize(): Promise<void> {
    // Check if Docker is available
    try {
      await this.hostSandbox.execute("docker", ["--version"]);
    } catch {
      throw new SandboxCreationError(
        "Docker is not installed or not in PATH",
        this.id,
      );
    }

    // Build docker create command with resource limits
    const createArgs = this.buildCreateArgs();

    try {
      const result = await this.hostSandbox.execute("docker", createArgs);
      if (result.exitCode !== 0) {
        throw new SandboxCreationError(
          `Failed to create container '${this.containerName}': ${result.stderr}`,
          this.id,
        );
      }
      this.ownsContainer = true;
    } catch (err) {
      if (err instanceof SandboxCreationError) throw err;
      throw new SandboxCreationError(
        `Failed to create container: ${err instanceof Error ? err.message : String(err)}`,
        this.id,
      );
    }

    // Start the container
    try {
      const startResult = await this.hostSandbox.execute("docker", ["start", this.containerName]);
      if (startResult.exitCode !== 0) {
        throw new SandboxCreationError(
          `Failed to start container '${this.containerName}': ${startResult.stderr}`,
          this.id,
        );
      }
    } catch (err) {
      if (err instanceof SandboxCreationError) throw err;
      throw new SandboxCreationError(
        `Failed to start container: ${err instanceof Error ? err.message : String(err)}`,
        this.id,
      );
    }
  }

  /**
   * Execute a command inside the Docker container via `docker exec`.
   *
   * The command is shell-escaped and passed to `sh -c` inside the container.
   */
  async execute(command: string, args?: string[], options?: ExecOptions): Promise<ExecResult> {
    const fullCommand = args && args.length > 0
      ? `${command} ${args.map(shellEscape).join(" ")}`
      : command;

    // Build: docker exec <container> sh -c '<command>'
    const dockerCommand = `docker exec ${this.containerName} sh -c ${shellEscape(fullCommand)}`;
    return this.hostSandbox.execute(dockerCommand, [], {
      ...options,
      cwd: options?.cwd ? this.resolvePath(options.cwd) : CONTAINER_WORKSPACE,
    });
  }

  /**
   * Map a host path to the container's workspace path.
   * Extracts the host-side mount source and re-maps to /workspace.
   */
  resolvePath(hostPath: string): string {
    // workspaceMount format: "/host/path:/workspace" or "/host/path:/workspace:rw"
    const parts = this.workspaceMount.split(":");
    const hostRoot = parts[0];
    const containerRoot = parts[1] ?? CONTAINER_WORKSPACE;

    const resolved = path.resolve(hostPath);
    if (resolved.startsWith(hostRoot)) {
      const relative = resolved.slice(hostRoot.length);
      return `${containerRoot}${relative}`;
    }

    // Path is outside the mount — return container root
    return containerRoot;
  }

  /**
   * Return a file system interface that uses `docker exec` for operations.
   */
  getFileSystem(): SandboxFileSystem {
    return new DockerFileSystem(this);
  }

  /**
   * Stop and remove the Docker container.
   */
  async destroy(): Promise<void> {
    if (!this.ownsContainer) {
      this.status = "stopped";
      return;
    }

    try {
      await this.hostSandbox.execute("docker", ["stop", this.containerName], {
        timeout: 10_000,
      });
    } catch {
      // Container may already be stopped
    }

    try {
      await this.hostSandbox.execute("docker", ["rm", "-f", this.containerName], {
        timeout: 10_000,
      });
    } catch {
      // Container may already be removed
    }

    this.ownsContainer = false;
    this.status = "stopped";
  }

  /**
   * Build `docker create` arguments from configuration.
   */
  private buildCreateArgs(): string[] {
    const args = ["create"];
    const dockerConfig = this.config.docker!;

    // Container name
    args.push("--name", this.containerName);

    // Workspace mount
    args.push("-v", this.workspaceMount);

    // Resource limits
    if (dockerConfig.resourceLimits) {
      const limits = dockerConfig.resourceLimits;

      if (limits.cpuShares) {
        args.push("--cpus", String(limits.cpuShares));
      }

      if (limits.memoryMB) {
        args.push("--memory", `${limits.memoryMB}m`);
      }

      if (limits.maxProcesses) {
        args.push("--pids-limit", String(limits.maxProcesses));
      }
    }

    // Keep container running
    args.push("-d");

    // Image
    args.push(this.image);

    // Keep container alive
    args.push("tail", "-f", "/dev/null");

    return args;
  }
}

/**
 * File system interface that uses `docker exec` for all operations
 * inside a Docker container.
 */
class DockerFileSystem implements SandboxFileSystem {
  constructor(private readonly sandbox: DockerSandbox) {}

  async readFile(filePath: string): Promise<string> {
    const result = await this.sandbox.execute("cat", [filePath]);
    if (result.exitCode !== 0) {
      throw new SandboxExecutionError(
        `Failed to read file '${filePath}': ${result.stderr}`,
        result.exitCode,
        result.stderr,
        this.sandbox.getId(),
      );
    }
    return result.stdout;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    // Use shell escape for the content to safely pass through sh -c
    const escaped = shellEscape(content);
    const result = await this.sandbox.execute(
      `mkdir -p $(dirname ${shellEscape(filePath)}) && printf %s ${escaped} > ${shellEscape(filePath)}`,
    );
    if (result.exitCode !== 0) {
      throw new SandboxExecutionError(
        `Failed to write file '${filePath}': ${result.stderr}`,
        result.exitCode,
        result.stderr,
        this.sandbox.getId(),
      );
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const result = await this.sandbox.execute("ls", ["-1", dirPath]);
    if (result.exitCode !== 0) {
      throw new SandboxExecutionError(
        `Failed to list directory '${dirPath}': ${result.stderr}`,
        result.exitCode,
        result.stderr,
        this.sandbox.getId(),
      );
    }
    return result.stdout.split("\n").filter((line) => line.length > 0);
  }

  async exists(filePath: string): Promise<boolean> {
    const result = await this.sandbox.execute("test", ["-e", filePath]);
    return result.exitCode === 0;
  }
}
