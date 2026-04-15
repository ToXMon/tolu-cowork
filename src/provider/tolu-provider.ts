/**
 * tolu-provider.ts — Main provider class for Tolu Cowork
 * 
 * Wraps the OpenAI-compatible client and provides:
 * - AsyncGenerator-based streaming with typed events
 * - Tool call accumulation from delta chunks
 * - Usage tracking and cost calculation
 * - Abort support
 * - Provider auto-detection
 */

import { OpenAIClient, OpenAIClientError } from "./openai-client.js";
import type {
  ToluProviderConfig,
  ToluContext,
  ToluStreamOptions,
  ToluStreamEvent,
  ToluAssistantMessage,
  ToluUsage,
  ToluCost,
  ToluToolCallContent,
  ToluStopReason,
  ToluModelCostRates,
} from "../types/index.js";

// ─── Default Cost Rates ──────────────────────────────────────────────────────

const DEFAULT_COST_RATES: ToluModelCostRates = {
  inputPer1M: 3.0,
  outputPer1M: 15.0,
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
};

// ─── Provider Detection ──────────────────────────────────────────────────────

/** Auto-detect provider name from base URL */
function detectProvider(baseUrl: string): string {
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

// ─── Cost Calculation ─────────────────────────────────────────────────────────

function calculateCost(
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
function parseToolCallArguments(argsJson: string): Record<string, unknown> {
  if (!argsJson || argsJson.trim() === "") return {};
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    // Attempt to fix common truncation issues
    // Try adding closing braces/brackets
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

function emptyUsage(): ToluUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function emptyAssistantMessage(model: string): ToluAssistantMessage {
  return {
    role: "assistant",
    content: [],
    model,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

// ─── Tool Call Accumulator ───────────────────────────────────────────────────

interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentsJson: string;
  contentIndex: number;
}

// ─── ToluProvider ────────────────────────────────────────────────────────────

export class ToluProvider {
  private readonly client: OpenAIClient;
  private readonly config: ToluProviderConfig;
  private readonly costRates: ToluModelCostRates;
  private readonly providerName: string;
  private abortController: AbortController | null = null;
  private cumulativeUsage: ToluUsage = emptyUsage();

  constructor(config: ToluProviderConfig) {
    this.config = config;
    this.providerName = config.provider ?? detectProvider(config.baseUrl);
    this.costRates = config.costRates ?? DEFAULT_COST_RATES;

    // Normalize base URL — append /v1 if no version path is present
    let baseUrl = config.baseUrl.replace(/\/+$/, "");
    if (
      !baseUrl.endsWith("/v1") &&
      !baseUrl.endsWith("/v1/chat/completions") &&
      !baseUrl.includes("/chat/completions") &&
      !baseUrl.includes(":11434") && // Ollama uses /api/chat
      !baseUrl.includes("/api/")
    ) {
      baseUrl += "/v1";
    }

    this.client = new OpenAIClient({
      baseUrl,
      apiKey: config.apiKey,
      headers: config.headers,
    });
  }

  /**
   * Stream a completion, yielding ToluStreamEvents.
   */
  async *stream(
    context: ToluContext,
    options?: ToluStreamOptions,
  ): AsyncGenerator<ToluStreamEvent> {
    // Create a new AbortController for this request
    this.abortController = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([this.abortController.signal, options.signal])
      : this.abortController.signal;

    const reasoning = options?.reasoning ?? this.config.reasoning ?? false;

    const request = this.client.buildRequest(
      this.config.model,
      context.messages,
      context.tools,
      context.systemPrompt,
      {
        temperature: options?.temperature ?? this.config.temperature,
        maxTokens: options?.maxTokens ?? this.config.maxTokens,
        reasoning: typeof reasoning === "string" ? reasoning : reasoning ? true : false,
      },
    );

    const output = emptyAssistantMessage(this.config.model);
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let currentTextIndex = -1;
    let currentThinkingIndex = -1;
    let activeToolCallIndex = -1;

    try {
      const stream = this.client.streamChat(request, signal);

      // Emit start event
      yield { type: "start", partial: output };

      for await (const chunk of stream) {
        // Capture response ID
        output.responseId ??= chunk.id;

        // Parse usage from chunk
        const chunkUsage = chunk.usage ?? chunk.choices?.[0]?.usage;
        if (chunkUsage) {
          const cacheRead = chunkUsage.prompt_tokens_details?.cached_tokens ?? 0;
          output.usage = {
            input: chunkUsage.prompt_tokens ?? 0,
            output: chunkUsage.completion_tokens ?? 0,
            cacheRead,
            cacheWrite: 0, // Not typically available in streaming
            totalTokens: chunkUsage.total_tokens ?? 0,
            cost: calculateCost(
              chunkUsage.prompt_tokens ?? 0,
              chunkUsage.completion_tokens ?? 0,
              cacheRead,
              0,
              this.costRates,
            ),
          };
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (!delta) continue;

        // ─── Text Content ────────────────────────────────────────────────
        if (delta.content != null && delta.content !== "") {
          if (currentTextIndex === -1 || output.content[currentTextIndex]?.type !== "text") {
            // Start new text block
            output.content.push({ type: "text", text: "" });
            currentTextIndex = output.content.length - 1;
          }
          (output.content[currentTextIndex] as { type: "text"; text: string }).text += delta.content;
          yield {
            type: "text_delta",
            contentIndex: currentTextIndex,
            delta: delta.content,
            partial: output,
          };
        }

        // ─── Thinking / Reasoning Content ────────────────────────────────
        const thinkingContent = delta.reasoning_content ?? delta.thinking;
        if (thinkingContent != null && thinkingContent !== "") {
          if (currentThinkingIndex === -1 || output.content[currentThinkingIndex]?.type !== "thinking") {
            output.content.push({ type: "thinking", thinking: "" });
            currentThinkingIndex = output.content.length - 1;
          }
          (output.content[currentThinkingIndex] as { type: "thinking"; thinking: string }).thinking += thinkingContent;
          yield {
            type: "thinking_delta",
            contentIndex: currentThinkingIndex,
            delta: thinkingContent,
            partial: output,
          };
        }

        // ─── Tool Calls ──────────────────────────────────────────────────
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tcIndex = tc.index;

            if (tc.id) {
              // New tool call started
              const acc: ToolCallAccumulator = {
                id: tc.id,
                name: tc.function?.name ?? "",
                argumentsJson: "",
                contentIndex: output.content.length,
              };
              toolCalls.set(tcIndex, acc);

              // Add placeholder to content
              output.content.push({
                type: "toolCall",
                id: tc.id,
                name: acc.name,
                arguments: {},
              });

              activeToolCallIndex = acc.contentIndex;

              yield {
                type: "toolcall_start",
                contentIndex: acc.contentIndex,
                toolCallId: tc.id,
                toolCallName: acc.name,
                partial: output,
              };
            }

            // Accumulate arguments delta
            if (tc.function?.arguments) {
              const acc = toolCalls.get(tcIndex);
              if (acc) {
                acc.argumentsJson += tc.function.arguments;
                activeToolCallIndex = acc.contentIndex;

                yield {
                  type: "toolcall_delta",
                  contentIndex: acc.contentIndex,
                  delta: tc.function.arguments,
                  partial: output,
                };
              }
            }
          }
        }

        // ─── Finish Reason ───────────────────────────────────────────────
        if (choice.finish_reason) {
          const stopReason = mapFinishReason(choice.finish_reason);
          output.stopReason = stopReason;
        }
      }

      // ─── Finalize tool calls ──────────────────────────────────────────
      for (const [, acc] of toolCalls) {
        const parsed = parseToolCallArguments(acc.argumentsJson);
        const toolCallContent = output.content[acc.contentIndex] as ToluToolCallContent;
        if (toolCallContent && toolCallContent.type === "toolCall") {
          toolCallContent.arguments = parsed;
        }

        yield {
          type: "toolcall_end",
          contentIndex: acc.contentIndex,
          toolCall: {
            type: "toolCall",
            id: acc.id,
            name: acc.name,
            arguments: parsed,
          },
          partial: output,
        };
      }

      // ─── Emit done ────────────────────────────────────────────────────
      if (output.stopReason === "stop" || output.stopReason === "length" || output.stopReason === "toolUse") {
        // Update cumulative usage
        this.cumulativeUsage = mergeUsage(this.cumulativeUsage, output.usage);

        yield {
          type: "done",
          reason: output.stopReason,
          message: output,
        };
      }
    } catch (err) {
      if (signal.aborted) {
        output.stopReason = "aborted";
        output.errorMessage = "Request aborted";
        yield { type: "error", reason: "aborted", error: output };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        output.stopReason = "error";
        output.errorMessage = message;
        yield { type: "error", reason: "error", error: output };
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Complete a single request (no streaming).
   */
  async complete(
    context: ToluContext,
    options?: ToluStreamOptions,
  ): Promise<ToluAssistantMessage> {
    this.abortController = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([this.abortController.signal, options.signal])
      : this.abortController.signal;

    const reasoning = options?.reasoning ?? this.config.reasoning ?? false;

    const request = this.client.buildRequest(
      this.config.model,
      context.messages,
      context.tools,
      context.systemPrompt,
      {
        temperature: options?.temperature ?? this.config.temperature,
        maxTokens: options?.maxTokens ?? this.config.maxTokens,
        reasoning: typeof reasoning === "string" ? reasoning : reasoning ? true : false,
      },
    );

    // Force non-streaming
    request.stream = false;
    delete request.stream_options;

    try {
      const response = await this.client.completeChat(request, signal);

      const output = emptyAssistantMessage(this.config.model);
      output.responseId = response.id;

      // Parse usage
      const respUsage = response.usage ?? response.choices?.[0]?.usage;
      if (respUsage) {
        const cacheRead = respUsage.prompt_tokens_details?.cached_tokens ?? 0;
        output.usage = {
          input: respUsage.prompt_tokens ?? 0,
          output: respUsage.completion_tokens ?? 0,
          cacheRead,
          cacheWrite: 0,
          totalTokens: respUsage.total_tokens ?? 0,
          cost: calculateCost(
            respUsage.prompt_tokens ?? 0,
            respUsage.completion_tokens ?? 0,
            cacheRead,
            0,
            this.costRates,
          ),
        };
      }

      // Parse response content
      const choice = response.choices?.[0];
      if (choice) {
        const msg = (choice as any).message;
        if (msg) {
          if (msg.content) {
            output.content.push({ type: "text", text: msg.content });
          }
          if ((msg as any).reasoning_content) {
            output.content.push({
              type: "thinking",
              thinking: (msg as any).reasoning_content as string,
            });
          }
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              output.content.push({
                type: "toolCall",
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments || "{}"),
              });
            }
          }
        }

        output.stopReason = choice.finish_reason
          ? mapFinishReason(choice.finish_reason)
          : "stop";
      }

      // Update cumulative usage
      this.cumulativeUsage = mergeUsage(this.cumulativeUsage, output.usage);

      return output;
    } catch (err) {
      const output = emptyAssistantMessage(this.config.model);
      if (signal.aborted) {
        output.stopReason = "aborted";
        output.errorMessage = "Request aborted";
      } else {
        output.stopReason = "error";
        output.errorMessage = err instanceof Error ? err.message : String(err);
      }
      return output;
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Abort the current streaming or completion request.
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Get cumulative usage stats across all requests in this provider instance.
   */
  getUsage(): ToluUsage {
    return { ...this.cumulativeUsage };
  }

  /** Get the provider name */
  get provider(): string {
    return this.providerName;
  }

  /** Get the model ID */
  get modelId(): string {
    return this.config.model;
  }

  /** Get the base URL */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /** Get compatibility settings */
  get compat() {
    return this.client.compat;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapFinishReason(reason: string): ToluStopReason {
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

function mergeUsage(existing: ToluUsage, incoming: ToluUsage): ToluUsage {
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
