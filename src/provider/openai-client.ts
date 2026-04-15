/**
 * openai-client.ts — Lightweight OpenAI-compatible streaming HTTP client
 *
 * Works with ANY /v1/chat/completions endpoint:
 * OpenAI, Anthropic (via proxy), OpenRouter, Groq, DeepSeek, LM Studio, Ollama, etc.
 *
 * Zero external HTTP dependencies — uses Node.js built-in fetch + ReadableStream.
 */

import type {
  OpenAIChatRequest,
  OpenAIChunk,
  OpenAIToolDef,
  ToluCompatSettings,
  ToluMessage,
  ToluTool,
} from "../types/index.js";

import { parseSSEResponse } from "./openai-streaming.js";
import { toolParamsToJsonSchema, transformMessages } from "./openai-message-transforms.js";

// ─── Compatibility Detection ─────────────────────────────────────────────────

/** Detect compatibility settings from the base URL */
export function detectCompatSettings(baseUrl: string): ToluCompatSettings {
  const url = baseUrl.toLowerCase();

  // Provider-specific defaults
  const isOllama = url.includes("localhost:11434") || url.includes("127.0.0.1:11434");
  const isOpenRouter = url.includes("openrouter.ai");
  const isGroq = url.includes("groq.com");
  const isDeepSeek = url.includes("deepseek.com") || url.includes("deepseek.ai");
  const isOpenAI = url.includes("api.openai.com");
  const isLmStudio = url.includes("localhost:1234") || url.includes("lmstudio");

  return {
    supportsUsageInStreaming: !(isOllama || isLmStudio),
    maxTokensField: isOpenAI ? "max_completion_tokens" : "max_tokens",
    supportsDeveloperRole: isOpenAI,
    supportsReasoningEffort: isOpenAI || isDeepSeek,
    requiresToolResultName: isGroq,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: isOllama,
    thinkingFormat: isOpenRouter ? "openrouter" : isOpenAI || isDeepSeek ? "openai" : "none",
  };
}

// ─── Client Class ────────────────────────────────────────────────────────────

export interface OpenAIClientOptions {
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
}

export class OpenAIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  readonly compat: ToluCompatSettings;

  constructor(options: OpenAIClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    this.compat = detectCompatSettings(this.baseUrl);
  }

  /**
   * Stream a chat completion request.
   * Yields raw OpenAIChunk objects parsed from SSE events.
   */
  async *streamChat(
    request: OpenAIChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<OpenAIChunk> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      ...this.headers,
      Authorization: `Bearer ${this.apiKey}`,
    };

    const body: OpenAIChatRequest = {
      ...request,
      stream: true,
    };

    if (this.compat.supportsUsageInStreaming) {
      body.stream_options = { include_usage: true };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new OpenAIClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorText,
      );
    }

    if (!response.body) {
      throw new OpenAIClientError("Response body is null", 0, "No readable stream");
    }

    for await (const data of parseSSEResponse(response.body)) {
      try {
        const chunk: OpenAIChunk = JSON.parse(data);
        yield chunk;
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  /**
   * Complete a non-streaming chat request.
   */
  async completeChat(
    request: OpenAIChatRequest,
    signal?: AbortSignal,
  ): Promise<OpenAIChunk> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      ...this.headers,
      Authorization: `Bearer ${this.apiKey}`,
    };

    const body: OpenAIChatRequest = {
      ...request,
      stream: false,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new OpenAIClientError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorText,
      );
    }

    return (await response.json()) as OpenAIChunk;
  }

  /** Build the full request payload */
  buildRequest(
    model: string,
    messages: ToluMessage[],
    tools: ToluTool[] | undefined,
    systemPrompt: string | undefined,
    options: {
      temperature?: number;
      maxTokens?: number;
      reasoning?: string | boolean;
    },
  ): OpenAIChatRequest {
    const chatMessages = transformMessages(messages, this.compat);

    if (systemPrompt) {
      const role = this.compat.supportsDeveloperRole ? "developer" : "system";
      chatMessages.unshift({ role, content: systemPrompt });
    }

    const request: OpenAIChatRequest = {
      model,
      messages: chatMessages,
    };

    if (options.temperature !== undefined) {
      request.temperature = options.temperature;
    }

    if (options.maxTokens !== undefined) {
      if (this.compat.maxTokensField === "max_completion_tokens") {
        request.max_completion_tokens = options.maxTokens;
      } else {
        request.max_tokens = options.maxTokens;
      }
    }

    if (tools && tools.length > 0) {
      request.tools = tools.map((tool): OpenAIToolDef => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: toolParamsToJsonSchema(tool.parameters),
        },
      }));
      request.tool_choice = "auto";
    }

    if (options.reasoning) {
      if (this.compat.supportsReasoningEffort && typeof options.reasoning === "string") {
        request.reasoning_effort = options.reasoning;
      }
    }

    return request;
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class OpenAIClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "OpenAIClientError";
    this.status = status;
    this.body = body;
  }
}
