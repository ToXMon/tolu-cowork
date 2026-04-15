/**
 * @tolu/cowork-core — Agent session
 *
 * Manages a single conversation session including message history,
 * event subscriptions, and usage tracking.
 */

import * as crypto from "node:crypto";
import type { ToluMessage, ToluUsage, ToluAssistantMessage } from "../types/index.js";
import type { AgentEvent, AgentEventHandler } from "./message-types.js";

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

function mergeUsage(a: ToluUsage, b: ToluUsage): ToluUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: Math.round((a.cost.input + b.cost.input) * 100) / 100,
      output: Math.round((a.cost.output + b.cost.output) * 100) / 100,
      cacheRead: Math.round((a.cost.cacheRead + b.cost.cacheRead) * 100) / 100,
      cacheWrite: Math.round((a.cost.cacheWrite + b.cost.cacheWrite) * 100) / 100,
      total: Math.round((a.cost.total + b.cost.total) * 100) / 100,
    },
  };
}

// ─── AgentSession ────────────────────────────────────────────────────────────

/**
 * Manages a single conversation session: message history,
 * event handler subscriptions, and cumulative usage.
 */
export class AgentSession {
  /** Conversation message history. */
  private readonly messages: ToluMessage[] = [];
  /** Unique session identifier. */
  private readonly sessionCreatedAt: number;
  /** Registered event handlers. */
  private readonly handlers: AgentEventHandler[] = [];
  /** Cumulative token/cost usage for this session. */
  private cumulativeUsage: ToluUsage = emptyUsage();
  /** Unique session ID. */
  private readonly sessionId: string;

  constructor() {
    this.sessionId = crypto.randomUUID();
    this.sessionCreatedAt = Date.now();
  }

  /**
   * Append a message to the conversation history.
   *
   * @param message - The message to add.
   */
  addMessage(message: ToluMessage): void {
    this.messages.push(message);

    // Track usage from assistant messages
    if (message.role === "assistant") {
      const assistant = message as ToluAssistantMessage;
      this.cumulativeUsage = mergeUsage(this.cumulativeUsage, assistant.usage);
    }
  }

  /**
   * Get an immutable view of the message history.
   *
   * @returns Readonly array of messages.
   */
  getMessages(): readonly ToluMessage[] {
    return this.messages;
  }

  /**
   * Get the session's unique identifier.
   *
   * @returns The session ID string.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the session creation timestamp.
   *
   * @returns Epoch milliseconds.
   */
  getCreatedAt(): number {
    return this.sessionCreatedAt;
  }

  /**
   * Reset the session, clearing all messages.
   */
  clear(): void {
    this.messages.length = 0;
    this.cumulativeUsage = emptyUsage();
  }

  /**
   * Subscribe to agent events.
   *
   * @param handler - Function to call for each event.
   * @returns Unsubscribe function.
   */
  onEvent(handler: AgentEventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) {
        this.handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Emit an event to all registered handlers.
   *
   * @param event - The event to emit.
   */
  async emit(event: AgentEvent): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch {
        // Swallow handler errors to avoid breaking the agent loop
      }
    }
  }

  /**
   * Count total tool calls in the current session.
   *
   * @returns Number of tool call content blocks across all assistant messages.
   */
  getToolCallCount(): number {
    let count = 0;
    for (const msg of this.messages) {
      if (msg.role === "assistant") {
        const assistant = msg as ToluAssistantMessage;
        for (const content of assistant.content) {
          if (content.type === "toolCall") count++;
        }
      }
    }
    return count;
  }

  /**
   * Get cumulative usage stats for this session.
   *
   * @returns Copy of the cumulative usage.
   */
  getUsage(): ToluUsage {
    return { ...this.cumulativeUsage };
  }
}
