/**
 * @tolu/cowork-core — Agent Loop
 *
 * Standalone functions for the think→act→observe agentic loop.
 * Handles streaming from the provider and context utilities.
 */

import type {
  ToluAssistantMessage,
  ToluContext,
  ToluMessage,
  ToluUsage,
} from "../types/index.js";
import type { ToluProvider } from "../provider/tolu-provider.js";
import type { AgentSession } from "./agent-session.js";
import type { ToluToolDefinition } from "../tools/tool-interface.js";
import { toToluTool } from "../tools/tool-interface.js";

// ─── Empty Usage Helper ──────────────────────────────────────────────────────

/** Create a zero-valued usage object. */
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

// ─── Stream Processing ──────────────────────────────────────────────────────

/**
 * Process a stream from the provider, accumulating into an assistant message.
 *
 * Iterates over stream events, emits real-time updates via the session,
 * and returns the final assembled assistant message.
 *
 * @param provider - The LLM provider to stream from.
 * @param context - The context (messages + tools) to send.
 * @param options - Stream options including abort signal.
 * @param session - The agent session for emitting events.
 * @param sessionId - The current session identifier.
 * @returns The completed assistant message.
 */
export async function processStream(
  provider: ToluProvider,
  context: ToluContext,
  options: { signal?: AbortSignal },
  session: AgentSession,
  sessionId: string,
): Promise<ToluAssistantMessage> {
  let lastMessage: ToluAssistantMessage | null = null;

  await session.emit({ type: "message_start", sessionId });

  for await (const event of provider.stream(context, options)) {
    switch (event.type) {
      case "done":
        lastMessage = event.message;
        break;
      case "error":
        lastMessage = event.error;
        break;
      case "text_delta":
      case "thinking_delta":
        // Emit content updates for real-time display
        if (event.partial.content.length > 0) {
          const latest = event.partial.content[event.partial.content.length - 1];
          if (latest) {
            await session.emit({
              type: "message_update",
              sessionId,
              content: latest,
            });
          }
        }
        break;
    }
  }

  return (
    lastMessage ?? {
      role: "assistant",
      content: [],
      model: provider.modelId,
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    }
  );
}

// ─── Message Utilities ──────────────────────────────────────────────────────

/**
 * Find the last assistant message in a message array.
 *
 * @param messages - Array of messages to search (searched in reverse).
 * @returns The last assistant message, or null if none found.
 */
export function findLastAssistant(
  messages: readonly ToluMessage[],
): ToluAssistantMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return messages[i] as ToluAssistantMessage;
    }
  }
  return null;
}

// ─── Context Builder ──────────────────────────────────────────────────────

/**
 * Build a ToluContext from session messages and registered tools.
 */
export function buildContext(
  registeredTools: Map<string, ToluToolDefinition>,
  systemPrompt: string,
  session: AgentSession,
): ToluContext {
  const tools = registeredTools.size > 0
    ? Array.from(registeredTools.values()).map(toToluTool)
    : undefined;

  return {
    systemPrompt: systemPrompt || undefined,
    messages: [...session.getMessages()],
    tools,
  };
}
