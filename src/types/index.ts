/**
 * @tolu/cowork-core — Core type definitions
 * Adapted from pi-ai's unified provider API for broad compatibility.
 */

// ─── Stop Reason ─────────────────────────────────────────────────────────────

export type ToluStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// ─── Content Types ───────────────────────────────────────────────────────────

export interface ToluTextContent {
  type: "text";
  text: string;
}

export interface ToluThinkingContent {
  type: "thinking";
  thinking: string;
  /** When true, the thinking content was redacted by safety filters. */
  redacted?: boolean;
}

export interface ToluImageContent {
  type: "image";
  data: string; // base64 encoded
  mimeType: string;
}

export interface ToluToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ToluContent =
  | ToluTextContent
  | ToluThinkingContent
  | ToluImageContent
  | ToluToolCallContent;

// ─── Tool Definition ─────────────────────────────────────────────────────────

export interface ToluToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToluToolParameter;
  properties?: Record<string, ToluToolParameter>;
  required?: string[];
}

export interface ToluTool {
  name: string;
  description: string;
  parameters: ToluToolParameter;
}

// ─── Tool Call (streaming accumulator) ───────────────────────────────────────

export interface ToluToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string built incrementally during streaming
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface ToluUserMessage {
  role: "user";
  content: string | ToluContent[];
  timestamp: number;
}

export interface ToluAssistantMessage {
  role: "assistant";
  content: ToluContent[];
  model: string;
  /** Provider-specific response/message identifier */
  responseId?: string;
  usage: ToluUsage;
  stopReason: ToluStopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToluToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ToluContent[];
  isError: boolean;
  timestamp: number;
}

export type ToluMessage = ToluUserMessage | ToluAssistantMessage | ToluToolResultMessage;

// ─── Usage / Cost ────────────────────────────────────────────────────────────

export interface ToluCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface ToluUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: ToluCost;
}

// ─── Model ───────────────────────────────────────────────────────────────────

export type ToluThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface ToluModelCostRates {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
}

export interface ToluModel {
  id: string;
  name: string;
  /** API style — always openai-completions for this provider */
  api: string;
  /** Provider identifier (openai, anthropic, openrouter, groq, etc.) */
  provider: string;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  /** Whether this model supports reasoning/thinking */
  reasoning: boolean;
  cost: ToluModelCostRates;
}

// ─── Context ─────────────────────────────────────────────────────────────────

export interface ToluContext {
  systemPrompt?: string;
  messages: ToluMessage[];
  tools?: ToluTool[];
}

// ─── Stream Events ──────────────────────────────────────────────────────────

export interface ToluStreamStart {
  type: "start";
  partial: ToluAssistantMessage;
}

export interface ToluStreamTextDelta {
  type: "text_delta";
  contentIndex: number;
  delta: string;
  partial: ToluAssistantMessage;
}

export interface ToluStreamThinkingDelta {
  type: "thinking_delta";
  contentIndex: number;
  delta: string;
  partial: ToluAssistantMessage;
}

export interface ToluStreamToolCallStart {
  type: "toolcall_start";
  contentIndex: number;
  toolCallId: string;
  toolCallName: string;
  partial: ToluAssistantMessage;
}

export interface ToluStreamToolCallDelta {
  type: "toolcall_delta";
  contentIndex: number;
  delta: string;
  partial: ToluAssistantMessage;
}

export interface ToluStreamToolCallEnd {
  type: "toolcall_end";
  contentIndex: number;
  toolCall: ToluToolCallContent;
  partial: ToluAssistantMessage;
}

export interface ToluStreamDone {
  type: "done";
  reason: Extract<ToluStopReason, "stop" | "length" | "toolUse">;
  message: ToluAssistantMessage;
}

export interface ToluStreamError {
  type: "error";
  reason: Extract<ToluStopReason, "aborted" | "error">;
  error: ToluAssistantMessage;
}

export type ToluStreamEvent =
  | ToluStreamStart
  | ToluStreamTextDelta
  | ToluStreamThinkingDelta
  | ToluStreamToolCallStart
  | ToluStreamToolCallDelta
  | ToluStreamToolCallEnd
  | ToluStreamDone
  | ToluStreamError;

// ─── Provider Config ─────────────────────────────────────────────────────────

export interface ToluProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Override api detection */
  api?: string;
  /** Override provider detection */
  provider?: string;
  /** Enable reasoning/thinking mode */
  reasoning?: boolean | ToluThinkingLevel;
  /** Max output tokens */
  maxTokens?: number;
  /** Sampling temperature */
  temperature?: number;
  /** Cost rates override */
  costRates?: ToluModelCostRates;
  /** Custom headers */
  headers?: Record<string, string>;
}

export interface ToluStreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  reasoning?: ToluThinkingLevel;
  headers?: Record<string, string>
}

// ─── Compatibility Detection ─────────────────────────────────────────────────

export interface ToluCompatSettings {
  /** Supports stream_options.include_usage */
  supportsUsageInStreaming: boolean;
  /** Which field for max tokens */
  maxTokensField: "max_completion_tokens" | "max_tokens";
  /** Supports developer role */
  supportsDeveloperRole: boolean;
  /** Supports reasoning_effort */
  supportsReasoningEffort: boolean;
  /** Tool results require name field */
  requiresToolResultName: boolean;
  /** Needs assistant message between tool results and next user message */
  requiresAssistantAfterToolResult: boolean;
  /** Thinking blocks must be text with <thinking> tags */
  requiresThinkingAsText: boolean;
  /** Reasoning format */
  thinkingFormat: "openai" | "openrouter" | "qwen" | "none";
}

// ─── OpenAI API Types (internal) ────────────────────────────────────────────

/** Shape of a chat completion request body */
export interface OpenAIChatRequest {
  model: string;
  messages: Array<OpenAIChatMessage>;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  tools?: Array<OpenAIToolDef>;
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  reasoning_effort?: string;
  store?: boolean;
}

export interface OpenAIChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>>;
  tool_calls?: Array<OpenAIToolCallChunk>;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolCallChunk {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** SSE chunk from /chat/completions */
export interface OpenAIChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index: number;
    delta?: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      thinking?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      };
      completion_tokens_details?: {
        reasoning_tokens?: number;
      };
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}
