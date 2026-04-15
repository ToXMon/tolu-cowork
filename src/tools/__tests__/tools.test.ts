/**
 * @tolu/cowork-core — Tools module tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ReadTool, WriteTool, EditTool, ListTool } from "../file-tools.js";
import { BashTool } from "../bash-tool.js";
import { GrepTool, FindTool, GlobTool } from "../search-tool.js";
import { WebSearchTool } from "../web-tool.js";
import { ToolLoader } from "../tool-loader.js";
import { toToluTool } from "../tool-interface.js";
import type { ToolExecutionContext, ToluToolDefinition } from "../tool-interface.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

const baseContext: ToolExecutionContext = {
  workingDirectory: "/tmp",
  sessionId: "test-session",
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tolu-test-"));
  baseContext.workingDirectory = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ─── Tool Interface Tests ────────────────────────────────────────────────────

describe("toToluTool", () => {
  it("converts ToluToolDefinition to ToluTool", () => {
    const def: ToluToolDefinition = {
      name: "test",
      description: "Test tool",
      parameters: {} as any,
      parameterSchema: {
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
      },
      execute: async () => ({ toolCallId: "", toolName: "", content: [], isError: false, duration: 0 }),
    };
    const tool = toToluTool(def);
    expect(tool.name).toBe("test");
    expect(tool.description).toBe("Test tool");
    expect(tool.parameters).toEqual(def.parameterSchema);
  });
});

// ─── File Tool Tests ─────────────────────────────────────────────────────────

describe("ReadTool", () => {
  it("reads a file with line numbers", async () => {
    await fs.writeFile(path.join(tmpDir, "test.txt"), "line1\nline2\nline3");
    const result = await ReadTool.execute({ path: "test.txt" }, baseContext);
    expect(result.isError).toBe(false);
    const text = result.content[0];
    expect(text.type).toBe("text");
    expect((text as { type: "text"; text: string }).text).toContain("1: line1");
    expect((text as { type: "text"; text: string }).text).toContain("2: line2");
  });

  it("reads a line range", async () => {
    await fs.writeFile(path.join(tmpDir, "ranged.txt"), "a\nb\nc\nd\ne");
    const result = await ReadTool.execute({ path: "ranged.txt", startLine: 2, endLine: 4 }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("2: b");
    expect(text).toContain("4: d");
    expect(text).not.toContain("1: a");
  });

  it("returns error for missing file", async () => {
    const result = await ReadTool.execute({ path: "nonexistent.txt" }, baseContext);
    expect(result.isError).toBe(true);
  });

  it("validates arguments", async () => {
    const result = await ReadTool.execute({}, baseContext);
    expect(result.isError).toBe(true);
  });
});

describe("WriteTool", () => {
  it("writes a file and creates dirs", async () => {
    const filePath = path.join(tmpDir, "sub", "dir", "file.txt");
    const result = await WriteTool.execute(
      { path: "sub/dir/file.txt", content: "hello world" },
      baseContext,
    );
    expect(result.isError).toBe(false);
    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("hello world");
  });
});

describe("EditTool", () => {
  it("applies line-range edits", async () => {
    await fs.writeFile(path.join(tmpDir, "edit.txt"), "line1\nline2\nline3\nline4");
    const result = await EditTool.execute(
      { path: "edit.txt", edits: [{ from: 2, to: 3, content: "replaced" }] },
      baseContext,
    );
    expect(result.isError).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, "edit.txt"), "utf-8");
    expect(content).toBe("line1\nreplaced\nline4");
  });

  it("inserts lines before a position", async () => {
    await fs.writeFile(path.join(tmpDir, "insert.txt"), "a\nb\nc");
    const result = await EditTool.execute(
      { path: "insert.txt", edits: [{ from: 2, content: "inserted" }] },
      baseContext,
    );
    expect(result.isError).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, "insert.txt"), "utf-8");
    expect(content).toBe("a\ninserted\nb\nc");
  });

  it("deletes lines", async () => {
    await fs.writeFile(path.join(tmpDir, "delete.txt"), "a\nb\nc");
    const result = await EditTool.execute(
      { path: "delete.txt", edits: [{ from: 2, to: 2 }] },
      baseContext,
    );
    expect(result.isError).toBe(false);
    const content = await fs.readFile(path.join(tmpDir, "delete.txt"), "utf-8");
    expect(content).toBe("a\nc");
  });

  it("rejects out-of-range line numbers", async () => {
    await fs.writeFile(path.join(tmpDir, "short.txt"), "a\nb");
    const result = await EditTool.execute(
      { path: "short.txt", edits: [{ from: 10, to: 15, content: "x" }] },
      baseContext,
    );
    expect(result.isError).toBe(true);
  });
});

describe("ListTool", () => {
  it("lists directory contents", async () => {
    await fs.writeFile(path.join(tmpDir, "a.txt"), "a");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "b.txt"), "b");
    const result = await ListTool.execute({ path: "." }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("a.txt");
    expect(text).toContain("subdir/");
  });

  it("lists recursively", async () => {
    await fs.mkdir(path.join(tmpDir, "deep", "inner"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "deep", "inner", "f.txt"), "f");
    const result = await ListTool.execute({ path: ".", recursive: true }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("f.txt");
  });
});

// ─── Bash Tool Tests ─────────────────────────────────────────────────────────

describe("BashTool", () => {
  it("executes a command and returns output", async () => {
    const result = await BashTool.execute({ command: "echo hello" }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("hello");
  });

  it("captures stderr and exit code on failure", async () => {
    const result = await BashTool.execute(
      { command: "echo err >&2 && exit 1" },
      baseContext,
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("err");
  });

  it("blocks dangerous commands", async () => {
    const result = await BashTool.execute({ command: "rm -rf /" }, baseContext);
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Refusing");
  });

  it("blocks mkfs", async () => {
    const result = await BashTool.execute({ command: "mkfs.ext4 /dev/sda1" }, baseContext);
    expect(result.isError).toBe(true);
  });

  it("blocks dd if=/dev/zero", async () => {
    const result = await BashTool.execute({ command: "dd if=/dev/zero of=/dev/sda" }, baseContext);
    expect(result.isError).toBe(true);
  });

  it("validates arguments", async () => {
    const result = await BashTool.execute({}, baseContext);
    expect(result.isError).toBe(true);
  });

  it("uses working directory from context", async () => {
    const result = await BashTool.execute({ command: "pwd" }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain(tmpDir);
  });
});

// ─── Search Tool Tests ───────────────────────────────────────────────────────

describe("GrepTool", () => {
  it("finds matching lines", async () => {
    await fs.writeFile(path.join(tmpDir, "code.ts"), "hello world\nfoo bar\nhello again");
    const result = await GrepTool.execute({ pattern: "hello", path: "." }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("hello");
  });

  it("returns no matches gracefully", async () => {
    await fs.writeFile(path.join(tmpDir, "x.txt"), "nothing relevant");
    const result = await GrepTool.execute({ pattern: "xyzZY", path: "." }, baseContext);
    expect(result.isError).toBe(false);
  });
});

describe("FindTool", () => {
  it("finds files by name pattern", async () => {
    await fs.writeFile(path.join(tmpDir, "target.ts"), "");
    await fs.writeFile(path.join(tmpDir, "other.js"), "");
    const result = await FindTool.execute({ path: ".", name: "*.ts" }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("target.ts");
  });
});

describe("GlobTool", () => {
  it("matches files by glob pattern", async () => {
    await fs.writeFile(path.join(tmpDir, "a.ts"), "");
    await fs.writeFile(path.join(tmpDir, "b.js"), "");
    await fs.writeFile(path.join(tmpDir, "c.ts"), "");
    const result = await GlobTool.execute({ pattern: "*.ts", path: "." }, baseContext);
    expect(result.isError).toBe(false);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("a.ts");
    expect(text).toContain("c.ts");
    expect(text).not.toContain("b.js");
  });
});

// ─── Web Tool Tests ──────────────────────────────────────────────────────────

describe("WebSearchTool", () => {
  it("validates arguments", async () => {
    const result = await WebSearchTool.execute({}, baseContext);
    expect(result.isError).toBe(true);
  });
});

// ─── Tool Loader Tests ───────────────────────────────────────────────────────

describe("ToolLoader", () => {
  it("loads all builtin tools", () => {
    const loader = new ToolLoader();
    const tools = loader.loadBuiltinTools();
    expect(tools.length).toBeGreaterThanOrEqual(10);
    const names = tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("bash");
    expect(names).toContain("grep");
    expect(names).toContain("glob");
    expect(names).toContain("web_search");
  });

  it("loads tools from a JSON config", async () => {
    const configPath = path.join(tmpDir, "tools.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        tools: {
          enabled: ["read_file", "bash"],
          disabled: [],
          custom: [],
        },
      }),
    );
    const loader = new ToolLoader();
    const tools = await loader.loadFromConfig(configPath);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("read_file");
    expect(tools[1].name).toBe("bash");
  });

  it("respects disabled list", async () => {
    const configPath = path.join(tmpDir, "tools.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        tools: {
          enabled: ["read_file", "bash"],
          disabled: ["bash"],
          custom: [],
        },
      }),
    );
    const loader = new ToolLoader();
    const tools = await loader.loadFromConfig(configPath);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("read_file");
  });

  it("loads tools from YAML config", async () => {
    const configPath = path.join(tmpDir, "tools.yaml");
    await fs.writeFile(
      configPath,
      `tools:
  enabled:
    - read_file
    - grep
  disabled: []
  custom: []
`,
    );
    const loader = new ToolLoader();
    const tools = await loader.loadFromConfig(configPath);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("read_file");
    expect(tools[1].name).toBe("grep");
  });
});
