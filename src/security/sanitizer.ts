/**
 * @tolu/cowork-core — Request/Response Sanitizer
 *
 * Sanitizes requests and responses to prevent leakage of
 * sensitive data such as API keys, tokens, private IPs,
 * and local file paths.
 */

import type { SanitizationRule } from "./types.js";
import { SanitizationError } from "./errors.js";

/** Default replacement text for redacted content. */
const REDACTED = "[REDACTED]";

/**
 * Built-in sanitization rules for common sensitive patterns.
 */
const BUILTIN_RULES: SanitizationRule[] = [
  {
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: REDACTED,
    description: "OpenAI-style API keys (sk-...)",
  },
  {
    pattern: /key-[a-zA-Z0-9]{20,}/g,
    replacement: REDACTED,
    description: "Generic API keys (key-...)",
  },
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: "Bearer [REDACTED]",
    description: "Bearer authorization tokens",
  },
  {
    pattern: /\b(?:10|127)(?:\.\d{1,3}){3}\b/g,
    replacement: REDACTED,
    description: "Private IPv4 addresses (10.x.x.x, 127.x.x.x)",
  },
  {
    pattern: /\b172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}\b/g,
    replacement: REDACTED,
    description: "Private IPv4 addresses (172.16-31.x.x)",
  },
  {
    pattern: /\b192\.168(?:\.\d{1,3}){2}\b/g,
    replacement: REDACTED,
    description: "Private IPv4 addresses (192.168.x.x)",
  },
  {
    pattern: /\/home\/[^\s"']+/g,
    replacement: REDACTED,
    description: "Linux home directory paths",
  },
  {
    pattern: /\/Users\/[^\s"']+/g,
    replacement: REDACTED,
    description: "macOS home directory paths",
  },
];

/**
 * Sanitizes requests and responses by replacing sensitive patterns.
 *
 * Applies a set of built-in and user-defined rules to remove
 * API keys, tokens, private IP addresses, and local file paths
 * from data objects. Performs deep recursive sanitization on
 * nested structures.
 */
export class RequestResponseSanitizer {
  private readonly rules: SanitizationRule[];

  constructor() {
    // Copy built-in rules
    this.rules = [...BUILTIN_RULES];
  }

  /**
   * Sanitizes a request object by removing sensitive patterns.
   *
   * @param request - The request data to sanitize.
   * @returns A new object with sensitive data replaced by [REDACTED].
   */
  sanitizeRequest(request: Record<string, unknown>): Record<string, unknown> {
    return this.sanitizeObject(request) as Record<string, unknown>;
  }

  /**
   * Sanitizes a response object by stripping leaked keys and tokens.
   *
   * @param response - The response data to sanitize.
   * @returns A new object with sensitive data replaced by [REDACTED].
   */
  sanitizeResponse(response: Record<string, unknown>): Record<string, unknown> {
    return this.sanitizeObject(response) as Record<string, unknown>;
  }

  /**
   * Adds a custom sanitization rule.
   *
   * @param rule - The sanitization rule to add.
   */
  addRule(rule: SanitizationRule): void {
    this.rules.push(rule);
  }

  /**
   * Deep sanitizes any data for audit logging.
   *
   * Handles strings, numbers, booleans, null, arrays, and objects.
   * Returns a sanitized copy without modifying the original.
   *
   * @param data - The data to sanitize.
   * @returns A sanitized copy of the data.
   */
  sanitizeForLogging(data: unknown): unknown {
    return this.sanitizeObject(data);
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Recursively sanitizes a value by applying all rules to strings.
   */
  private sanitizeObject(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === "string") {
      return this.applyRules(data);
    }

    if (typeof data === "number" || typeof data === "boolean") {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeObject(item));
    }

    if (typeof data === "object") {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        sanitized[key] = this.sanitizeObject(value);
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Applies all sanitization rules to a string value.
   *
   * @param value - The string to sanitize.
   * @returns The sanitized string.
   * @throws {SanitizationError} If a rule fails to apply.
   */
  private applyRules(value: string): string {
    let result = value;
    for (const rule of this.rules) {
      try {
        // Reset lastIndex for global regexes
        rule.pattern.lastIndex = 0;
        result = result.replace(rule.pattern, rule.replacement);
      } catch (err) {
        throw new SanitizationError(
          `Sanitization rule '${rule.description}' failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return result;
  }
}
