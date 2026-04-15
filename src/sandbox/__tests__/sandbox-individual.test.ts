/**
 * @tolu/cowork-core — Sandbox individual class tests
 *
 * Tests for DockerSandbox, HostSandbox, PathSandbox, SandboxInstance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { HostSandbox, shellEscape } from "../host-executor.js";
import { PathSandbox } from "../path-sandbox.js";
import { DockerSandbox } from "../docker-sandbox.js";
import { PathAccessDeniedError, SandboxCreationError } from "../errors.js";
import { SandboxLevel } from "../types.js";

// ─── HostSandbox ─────────────────────────────────────────────────────────────

describe("HostSandbox", () => {
  const baseConfig = { level: SandboxLevel.None, timeout: 5000 };

  it("shellEscape wraps in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it("shellEscape handles empty string", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("resolvePath returns path unchanged", () => {
    expect(new HostSandbox("t1", baseConfig).resolvePath("/some/path")).toBe("/some/path");
  });

  it("getId returns the sandbox id", () => {
    expect(new HostSandbox("my-id", baseConfig).getId()).toBe("my-id");
  });

  it("getInfo returns metadata", () => {
    const info = new HostSandbox("info-id", baseConfig).getInfo();
    expect(info.id).toBe("info-id");
    expect(info.level).toBe("none");
    expect(info.status).toBe("running");
    expect(info.createdAt).toBeGreaterThan(0);
  });

  it("destroy sets status to stopped", async () => {
    const s = new HostSandbox("dest", baseConfig);
    await s.destroy();
    expect(s.getInfo().status).toBe("stopped");
  });

  it("execute runs a command and captures output", async () => {
    const result = await new HostSandbox("exec-test", baseConfig).execute("echo", ["hello world"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
  });

  it("execute captures non-zero exit code", async () => {
    const result = await new HostSandbox("fail-test", baseConfig).execute("false");
    expect(result.exitCode).not.toBe(0);
  });

  it("execute respects cwd option", async () => {
    const result = await new HostSandbox("cwd-test", baseConfig).execute("pwd", [], { cwd: "/tmp" });
    expect(result.stdout.trim()).toBe("/tmp");
  });

  it("execute times out with short timeout", async () => {
    await expect(new HostSandbox("t", { ...baseConfig, timeout: 100 }).execute("sleep", ["10"])).rejects.toThrow();
  });

  it("getFileSystem returns working fs interface", async () => {
    const fsI = new HostSandbox("fs-test", baseConfig).getFileSystem();
    const tmpFile = path.join(os.tmpdir(), `tolu-test-${Date.now()}.txt`);
    try {
      await fsI.writeFile(tmpFile, "test content");
      expect(await fsI.readFile(tmpFile)).toBe("test content");
      expect(await fsI.exists(tmpFile)).toBe(true);
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  });
});

// ─── PathSandbox ─────────────────────────────────────────────────────────────

describe("PathSandbox", () => {
  const makeConfig = (allowedRoots: string[], deniedPaths: string[] = []) => ({
    level: SandboxLevel.PathOnly,
    pathSandbox: { allowedRoots, deniedPaths },
    timeout: 5000,
  });

  it("allows paths within allowed roots", () => {
    expect(() => new PathSandbox("p1", makeConfig(["/tmp"])).validatePath("/tmp/file.txt", "read")).not.toThrow();
  });

  it("blocks paths outside allowed roots", () => {
    expect(() => new PathSandbox("p2", makeConfig(["/tmp"])).validatePath("/etc/hosts", "read")).toThrow(PathAccessDeniedError);
  });

  it("blocks denied paths even if within allowed root", () => {
    expect(() => new PathSandbox("p3", makeConfig(["/tmp"], ["/tmp/secret"])).validatePath("/tmp/secret/key", "read")).toThrow(PathAccessDeniedError);
  });

  it("blocks default denied paths like /etc/passwd", () => {
    expect(() => new PathSandbox("p4", makeConfig(["/"])).validatePath("/etc/passwd", "read")).toThrow(PathAccessDeniedError);
  });

  it("resolvePath returns the path after validation", () => {
    expect(new PathSandbox("p5", makeConfig(["/tmp"])).resolvePath("/tmp/file.txt")).toBe("/tmp/file.txt");
  });

  it("requires pathSandbox configuration", () => {
    expect(() => new PathSandbox("p6", { level: SandboxLevel.PathOnly, timeout: 5000 })).toThrow();
  });

  it("destroy sets status to stopped", async () => {
    const s = new PathSandbox("p7", makeConfig(["/tmp"]));
    await s.destroy();
    expect(s.getInfo().status).toBe("stopped");
  });

  it("execute validates cwd before running", async () => {
    await expect(new PathSandbox("p8", makeConfig(["/tmp"])).execute("echo", ["hi"], { cwd: "/etc" })).rejects.toThrow(PathAccessDeniedError);
  });

  it("execute runs when cwd is in allowed roots", async () => {
    const result = await new PathSandbox("p9", makeConfig(["/tmp"])).execute("echo", ["allowed"], { cwd: "/tmp" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("allowed");
  });

  it("execute works without cwd option", async () => {
    const result = await new PathSandbox("p10", makeConfig(["/tmp"])).execute("echo", ["no-cwd"]);
    expect(result.exitCode).toBe(0);
  });
});

// ─── DockerSandbox ───────────────────────────────────────────────────────────

describe("DockerSandbox", () => {
  const dockerConfig = {
    level: SandboxLevel.Docker,
    docker: { image: "ubuntu:22.04", containerName: "test-container", workspaceMount: "/host/workspace:/workspace" },
    timeout: 5000,
  };

  it("requires docker configuration", () => {
    expect(() => new DockerSandbox("d1", { level: SandboxLevel.Docker, timeout: 5000 })).toThrow(SandboxCreationError);
  });

  it("resolvePath maps host paths to container paths", () => {
    expect(new DockerSandbox("d2", dockerConfig).resolvePath("/host/workspace/src/file.ts")).toBe("/workspace/src/file.ts");
  });

  it("resolvePath returns container root for paths outside mount", () => {
    expect(new DockerSandbox("d3", dockerConfig).resolvePath("/other/path")).toBe("/workspace");
  });

  it("getId returns the sandbox id", () => {
    expect(new DockerSandbox("d4", dockerConfig).getId()).toBe("d4");
  });

  it("getInfo returns metadata", () => {
    const info = new DockerSandbox("d6", dockerConfig).getInfo();
    expect(info.id).toBe("d6");
    expect(info.level).toBe("docker");
  });
});

// ─── SandboxInstance (abstract base) ─────────────────────────────────────────

describe("SandboxInstance", () => {
  it("HostSandbox provides base class behavior", () => {
    const s = new HostSandbox("base-test", { level: SandboxLevel.None, timeout: 1000 });
    expect(s.getId()).toBe("base-test");
    const info = s.getInfo();
    expect(info.id).toBe("base-test");
    expect(info.level).toBe("none");
    expect(info.status).toBe("running");
    expect(typeof info.createdAt).toBe("number");
  });
});
