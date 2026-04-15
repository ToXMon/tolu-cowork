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
  OpenAIChatMessage,
  OpenAIToolDef,
  ToluCompatSettings,
  ToluMessage,
  ToluTool,
  ToluUserMessage,
  ToluAssistantMessage,
  ToluToolResultMessage,
  ToluContent,
  ToluToolParameter,
} from "../types/index.js";

// ─── SSE Parser ──────────────────────────────────────────────────────────────

/**
 * Parse a Server-Sent Events stream from a ReadableStream<Uint8Array>.
 * Yields individual SSE data payloads (strings), skipping comments and empty lines.
 */
async function* parseSSEResponse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      const parts = buffer.split("\n\n");
      // Keep the last (potentially incomplete) part in the buffer
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6); // strip "data: "
            if (data === "[DONE]") continue;
            yield data;
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
            yield data;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

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

// ─── Message Transformation ──────────────────────────────────────────────────

/** Convert ToluContent to a simple string */
function contentToString(content: ToluContent[]): string {
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/** Convert a ToluToolParameter schema to an OpenAI-compatible JSON Schema object */
function toolParamsToJsonSchema(params: ToluToolParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: params.type,
  };
  if (params.description) schema.description = params.description;
  if (params.enum) schema.enum = params.enum;
  if (params.properties) {
    schema.properties = {};
    for (const [key, val] of Object.entries(params.properties)) {
      (schema.properties as Record<string, unknown>)[key] = toolParamsToJsonSchema(val);
    }
  }
  if (params.required) schema.required = params.required;
  if (params.items) schema.items = toolParamsToJsonSchema(params.items);
  return schema;
}

/** Convert ToluMessage[] to OpenAI ChatMessage format */
function transformMessages(
  messages: ToluMessage[],
  compat: ToluCompatSettings,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const userMsg = msg as ToluUserMessage;
        const content = typeof userMsg.content === "string" 
          ? userMsg.content 
          : contentToString(userMsg.content as ToluContent[]);
        result.push({ role: "user", content });
        break;
      }
      case "assistant": {
        const assistantMsg = msg as ToluAssistantMessage;
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];
        let textContent = "";

        for (const block of assistantMsg.content) {
          if (block.type === "text") {
            textContent += block.text;
          } else if (block.type === "thinking") {
            if (compat.requiresThinkingAsText) {
              textContent += `<thinking>${block.thinking}</thinking>`;
            }
          } else if (block.type === "toolCall") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.arguments),
              },
            });
          }
        }

        const chatMsg: OpenAIChatMessage = {
          role: "assistant",
          content: textContent || null as unknown as string,
        };
        if (toolCalls.length > 0) {
          chatMsg.tool_calls = toolCalls;
        }
        result.push(chatMsg);
        break;
      }
      case "toolResult": {
        const toolMsg = msg as ToluToolResultMessage;
        const content = contentToString(toolMsg.content);
        const chatMsg: OpenAIChatMessage = {
          role: "tool",
          content,
          tool_call_id: toolMsg.toolCallId,
        };
        if (compat.requiresToolResultName) {
          chatMsg.name = toolMsg.toolName;
        }
        result.push(chatMsg);
        break;
      }
    }
  }

  return result;
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
    // Normalize base URL — strip trailing slash
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

    // Ensure stream is enabled
    const body: OpenAIChatRequest = {
      ...request,
      stream: true,
    };

    // Request usage in streaming if supported
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
        // Skip malformed JSON chunks — some providers send non-JSON in streams
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

    // Prepend system/developer prompt
    if (systemPrompt) {
      const role = this.compat.supportsDeveloperRole ? "developer" : "system";
      chatMessages.unshift({ role, content: systemPrompt });
    }

    const request: OpenAIChatRequest = {
      model,
      messages: chatMessages,
    };

    // Temperature
    if (options.temperature !== undefined) {
      request.temperature = options.temperature;
    }

    // Max tokens — use correct field name for provider
    if (options.maxTokens !== undefined) {
      if (this.compat.maxTokensField === "max_completion_tokens") {
        request.max_completion_tokens = options.maxTokens;
      } else {
        request.max_tokens = options.maxTokens;
      }
    }

    // Tools
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

    // Reasoning / thinking
    if (options.reasoning) {
      if (this.compat.supportsReasoningEffort && typeof options.reasoning === "string") {
        request.reasoning_effort = options.reasoning;
      }
      // For providers that need thinking enabled via other means,
      // the provider layer handles additional transformation
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
