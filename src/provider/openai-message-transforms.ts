/**
 * openai-message-transforms.ts — Pure message transformation helpers
 *
 * Converts Tolu message types to OpenAI chat completion format.
 */

import type {
  OpenAIChatMessage,
  ToluCompatSettings,
  ToluContent,
  ToluMessage,
  ToluToolParameter,
  ToluUserMessage,
  ToluAssistantMessage,
  ToluToolResultMessage,
} from "../types/index.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert ToluContent to a simple string */
export function contentToString(content: ToluContent[]): string {
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/** Convert a ToluToolParameter schema to an OpenAI-compatible JSON Schema object */
export function toolParamsToJsonSchema(params: ToluToolParameter): Record<string, unknown> {
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
export function transformMessages(
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
