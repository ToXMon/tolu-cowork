/**
 * @tolu/cowork-core — Tool type definitions
 */

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
