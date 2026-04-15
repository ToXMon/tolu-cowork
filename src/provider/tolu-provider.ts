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

import { OpenAIClient } from "./openai-client.js";
import type {
  ToluProviderConfig,
  ToluContext,
  ToluStreamOptions,
  ToluStreamEvent,
  ToluAssistantMessage,
  ToluUsage,
  ToluModelCostRates,
  OpenAIChunk,
} from "../types/index.js";
import { DEFAULT_COST_RATES, detectProvider, type StreamProcessContext } from "./types.js";
import {
  calculateCost,
  emptyAssistantMessage,
  mapFinishReason,
  mergeUsage,
} from "./response-parser.js";
import { processStream } from "./streaming.js";

// ─── ToluProvider ────────────────────────────────────────────────────────────

export class ToluProvider {
  private readonly client: OpenAIClient;
  private readonly config: ToluProviderConfig;
  private readonly costRates: ToluModelCostRates;
  private readonly providerName: string;
  private abortController: AbortController | null = null;
  private cumulativeUsage: ToluUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

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

    const ctx: StreamProcessContext = {
      model: this.config.model,
      costRates: this.costRates,
      cumulativeUsageRef: { usage: this.cumulativeUsage },
    };

    try {
      yield* processStream(this.client, request, signal, ctx);
    } finally {
      this.cumulativeUsage = ctx.cumulativeUsageRef.usage;
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
        const msg = extractMessage(choice);
        if (msg) {
          if (msg.content) {
            output.content.push({ type: "text", text: msg.content });
          }
          const reasoningContent = extractReasoningContent(msg);
          if (reasoningContent) {
            output.content.push({ type: "thinking", thinking: reasoningContent });
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

// ─── Response Extraction Helpers ──────────────────────────────────────────────

/** Choice type that may have message (non-streaming) or delta (streaming) */
type ResponseChoice = NonNullable<OpenAIChunk['choices']>[number];

interface ExtractedMessage {
  content?: string;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  reasoning_content?: string;
}

/** Extract message from a chat response choice (handles provider variations) */
function extractMessage(choice: ResponseChoice): ExtractedMessage | null {
  if ('message' in choice && choice.message) {
    return choice.message as ExtractedMessage;
  }
  return null;
}

/** Extract reasoning content from a message (handles provider variations) */
function extractReasoningContent(msg: ExtractedMessage): string | null {
  if ('reasoning_content' in msg && typeof msg.reasoning_content === 'string') {
    return msg.reasoning_content;
  }
  return null;
}
