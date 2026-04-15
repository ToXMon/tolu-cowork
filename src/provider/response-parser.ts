/**
 * response-parser.ts — Response parsing, cost calculation, and usage tracking
 */

import type {
  ToluUsage,
  ToluCost,
  ToluAssistantMessage,
  ToluStopReason,
  ToluModelCostRates,
} from "../types/index.js";

// ─── Cost Calculation ─────────────────────────────────────────────────────────

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  rates: ToluModelCostRates,
): ToluCost {
  const input = (inputTokens / 1_000_000) * rates.inputPer1M;
  const output = (outputTokens / 1_000_000) * rates.outputPer1M;
  const cacheRead = (cacheReadTokens / 1_000_000) * (rates.cacheReadPer1M ?? 0);
  const cacheWrite = (cacheWriteTokens / 1_000_000) * (rates.cacheWritePer1M ?? 0);
  const total = input + output + cacheRead + cacheWrite;

  return {
    input: Math.round(input * 100) / 100,
    output: Math.round(output * 100) / 100,
    cacheRead: Math.round(cacheRead * 100) / 100,
    cacheWrite: Math.round(cacheWrite * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

// ─── Streaming JSON Arguments Parser ─────────────────────────────────────────

/**
 * Safely parse JSON arguments that were built incrementally from streaming deltas.
 * Handles truncated JSON gracefully by returning an empty object.
 */
export function parseToolCallArguments(argsJson: string): Record<string, unknown> {
  if (!argsJson || argsJson.trim() === "") return {};
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    // Attempt to fix common truncation issues
    let fixed = argsJson.trim();
    const opens = (fixed.match(/[{[]/g) || []).length;
    const closes = (fixed.match(/[}\]]/g) || []).length;
    for (let i = 0; i < opens - closes; i++) {
      fixed += "}";
    }
    try {
      return JSON.parse(fixed) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

// ─── Empty Usage Helper ──────────────────────────────────────────────────────

export function emptyUsage(): ToluUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function emptyAssistantMessage(model: string): ToluAssistantMessage {
  return {
    role: "assistant",
    content: [],
    model,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

// ─── Finish Reason Mapping ───────────────────────────────────────────────────

export function mapFinishReason(reason: string): ToluStopReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "toolUse";
    case "content_filter":
      return "stop";
    default:
      return "stop";
  }
}

// ─── Usage Merging ───────────────────────────────────────────────────────────

export function mergeUsage(existing: ToluUsage, incoming: ToluUsage): ToluUsage {
  const input = existing.input + incoming.input;
  const output = existing.output + incoming.output;
  const cacheRead = existing.cacheRead + incoming.cacheRead;
  const cacheWrite = existing.cacheWrite + incoming.cacheWrite;
  const totalTokens = existing.totalTokens + incoming.totalTokens;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: Math.round((existing.cost.input + incoming.cost.input) * 100) / 100,
      output: Math.round((existing.cost.output + incoming.cost.output) * 100) / 100,
      cacheRead: Math.round((existing.cost.cacheRead + incoming.cost.cacheRead) * 100) / 100,
      cacheWrite: Math.round((existing.cost.cacheWrite + incoming.cost.cacheWrite) * 100) / 100,
      total: Math.round((existing.cost.total + incoming.cost.total) * 100) / 100,
    },
  };
}
