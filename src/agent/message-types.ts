/**
 * @tolu/cowork-core — Agent event types
 *
 * Defines the event system used by the agentic loop,
 * including configuration, event payloads, and handler signatures.
 */

import type { ToluMessage, ToluContent, ToluUsage } from "../types/index.js";
import type { ToolExecutionResult } from "../tools/tool-interface.js";

// ─── Agent Config ────────────────────────────────────────────────────────────

/** Configuration for the agentic loop. */
export interface AgentConfig {
  /** Maximum number of turns (LLM calls) before stopping. Default: 20. */
  maxTurns?: number;
  /** Maximum tool calls per single turn. Default: 10. */
  maxToolCallsPerTurn?: number;
  /** Tool execution strategy: parallel or sequential. Default: 'parallel'. */
  toolExecution?: "sequential" | "parallel";
  /** System prompt injected before messages. */
  systemPrompt?: string;
}

// ─── Agent Events ────────────────────────────────────────────────────────────

/** All possible agent event types. */
export type AgentEventType =
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "error";

/** Emitted when the agent begins a run. */
export interface AgentStartEvent {
  type: "agent_start";
  sessionId: string;
  prompt: string;
}

/** Emitted when the agent finishes a run. */
export interface AgentEndEvent {
  type: "agent_end";
  sessionId: string;
  totalTurns: number;
  usage: ToluUsage;
}

/** Emitted at the start of each turn (LLM call). */
export interface TurnStartEvent {
  type: "turn_start";
  sessionId: string;
  turn: number;
}

/** Emitted at the end of each turn. */
export interface TurnEndEvent {
  type: "turn_end";
  sessionId: string;
  turn: number;
  hadToolCalls: boolean;
}

/** Emitted when a new assistant message begins streaming. */
export interface MessageStartEvent {
  type: "message_start";
  sessionId: string;
}

/** Emitted as content is added to the current message. */
export interface MessageUpdateEvent {
  type: "message_update";
  sessionId: string;
  content: ToluContent;
}

/** Emitted when the assistant message is complete. */
export interface MessageEndEvent {
  type: "message_end";
  sessionId: string;
  message: ToluMessage;
}

/** Emitted before a tool execution begins. */
export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  sessionId: string;
  toolName: string;
  toolCallId: string;
}

/** Emitted during tool execution with progress. */
export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  sessionId: string;
  toolName: string;
  toolCallId: string;
  progress: string;
}

/** Emitted when a tool execution completes. */
export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  sessionId: string;
  result: ToolExecutionResult;
}

/** Emitted when an error occurs during the agent loop. */
export interface AgentErrorEvent {
  type: "error";
  sessionId: string;
  error: Error;
  fatal: boolean;
}

/** Union of all agent events. */
export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | AgentErrorEvent;

// ─── Event Handler ───────────────────────────────────────────────────────────

/** Handler function for agent events. */
export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;
