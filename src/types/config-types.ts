/**
 * @tolu/cowork-core — Config & message type definitions
 */

import type { ToluStopReason } from "./provider-types.js";
import type { ToluTool } from "./tool-types.js";

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
