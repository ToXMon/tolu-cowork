/**
 * @tolu/cowork-core — Utils module tests
 *
 * Tests for Logger, Stream helpers, and Format utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../logger.js";
import { toJsonLines, collectStream, toReadableStream } from "../stream.js";
import { formatContent, formatUsage, truncate, indent } from "../format.js";

// ─── Logger ──────────────────────────────────────────────────────────────────

describe("Logger", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write") as ReturnType<typeof vi.spyOn>;
    stderrSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("logs info messages to stderr", () => {
    const log = new Logger("test", "info");
    log.info("hello");
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[INFO");
    expect(output).toContain("hello");
    expect(output).toContain("[test]");
  });

  it("logs debug when level is debug", () => {
    const log = new Logger("debug-test", "debug");
    log.debug("debug msg");
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[DEBUG");
  });

  it("suppresses debug when level is info", () => {
    const log = new Logger("suppress-test", "info");
    log.debug("should not appear");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("logs warn and error at info level", () => {
    const log = new Logger("level-test", "info");
    log.warn("warning");
    log.error("error");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("suppresses all output at silent level", () => {
    const log = new Logger("silent-test", "silent");
    log.info("no");
    log.warn("no");
    log.error("no");
    log.debug("no");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("includes structured data as JSON", () => {
    const log = new Logger("data-test", "info");
    log.info("msg", { key: "value", count: 42 });
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('"key":"value"');
    expect(output).toContain('"count":42');
  });

  it("setLevel changes log level at runtime", () => {
    const log = new Logger("dynamic", "info");
    log.debug("hidden");
    expect(stderrSpy).not.toHaveBeenCalled();
    log.setLevel("debug");
    log.debug("visible");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("child creates sub-logger with combined module name", () => {
    const log = new Logger("parent", "info");
    const child = log.child("sub");
    child.info("child msg");
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[parent/sub]");
  });

  it("defaults to info level when no level specified", () => {
    const origEnv = process.env.TOLU_LOG_LEVEL;
    delete process.env.TOLU_LOG_LEVEL;
    const log = new Logger("default");
    log.debug("hidden");
    expect(stderrSpy).not.toHaveBeenCalled();
    process.env.TOLU_LOG_LEVEL = origEnv;
  });
});

// ─── Stream helpers ──────────────────────────────────────────────────────────

describe("Stream utils", () => {
  async function* numbers(n: number): AsyncGenerator<number> {
    for (let i = 0; i < n; i++) yield i;
  }

  it("toJsonLines serializes items as JSON lines", async () => {
    const results: string[] = [];
    for await (const line of toJsonLines(numbers(3))) {
      results.push(line);
    }
    expect(results).toEqual(["0\n", "1\n", "2\n"]);
  });

  it("collectStream collects all items into array", async () => {
    expect(await collectStream(numbers(5))).toEqual([0, 1, 2, 3, 4]);
  });

  it("collectStream handles empty generator", async () => {
    expect(await collectStream(numbers(0))).toEqual([]);
  });

  it("toReadableStream creates a working ReadableStream", async () => {
    const stream = toReadableStream(numbers(3));
    const reader = stream.getReader();
    const items: number[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      items.push(value);
    }
    expect(items).toEqual([0, 1, 2]);
  });

  it("toReadableStream handles errors", async () => {
    async function* failing(): AsyncGenerator<number> {
      yield 1;
      throw new Error("stream error");
    }
    const stream = toReadableStream(failing());
    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value).toBe(1);
    await expect(reader.read()).rejects.toThrow("stream error");
  });
});

// ─── Format utilities ────────────────────────────────────────────────────────

describe("Format utils", () => {
  it("formatContent formats text blocks", () => {
    expect(formatContent([{ type: "text", text: "Hello" }])).toBe("Hello");
  });

  it("formatContent formats thinking blocks", () => {
    const result = formatContent([{ type: "thinking", thinking: "hmm" }]);
    expect(result).toContain("[Thinking]");
    expect(result).toContain("hmm");
  });

  it("formatContent formats tool call blocks", () => {
    const result = formatContent([{ type: "toolCall", id: "tc-1", name: "run", arguments: { code: "ls" } }]);
    expect(result).toContain("[Tool: run]");
  });

  it("formatContent formats image blocks", () => {
    const result = formatContent([{ type: "image", data: Buffer.from("test").toString("base64"), mimeType: "image/png" }]);
    expect(result).toContain("[Image:");
    expect(result).toContain("image/png");
  });

  it("formatUsage shows token counts", () => {
    const usage = { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165, cost: { input: 0.3, output: 0.75, cacheRead: 0.01, cacheWrite: 0.02, total: 1.08 } };
    const result = formatUsage(usage);
    expect(result).toContain("Tokens: 165");
    expect(result).toContain("in: 100");
    expect(result).toContain("out: 50");
    expect(result).toContain("Cost:");
  });

  it("truncate returns string unchanged when under limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncate adds ellipsis when over limit", () => {
    const result = truncate("hello world", 6);
    expect(result.length).toBeLessThanOrEqual(6);
    expect(result).toContain("…");
  });

  it("truncate handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("indent adds spaces to each line", () => {
    expect(indent("line1\nline2", 4)).toBe("    line1\n    line2");
  });

  it("indent handles empty string", () => {
    expect(indent("", 2)).toBe("  ");
  });
});
