/**
 * @tolu/cowork-core — Config module tests
 *
 * Tests for ConfigSchema and ConfigLoader.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ToluConfigSchema } from "../config-schema.js";
import { ConfigLoader, ConfigError } from "../config-loader.js";

// ─── ConfigSchema ────────────────────────────────────────────────────────────

describe("ToluConfigSchema", () => {
  it("parses a minimal valid config", () => {
    const config = ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1" } });
    expect(config.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.provider.model).toBe("gpt-4o");
    expect(config.sandbox.level).toBe("path-only");
  });

  it("parses a full valid config", () => {
    const config = ToluConfigSchema.parse({
      provider: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", model: "gpt-4o-mini", temperature: 0.7, maxTokens: 4096, reasoning: "high", costRates: { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 } },
      workspace: { root: "/workspace", additionalRoots: ["/data"] },
      sandbox: { level: "docker", docker: { image: "ubuntu:22.04", containerName: "tolu-sandbox" }, timeout: 60 },
      tools: { enabled: ["bash", "read_file"], disabled: ["web_search"] },
      skills: { directories: ["./skills"] },
      security: { auditLogging: false, rateLimiting: true },
      agent: { systemPrompt: "You are helpful", maxTurns: 100, toolExecution: "sequential" },
    });
    expect(config.provider.model).toBe("gpt-4o-mini");
    expect(config.sandbox.level).toBe("docker");
    expect(config.tools.enabled).toEqual(["bash", "read_file"]);
    expect(config.agent.maxTurns).toBe(100);
  });

  it("rejects invalid baseUrl", () => {
    expect(() => ToluConfigSchema.parse({ provider: { baseUrl: "not-a-url" } })).toThrow();
  });

  it("rejects invalid temperature range", () => {
    expect(() => ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1", temperature: 5.0 } })).toThrow();
  });

  it("rejects negative maxTokens", () => {
    expect(() => ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1", maxTokens: -1 } })).toThrow();
  });

  it("rejects invalid sandbox level", () => {
    expect(() => ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1" }, sandbox: { level: "invalid" } })).toThrow();
  });

  it("rejects missing provider", () => {
    expect(() => ToluConfigSchema.parse({})).toThrow();
  });

  it("applies defaults for optional sections", () => {
    const config = ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1" } });
    expect(config.workspace.root).toBe(".");
    expect(config.workspace.additionalRoots).toEqual([]);
    expect(config.sandbox.timeout).toBe(120);
    expect(config.tools.disabled).toEqual([]);
    expect(config.security.auditLogging).toBe(true);
    expect(config.agent.maxTurns).toBe(50);
    expect(config.agent.toolExecution).toBe("parallel");
  });

  it("accepts boolean reasoning", () => {
    expect(ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1", reasoning: true } }).provider.reasoning).toBe(true);
  });

  it("accepts string reasoning levels", () => {
    for (const level of ["minimal", "low", "medium", "high"] as const) {
      expect(ToluConfigSchema.parse({ provider: { baseUrl: "https://api.openai.com/v1", reasoning: level } }).provider.reasoning).toBe(level);
    }
  });
});

// ─── ConfigLoader ────────────────────────────────────────────────────────────

describe("ConfigLoader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tolu-config-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("loads a valid config from file", async () => {
    const configPath = path.join(tmpDir, "tolu.config.json");
    await fs.writeFile(configPath, JSON.stringify({ provider: { baseUrl: "https://api.openai.com/v1" } }), "utf-8");
    const config = await ConfigLoader.load(configPath);
    expect(config.provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("throws ConfigError for missing file", async () => {
    await expect(ConfigLoader.load(path.join(tmpDir, "missing.json"))).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError for invalid JSON", async () => {
    const configPath = path.join(tmpDir, "bad.json");
    await fs.writeFile(configPath, "{ invalid json", "utf-8");
    await expect(ConfigLoader.load(configPath)).rejects.toThrow(ConfigError);
  });

  it("throws ConfigError for invalid config content", async () => {
    const configPath = path.join(tmpDir, "invalid.json");
    await fs.writeFile(configPath, JSON.stringify({}), "utf-8");
    await expect(ConfigLoader.load(configPath)).rejects.toThrow(ConfigError);
  });

  it("validate accepts valid config", () => {
    expect(ConfigLoader.validate({ provider: { baseUrl: "https://api.openai.com/v1" } }).provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("validate rejects invalid config", () => {
    expect(() => ConfigLoader.validate({})).toThrow(ConfigError);
  });

  it("writeDefault creates a config file", async () => {
    const configPath = path.join(tmpDir, "sub", "tolu.config.json");
    await ConfigLoader.writeDefault(configPath);
    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8"));
    expect(parsed.provider).toBeDefined();
    expect(parsed.provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("findConfig returns null when no config found", async () => {
    expect(await ConfigLoader.findConfig(tmpDir)).toBeNull();
  });

  it("findConfig finds config in directory", async () => {
    const configPath = path.join(tmpDir, "tolu.config.json");
    await fs.writeFile(configPath, JSON.stringify({ provider: { baseUrl: "https://api.openai.com/v1" } }), "utf-8");
    expect(await ConfigLoader.findConfig(tmpDir)).toBe(configPath);
  });

  it("loadWithOverrides applies TOLU_API_KEY", async () => {
    const configPath = path.join(tmpDir, "tolu.config.json");
    await fs.writeFile(configPath, JSON.stringify({ provider: { baseUrl: "https://api.openai.com/v1", apiKey: "original" } }), "utf-8");
    const origApiKey = process.env.TOLU_API_KEY;
    const origConfig = process.env.TOLU_CONFIG;
    process.env.TOLU_API_KEY = "overridden-key";
    process.env.TOLU_CONFIG = configPath;
    try {
      expect((await ConfigLoader.loadWithOverrides()).provider.apiKey).toBe("overridden-key");
    } finally {
      if (origApiKey === undefined) delete process.env.TOLU_API_KEY; else process.env.TOLU_API_KEY = origApiKey;
      if (origConfig === undefined) delete process.env.TOLU_CONFIG; else process.env.TOLU_CONFIG = origConfig;
    }
  });

  it("loadWithOverrides applies TOLU_BASE_URL", async () => {
    const configPath = path.join(tmpDir, "tolu.config.json");
    await fs.writeFile(configPath, JSON.stringify({ provider: { baseUrl: "https://api.openai.com/v1" } }), "utf-8");
    const origBaseUrl = process.env.TOLU_BASE_URL;
    const origConfig = process.env.TOLU_CONFIG;
    process.env.TOLU_BASE_URL = "https://custom.example.com/v1";
    process.env.TOLU_CONFIG = configPath;
    try {
      expect((await ConfigLoader.loadWithOverrides()).provider.baseUrl).toBe("https://custom.example.com/v1");
    } finally {
      if (origBaseUrl === undefined) delete process.env.TOLU_BASE_URL; else process.env.TOLU_BASE_URL = origBaseUrl;
      if (origConfig === undefined) delete process.env.TOLU_CONFIG; else process.env.TOLU_CONFIG = origConfig;
    }
  });

  it("loadWithOverrides applies TOLU_MODEL", async () => {
    const configPath = path.join(tmpDir, "tolu.config.json");
    await fs.writeFile(configPath, JSON.stringify({ provider: { baseUrl: "https://api.openai.com/v1" } }), "utf-8");
    const origModel = process.env.TOLU_MODEL;
    const origConfig = process.env.TOLU_CONFIG;
    process.env.TOLU_MODEL = "gpt-4o-mini";
    process.env.TOLU_CONFIG = configPath;
    try {
      expect((await ConfigLoader.loadWithOverrides()).provider.model).toBe("gpt-4o-mini");
    } finally {
      if (origModel === undefined) delete process.env.TOLU_MODEL; else process.env.TOLU_MODEL = origModel;
      if (origConfig === undefined) delete process.env.TOLU_CONFIG; else process.env.TOLU_CONFIG = origConfig;
    }
  });
});
