/**
 * @tolu/cowork-core — Sandbox manager and instance tests
 *
 * Tests cover creation at each level, destruction, listing,
 * path validation, traversal prevention, timeout handling,
 * buffer limits, Docker command execution, host execution,
 * and access validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { SandboxManager } from "../sandbox-manager.js";
import { HostSandbox, shellEscape, killProcessTree } from "../host-executor.js";
import { PathSandbox } from "../path-sandbox.js";
import { DockerSandbox } from "../docker-sandbox.js";
import { SandboxLevel } from "../types.js";
import type { SandboxConfig } from "../types.js";
import {
  SandboxCreationError,
  SandboxTimeoutError,
  PathAccessDeniedError,
} from "../errors.js";

// ─── Mock child_process.spawn ────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

/**
 * Create a mock child process that simulates spawning a command.
 * Uses EventEmitter with stdout/stderr sub-emitters and a configurable close.
 */
function createMockChildProcess(options?: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  delay?: number;
  pid?: number;
}) {
  const child = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  Object.defineProperty(child, "pid", {
    value: options?.pid ?? 12_345,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(child, "stdin", { value: null, configurable: true });
  Object.defineProperty(child, "stdout", { value: stdout, configurable: true });
  Object.defineProperty(child, "stderr", { value: stderr, configurable: true });
  Object.defineProperty(child, "kill", { value: vi.fn(), configurable: true });

  const delay = options?.delay ?? 10;
  setTimeout(() => {
    if (options?.stdout) {
      stdout.emit("data", Buffer.from(options.stdout));
    }
    if (options?.stderr) {
      stderr.emit("data", Buffer.from(options.stderr));
    }
    child.emit("close", options?.exitCode ?? 0);
  }, delay);

  return child;
}

/**
 * Helper that sets up spawn mock to handle Docker container lifecycle
 * (docker --version, docker create, docker start) and returns a function
 * to get the number of spawn calls made.
 */
function mockDockerLifecycle(mockSpawn: ReturnType<typeof vi.mocked<typeof import("node:child_process").spawn>>, execResponse?: { stdout: string }) {
  let callCount = 0;
  mockSpawn.mockImplementation(() => {
    callCount++;
    if (callCount <= 3) {
      // docker --version → create → start
      return createMockChildProcess({ stdout: "ok" }) as ReturnType<typeof import("node:child_process").spawn>;
    }
    // docker exec commands
    return createMockChildProcess(execResponse ?? { stdout: "ok" }) as ReturnType<typeof import("node:child_process").spawn>;
  });
  return () => callCount;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("SandboxManager", () => {
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager();
    vi.clearAllMocks();
  });

  // 1. Creating sandboxes at each level
  it("should create a host sandbox (level=none)", async () => {
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(
      createMockChildProcess({ stdout: "ok" }) as ReturnType<typeof spawn>,
    );

    const sandbox = await manager.createSandbox({ level: SandboxLevel.None });
    expect(sandbox).toBeInstanceOf(HostSandbox);
    expect(sandbox.getInfo().level).toBe(SandboxLevel.None);
    expect(sandbox.getInfo().status).toBe("running");
  });

  it("should create a path sandbox (level=path-only)", async () => {
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: {
        allowedRoots: ["/tmp/test"],
        deniedPaths: [],
      },
    });
    expect(sandbox).toBeInstanceOf(PathSandbox);
    expect(sandbox.getInfo().level).toBe(SandboxLevel.PathOnly);
  });

  it("should create a docker sandbox (level=docker)", async () => {
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);
    mockDockerLifecycle(mockSpawn);

    const sandbox = await manager.createSandbox({
      level: SandboxLevel.Docker,
      docker: {
        image: "ubuntu:22.04",
        containerName: "test-container",
        workspaceMount: "/tmp/workspace:/workspace",
      },
    });
    expect(sandbox).toBeInstanceOf(DockerSandbox);
    expect(sandbox.getInfo().level).toBe(SandboxLevel.Docker);
  });

  // 2. Destroying sandboxes
  it("should destroy a sandbox and remove it from the registry", async () => {
    const sandbox = await manager.createSandbox({ level: SandboxLevel.None });
    const id = sandbox.getId();

    await manager.destroySandbox(id);
    expect(manager.getSandbox(id)).toBeUndefined();
    expect(sandbox.getInfo().status).toBe("stopped");
  });

  it("should throw when destroying a non-existent sandbox", async () => {
    await expect(
      manager.destroySandbox("non-existent-id"),
    ).rejects.toThrow(SandboxCreationError);
  });

  // 3. Listing sandboxes
  it("should list all active sandboxes", async () => {
    const s1 = await manager.createSandbox({ level: SandboxLevel.None });
    const s2 = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/tmp"], deniedPaths: [] },
    });

    const listed = manager.listSandboxes();
    expect(listed).toHaveLength(2);
    expect(listed.map((s) => s.getId())).toContain(s1.getId());
    expect(listed.map((s) => s.getId())).toContain(s2.getId());
  });

  // 4. Path validation (allowed/denied)
  it("should allow access to paths within allowed roots", async () => {
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/tmp/test"], deniedPaths: [] },
    });
    const id = sandbox.getId();

    expect(manager.validateAccess(id, "/tmp/test/file.txt", "read")).toBe(true);
    expect(manager.validateAccess(id, "/tmp/test/sub/dir", "write")).toBe(true);
  });

  it("should deny access to paths outside allowed roots", async () => {
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/tmp/test"], deniedPaths: [] },
    });
    const id = sandbox.getId();

    expect(manager.validateAccess(id, "/etc/hosts", "read")).toBe(false);
    expect(manager.validateAccess(id, "/tmp/other", "write")).toBe(false);
  });

  it("should deny access to explicitly denied paths", async () => {
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: {
        allowedRoots: ["/tmp"],
        deniedPaths: ["/tmp/secret"],
      },
    });
    const id = sandbox.getId();

    expect(manager.validateAccess(id, "/tmp/secret/key.pem", "read")).toBe(false);
  });

  // 5. Path traversal prevention
  it("should prevent path traversal attacks", async () => {
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/tmp/safe"], deniedPaths: [] },
    });
    const id = sandbox.getId();

    // /tmp/safe/../etc/passwd resolves to /etc/passwd
    expect(manager.validateAccess(id, "/tmp/safe/../etc/passwd", "read")).toBe(false);
  });

  it("should deny default blacklisted paths", async () => {
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/"], deniedPaths: [] },
    });
    const id = sandbox.getId();

    expect(manager.validateAccess(id, "/etc/passwd", "read")).toBe(false);
    expect(manager.validateAccess(id, "/etc/shadow", "read")).toBe(false);
    expect(manager.validateAccess(id, "/root/.ssh/id_rsa", "read")).toBe(false);
    expect(manager.validateAccess(id, "/proc/1/cmdline", "read")).toBe(false);
  });

  // 6. Timeout handling
  it("should reject with SandboxTimeoutError when command times out", async () => {
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);

    // Create a child with custom pid that won't auto-close
    const child = createMockChildProcess({ pid: 99_999, delay: 999_999 });
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);

    const mockKill = vi.spyOn(process, "kill").mockImplementation((pid: number) => {
      if (pid === -99_999 || pid === 99_999) {
        setTimeout(() => child.emit("close", null), 5);
      }
      return true;
    });

    const sandbox = await manager.createSandbox({
      level: SandboxLevel.None,
      timeout: 50,
    });

    await expect(sandbox.execute("sleep", ["10"])).rejects.toThrow(SandboxTimeoutError);

    mockKill.mockRestore();
  });

  // 7. Buffer limit enforcement
  it("should truncate stdout/stderr at 10MB", async () => {
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);

    const child = createMockChildProcess({ delay: 999_999 });
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);

    const bigChunk = "x".repeat(1024 * 1024); // 1MB
    const stdout = (child as unknown as { stdout: EventEmitter }).stdout;
    for (let i = 0; i < 12; i++) {
      stdout.emit("data", Buffer.from(bigChunk));
    }
    setTimeout(() => child.emit("close", 0), 10);

    const sandbox = await manager.createSandbox({ level: SandboxLevel.None });
    const result = await sandbox.execute("big-output");

    expect(result.stdout.length).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  // 8. DockerSandbox command execution (mock docker commands)
  it("should execute commands via docker exec", async () => {
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);
    mockDockerLifecycle(mockSpawn, { stdout: "hello from container" });

    const sandbox = await manager.createSandbox({
      level: SandboxLevel.Docker,
      docker: {
        image: "ubuntu:22.04",
        containerName: "exec-test",
        workspaceMount: "/host:/workspace",
      },
    });

    const result = await sandbox.execute("echo", ["hello"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello from container");
  });

  // 9. HostSandbox execution
  it("should execute commands on the host and return result", async () => {
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue(
      createMockChildProcess({ stdout: "hello world", exitCode: 0 }) as ReturnType<typeof spawn>,
    );

    const sandbox = await manager.createSandbox({ level: SandboxLevel.None });
    const result = await sandbox.execute("echo", ["hello world"]);

    expect(result.stdout).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  // 10. Access validation
  it("should return true for host sandbox access validation", async () => {
    const sandbox = await manager.createSandbox({ level: SandboxLevel.None });
    const id = sandbox.getId();

    expect(manager.validateAccess(id, "/any/path", "read")).toBe(true);
    expect(manager.validateAccess(id, "/any/path", "write")).toBe(true);
    expect(manager.validateAccess(id, "/any/path", "execute")).toBe(true);
  });

  it("should return false for unknown sandbox in validateAccess", () => {
    expect(manager.validateAccess("unknown-id", "/tmp", "read")).toBe(false);
  });

  // 11. Invalid config rejection
  it("should reject invalid sandbox configuration", async () => {
    await expect(
      manager.createSandbox({ level: SandboxLevel.PathOnly } as SandboxConfig),
    ).rejects.toThrow(SandboxCreationError);
  });

  it("should reject docker sandbox without docker config", async () => {
    await expect(
      manager.createSandbox({ level: SandboxLevel.Docker } as SandboxConfig),
    ).rejects.toThrow(SandboxCreationError);
  });
});

describe("shellEscape", () => {
  it("should escape single quotes in shell arguments", () => {
    expect(shellEscape("hello")).toBe("'hello'");
    expect(shellEscape("it's")).toBe("'it'\\''s'");
    expect(shellEscape("")).toBe("''");
  });
});

describe("killProcessTree", () => {
  it("should attempt to kill process group on unix", () => {
    const mockKill = vi.spyOn(process, "kill").mockImplementation(() => true);

    if (process.platform !== "win32") {
      killProcessTree(1234);
      expect(mockKill).toHaveBeenCalledWith(-1234, "SIGKILL");
    }

    mockKill.mockRestore();
  });
});

describe("PathSandbox resolvePath", () => {
  it("should throw PathAccessDeniedError for denied paths", async () => {
    const manager = new SandboxManager();
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/tmp/test"], deniedPaths: [] },
    });

    expect(() => sandbox.resolvePath("/etc/passwd")).toThrow(PathAccessDeniedError);
  });

  it("should return the path unchanged for allowed paths", async () => {
    const manager = new SandboxManager();
    const sandbox = await manager.createSandbox({
      level: SandboxLevel.PathOnly,
      pathSandbox: { allowedRoots: ["/tmp/test"], deniedPaths: [] },
    });

    expect(sandbox.resolvePath("/tmp/test/file.txt")).toBe("/tmp/test/file.txt");
  });
});

describe("DockerSandbox resolvePath", () => {
  it("should map host paths to container workspace", async () => {
    const manager = new SandboxManager();
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);
    mockDockerLifecycle(mockSpawn);

    const sandbox = await manager.createSandbox({
      level: SandboxLevel.Docker,
      docker: {
        image: "ubuntu:22.04",
        containerName: "resolve-test",
        workspaceMount: "/host/project:/workspace",
      },
    });

    expect(sandbox.resolvePath("/host/project/src/index.ts")).toBe(
      "/workspace/src/index.ts",
    );
  });

  it("should return container root for paths outside mount", async () => {
    const manager = new SandboxManager();
    const { spawn } = await import("node:child_process");
    const mockSpawn = vi.mocked(spawn);
    mockDockerLifecycle(mockSpawn);

    const sandbox = await manager.createSandbox({
      level: SandboxLevel.Docker,
      docker: {
        image: "ubuntu:22.04",
        containerName: "resolve-test2",
        workspaceMount: "/host/project:/workspace",
      },
    });

    expect(sandbox.resolvePath("/other/path")).toBe("/workspace");
  });
});
