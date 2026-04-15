/**
 * @tolu/cowork-core — Web tools
 *
 * Web search via DuckDuckGo and URL content fetching.
 */

import { z } from "zod";
import { search as ddgSearch } from "duck-duck-scrape";
import type { ToluContent } from "../types/index.js";
import type { ToluToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./tool-interface.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function textContent(text: string): ToluContent {
  return { type: "text", text };
}

function errorContent(message: string): ToluContent {
  return { type: "text", text: `Error: ${message}` };
}

function makeResult(
  toolName: string,
  content: ToluContent[],
  isError: boolean,
  start: number,
): ToolExecutionResult {
  return {
    toolCallId: "",
    toolName,
    content,
    isError,
    duration: Date.now() - start,
  };
}

// ─── WebSearchTool ───────────────────────────────────────────────────────────

const WebSearchParamsSchema = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().min(1).max(50).optional(),
});

export const WebSearchTool: ToluToolDefinition = {
  name: "web_search",
  description: "Search the web using DuckDuckGo. Returns title, URL, and description.",
  parameters: WebSearchParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      maxResults: { type: "number", description: "Maximum results (1-50, default 10)" },
    },
    required: ["query"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = WebSearchParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { query, maxResults = 10 } = parsed.data;

    try {
      const searchResult = await ddgSearch(query);
      const results = searchResult.results.slice(0, maxResults);
      if (results.length === 0) {
        return makeResult(this.name, [textContent("No search results found")], false, start);
      }

      const lines = results.map(
        (r, i) =>
          `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ""}`,
      );

      return makeResult(this.name, [textContent(lines.join("\n\n"))], false, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(this.name, [errorContent(message)], true, start);
    }
  },
};

// ─── WebFetchTool ────────────────────────────────────────────────────────────

const WebFetchParamsSchema = z.object({
  url: z.string().min(1),
  maxLength: z.number().int().min(100).max(500_000).optional(),
});

export const WebFetchTool: ToluToolDefinition = {
  name: "web_fetch",
  description:
    "Fetch the text content of a URL. Strips HTML tags and returns plain text.",
  parameters: WebFetchParamsSchema,
  parameterSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      maxLength: {
        type: "number",
        description: "Maximum content length in chars (100-500000, default 50000)",
      },
    },
    required: ["url"],
  },
  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const parsed = WebFetchParamsSchema.safeParse(args);
    if (!parsed.success) {
      return makeResult(
        this.name,
        [errorContent(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(", ")}`)],
        true,
        start,
      );
    }

    const { url, maxLength = 50_000 } = parsed.data;

    try {
      const response = await fetch(url, {
        signal: context.signal ?? AbortSignal.timeout(30_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ToluCowork/0.1; +https://tolu.ai)",
          Accept: "text/html,text/plain,application/json",
        },
      });

      if (!response.ok) {
        return makeResult(
          this.name,
          [errorContent(`HTTP ${response.status}: ${response.statusText}`)],
          true,
          start,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();

      // Strip HTML tags if HTML content
      let text: string;
      if (contentType.includes("text/html")) {
        text = stripHtml(body);
      } else {
        text = body;
      }

      // Decode HTML entities
      text = decodeEntities(text);

      // Collapse whitespace
      text = text.replace(/\n{3,}/g, "\n\n").trim();

      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + "\n... (truncated)";
      }

      return makeResult(
        this.name,
        [textContent(text || "(empty response)")],
        false,
        start,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeResult(this.name, [errorContent(message)], true, start);
    }
  },
};

// ─── HTML Helpers ────────────────────────────────────────────────────────────

/** Strip HTML tags, keeping text content. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "");
}

/** Decode common HTML entities. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
