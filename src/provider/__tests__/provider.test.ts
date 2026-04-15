/**
 * @tolu/cowork-core — Provider module tests
 *
 * Tests for types, response-parser, streaming, openai-client, and tolu-provider.
 * All HTTP calls are mocked — no real API requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectProvider, DEFAULT_COST_RATES } from "../types.js";
import {
  calculateCost,
  parseToolCallArguments,
  emptyUsage,
  mapFinishReason,
  mergeUsage,
} from "../response-parser.js";
import { OpenAIClient, OpenAIClientError, detectCompatSettings } from "../openai-client.js";
import { ToluProvider } from "../tolu-provider.js";

// ─── types.ts ────────────────────────────────────────────────────────────────

describe("detectProvider", () => {
  it("detects openai", () => {
    expect(detectProvider("https://api.openai.com/v1")).toBe("openai");
  });

  it("detects anthropic", () => {
    expect(detectProvider("https://api.anthropic.com/v1")).toBe("anthropic");
  });

  it("detects openrouter", () => {
    expect(detectProvider("https://openrouter.ai/api/v1")).toBe("openrouter");
  });

  it("detects groq", () => {
    expect(detectProvider("https://api.groq.com/openai/v1")).toBe("groq");
  });

  it("detects deepseek", () => {
    expect(detectProvider("https://api.deepseek.com/v1")).toBe("deepseek");
  });

  it("detects ollama via localhost", () => {
    expect(detectProvider("http://localhost:11434")).toBe("ollama");
    expect(detectProvider("http://127.0.0.1:11434")).toBe("ollama");
  });

  it("detects lmstudio", () => {
    expect(detectProvider("http://localhost:1234")).toBe("lmstudio");
  });

  it("detects xai", () => {
    expect(detectProvider("https://api.x.ai/v1")).toBe("xai");
  });

  it("detects azure", () => {
    expect(detectProvider("https://myresource.openai.azure.com")).toBe("azure");
  });

  it("returns custom for unknown URLs", () => {
    expect(detectProvider("https://my-llm.example.com/api")).toBe("custom");
  });

  it("is case-insensitive", () => {
    expect(detectProvider("HTTPS://API.OPENAI.COM/V1")).toBe("openai");
  });
});

describe("DEFAULT_COST_RATES", () => {
  it("has expected default values", () => {
    expect(DEFAULT_COST_RATES.inputPer1M).toBe(3.0);
    expect(DEFAULT_COST_RATES.outputPer1M).toBe(15.0);
  });
});

// ─── response-parser.ts ──────────────────────────────────────────────────────

describe("calculateCost", () => {
  it("calculates cost with default rates", () => {
    const rates = { inputPer1M: 3.0, outputPer1M: 15.0 };
    const cost = calculateCost(1000, 500, 0, 0, rates);
    expect(cost.input).toBe(0);
    expect(cost.output).toBe(0.01);
    expect(cost.total).toBe(0.01);
  });

  it("calculates cost with cache tokens", () => {
    const rates = { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 };
    const cost = calculateCost(1_000_000, 1_000_000, 500_000, 200_000, rates);
    expect(cost.input).toBe(3.0);
    expect(cost.output).toBe(15.0);
    expect(cost.cacheRead).toBe(0.15);
    expect(cost.cacheWrite).toBe(0.75);
    expect(cost.total).toBeCloseTo(18.9);
  });

  it("handles zero tokens", () => {
    const rates = { inputPer1M: 3.0, outputPer1M: 15.0 };
    const cost = calculateCost(0, 0, 0, 0, rates);
    expect(cost.total).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const rates = { inputPer1M: 3.0, outputPer1M: 15.0 };
    const cost = calculateCost(333, 333, 0, 0, rates);
    expect(cost.input).toBe(0);
    expect(cost.output).toBe(0);
  });
});

describe("parseToolCallArguments", () => {
  it("parses valid JSON", () => {
    expect(parseToolCallArguments('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("returns empty object for empty string", () => {
    expect(parseToolCallArguments("")).toEqual({});
    expect(parseToolCallArguments("   ")).toEqual({});
  });

  it("repairs truncated JSON with missing braces", () => {
    expect(parseToolCallArguments('{"key":"value"')).toEqual({ key: "value" });
  });

  it("repairs truncated JSON with nested structures", () => {
    const result = parseToolCallArguments('{"items":[1,2,{"a":1');
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("returns empty object for irreparable JSON", () => {
    expect(parseToolCallArguments("not json at all!")).toEqual({});
  });
});

describe("emptyUsage", () => {
  it("returns zeroed usage object", () => {
    const usage = emptyUsage();
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(0);
    expect(usage.totalTokens).toBe(0);
    expect(usage.cost.total).toBe(0);
  });
});

describe("mapFinishReason", () => {
  it("maps stop → stop", () => expect(mapFinishReason("stop")).toBe("stop"));
  it("maps length → length", () => expect(mapFinishReason("length")).toBe("length"));
  it("maps tool_calls → toolUse", () => expect(mapFinishReason("tool_calls")).toBe("toolUse"));
  it("maps content_filter → stop", () => expect(mapFinishReason("content_filter")).toBe("stop"));
  it("maps unknown → stop", () => expect(mapFinishReason("unknown")).toBe("stop"));
});

describe("mergeUsage", () => {
  it("merges two usage objects", () => {
    const a = { ...emptyUsage(), input: 100, output: 50, totalTokens: 150, cost: { ...emptyUsage().cost, input: 0.3, output: 0.75, total: 1.05 } };
    const b = { ...emptyUsage(), input: 200, output: 100, totalTokens: 300, cost: { ...emptyUsage().cost, input: 0.6, output: 1.5, total: 2.1 } };
    const merged = mergeUsage(a, b);
    expect(merged.input).toBe(300);
    expect(merged.output).toBe(150);
    expect(merged.totalTokens).toBe(450);
    expect(merged.cost.total).toBeCloseTo(3.15);
  });
});

// ─── openai-client.ts ────────────────────────────────────────────────────────

describe("detectCompatSettings", () => {
  it("detects OpenAI compat", () => {
    const compat = detectCompatSettings("https://api.openai.com/v1");
    expect(compat.supportsDeveloperRole).toBe(true);
    expect(compat.maxTokensField).toBe("max_completion_tokens");
  });

  it("detects Ollama compat", () => {
    const compat = detectCompatSettings("http://localhost:11434");
    expect(compat.supportsUsageInStreaming).toBe(false);
    expect(compat.requiresThinkingAsText).toBe(true);
  });

  it("detects Groq compat", () => {
    const compat = detectCompatSettings("https://api.groq.com/openai/v1");
    expect(compat.requiresToolResultName).toBe(true);
  });

  it("defaults for unknown provider", () => {
    const compat = detectCompatSettings("https://custom.example.com");
    expect(compat.supportsUsageInStreaming).toBe(true);
    expect(compat.maxTokensField).toBe("max_tokens");
    expect(compat.thinkingFormat).toBe("none");
  });
});

describe("OpenAIClient", () => {
  it("constructs with options", () => {
    const client = new OpenAIClient({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key" });
    expect(client.compat.supportsDeveloperRole).toBe(true);
  });

  it("builds request with system prompt", () => {
    const client = new OpenAIClient({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key" });
    const req = client.buildRequest("gpt-4o", [{ role: "user", content: "hi", timestamp: Date.now() }], undefined, "You are helpful", { temperature: 0.7, maxTokens: 100 });
    expect(req.model).toBe("gpt-4o");
    expect(req.messages[0].role).toBe("developer");
    expect(req.max_completion_tokens).toBe(100);
  });

  it("builds request with tools", () => {
    const client = new OpenAIClient({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key" });
    const tools = [{ name: "run", description: "Run code", parameters: { type: "object" as const, properties: { code: { type: "string" as const, description: "code" } } } }];
    const req = client.buildRequest("gpt-4o", [{ role: "user", content: "run", timestamp: Date.now() }], tools, undefined, {});
    expect(req.tools).toHaveLength(1);
    expect(req.tools![0].function.name).toBe("run");
  });

  it("uses system role for non-OpenAI providers", () => {
    const client = new OpenAIClient({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "test-key" });
    const req = client.buildRequest("llama", [{ role: "user", content: "hi", timestamp: Date.now() }], undefined, "sys", {});
    expect(req.messages[0].role).toBe("system");
  });

  it("completeChat throws on HTTP error", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests", text: () => Promise.resolve("rate limited") });
    try {
      await expect(new OpenAIClient({ baseUrl: "https://api.openai.com/v1", apiKey: "k" }).completeChat({ model: "gpt-4o", messages: [] })).rejects.toThrow();
    } finally { globalThis.fetch = origFetch; }
  });

  it("completeChat returns parsed response", async () => {
    const mockResp = { id: "chatcmpl-1", choices: [{ message: { content: "hello" }, finish_reason: "stop" }] };
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResp) });
    try {
      const result = await new OpenAIClient({ baseUrl: "https://api.openai.com/v1", apiKey: "k" }).completeChat({ model: "gpt-4o", messages: [] });
      expect(result.id).toBe("chatcmpl-1");
    } finally { globalThis.fetch = origFetch; }
  });

  it("OpenAIClientError has status and body", () => {
    const err = new OpenAIClientError("test", 500, "body");
    expect(err.status).toBe(500);
    expect(err.body).toBe("body");
    expect(err.name).toBe("OpenAIClientError");
  });
});

// ─── tolu-provider.ts ────────────────────────────────────────────────────────

describe("ToluProvider", () => {
  it("constructs with config and detects provider", () => {
    const p = new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4o" });
    expect(p.provider).toBe("openai");
    expect(p.modelId).toBe("gpt-4o");
  });

  it("uses custom provider name", () => {
    const p = new ToluProvider({ baseUrl: "https://my-llm.example.com", apiKey: "test-key", model: "m", provider: "custom" });
    expect(p.provider).toBe("custom");
  });

  it("getUsage returns cumulative usage", () => {
    const p = new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "test-key", model: "gpt-4o" });
    expect(p.getUsage().totalTokens).toBe(0);
  });

  it("complete returns response with text content", async () => {
    const mockResp = { id: "r1", choices: [{ message: { content: "Hello world" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResp) });
    try {
      const result = await new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-4o" }).complete({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] });
      expect(result.content[0]).toEqual({ type: "text", text: "Hello world" });
      expect(result.stopReason).toBe("stop");
      expect(result.usage.input).toBe(10);
    } finally { globalThis.fetch = origFetch; }
  });

  it("complete handles tool calls", async () => {
    const mockResp = { id: "r2", choices: [{ message: { content: null, tool_calls: [{ id: "tc-1", type: "function", function: { name: "run", arguments: '{"code":"ls"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } };
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockResp) });
    try {
      const result = await new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-4o" }).complete({ messages: [{ role: "user", content: "run", timestamp: Date.now() }] });
      expect(result.stopReason).toBe("toolUse");
      expect(result.content.some(c => c.type === "toolCall")).toBe(true);
    } finally { globalThis.fetch = origFetch; }
  });

  it("complete returns error message on fetch failure", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
    try {
      const result = await new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-4o" }).complete({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] });
      expect(result.stopReason).toBe("error");
      expect(result.errorMessage).toBe("network failure");
    } finally { globalThis.fetch = origFetch; }
  });

  it("abort is safe when nothing is running", () => {
    const p = new ToluProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-4o" });
    p.abort();
    expect(p.getUsage().totalTokens).toBe(0);
  });
});
