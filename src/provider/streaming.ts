/**
 * streaming.ts — SSE streaming handler for ToluProvider
 *
 * Processes streaming chunks from OpenAI-compatible endpoints,
 * accumulating tool calls, text, and reasoning content.
 */

import { OpenAIClient } from "./openai-client.js";
import type { OpenAIChatRequest } from "../types/index.js";
import type {
  ToluStreamEvent,
  ToluAssistantMessage,
  ToluToolCallContent,
} from "../types/index.js";
import type { ToolCallAccumulator, StreamProcessContext } from "./types.js";
import {
  calculateCost,
  parseToolCallArguments,
  emptyAssistantMessage,
  mapFinishReason,
  mergeUsage,
} from "./response-parser.js";

/**
 * Process a streaming chat completion request, yielding typed stream events.
 */
export async function* processStream(
  client: OpenAIClient,
  request: OpenAIChatRequest,
  signal: AbortSignal,
  ctx: StreamProcessContext,
): AsyncGenerator<ToluStreamEvent> {
  const output: ToluAssistantMessage = emptyAssistantMessage(ctx.model);
  const toolCalls = new Map<number, ToolCallAccumulator>();
  let currentTextIndex = -1;
  let currentThinkingIndex = -1;

  try {
    const stream = client.streamChat(request, signal);

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
          cacheWrite: 0,
          totalTokens: chunkUsage.total_tokens ?? 0,
          cost: calculateCost(
            chunkUsage.prompt_tokens ?? 0,
            chunkUsage.completion_tokens ?? 0,
            cacheRead,
            0,
            ctx.costRates,
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
            const acc: ToolCallAccumulator = {
              id: tc.id,
              name: tc.function?.name ?? "",
              argumentsJson: "",
              contentIndex: output.content.length,
            };
            toolCalls.set(tcIndex, acc);

            output.content.push({
              type: "toolCall",
              id: tc.id,
              name: acc.name,
              arguments: {},
            });

            yield {
              type: "toolcall_start",
              contentIndex: acc.contentIndex,
              toolCallId: tc.id,
              toolCallName: acc.name,
              partial: output,
            };
          }

          if (tc.function?.arguments) {
            const acc = toolCalls.get(tcIndex);
            if (acc) {
              acc.argumentsJson += tc.function.arguments;

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
        output.stopReason = mapFinishReason(choice.finish_reason);
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
      ctx.cumulativeUsageRef.usage = mergeUsage(ctx.cumulativeUsageRef.usage, output.usage);

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
  }
}
