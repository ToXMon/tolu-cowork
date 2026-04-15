/**
 * openai-streaming.ts — SSE stream parser for OpenAI-compatible endpoints
 *
 * Parses Server-Sent Events from a ReadableStream<Uint8Array>,
 * yielding individual JSON data payloads.
 */

/**
 * Parse a Server-Sent Events stream from a ReadableStream<Uint8Array>.
 * Yields individual SSE data payloads (strings), skipping comments and empty lines.
 */
export async function* parseSSEResponse(
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
