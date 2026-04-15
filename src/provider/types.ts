/**
 * types.ts — Provider-specific internal types and constants
 */

import type { ToluModelCostRates } from "../types/index.js";

// ─── Tool Call Accumulator ────────────────────────────────────────────────────

/** Tracks in-progress tool calls during streaming */
export interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentsJson: string;
  contentIndex: number;
}

// ─── Default Cost Rates ──────────────────────────────────────────────────────

export const DEFAULT_COST_RATES: ToluModelCostRates = {
  inputPer1M: 3.0,
  outputPer1M: 15.0,
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
};

// ─── Provider Detection ──────────────────────────────────────────────────────

/** Auto-detect provider name from base URL */
export function detectProvider(baseUrl: string): string {
  const url = baseUrl.toLowerCase();
  if (url.includes("api.openai.com")) return "openai";
  if (url.includes("anthropic.com")) return "anthropic";
  if (url.includes("openrouter.ai")) return "openrouter";
  if (url.includes("groq.com")) return "groq";
  if (url.includes("deepseek")) return "deepseek";
  if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434")) return "ollama";
  if (url.includes("localhost:1234") || url.includes("lmstudio")) return "lmstudio";
  if (url.includes("x.ai") || url.includes("xai.com")) return "xai";
  if (url.includes("cerebras.ai")) return "cerebras";
  if (url.includes("mistral.ai")) return "mistral";
  if (url.includes("together.ai")) return "together";
  if (url.includes("fireworks.ai")) return "fireworks";
  if (url.includes("perplexity.ai")) return "perplexity";
  if (url.includes("azure.com")) return "azure";
  return "custom";
}

// ─── Stream Processing Context ───────────────────────────────────────────────

/** Bundle of state needed by the streaming processor */
export interface StreamProcessContext {
  model: string;
  costRates: ToluModelCostRates;
  cumulativeUsageRef: { usage: import("../types/index.js").ToluUsage };
}
