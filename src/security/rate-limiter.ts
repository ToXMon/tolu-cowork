/**
 * @tolu/cowork-core — Rate Limiter
 *
 * Sliding-window rate limiting with burst allowance
 * for per-provider and per-client request throttling.
 */

import type { RateLimitPolicy, RateLimitEntry } from "./types.js";
import { RateLimitPolicySchema } from "./types.js";

/** Default policies keyed by provider category. */
const DEFAULT_POLICIES: Record<string, RateLimitPolicy> = {
  /** LLM providers: 60 requests per minute. */
  llm: { windowMs: 60_000, maxRequests: 60, burstAllowance: 10 },
  /** Tool executors: 120 requests per minute. */
  tool: { windowMs: 60_000, maxRequests: 120, burstAllowance: 20 },
  /** Internal operations: effectively unlimited. */
  internal: { windowMs: 60_000, maxRequests: 10_000 },
};

/** Mapping of known provider names to their policy category. */
const PROVIDER_CATEGORY: Record<string, string> = {
  openai: "llm",
  anthropic: "llm",
  google: "llm",
  groq: "llm",
  mistral: "llm",
  cohere: "llm",
  deepseek: "llm",
  together: "llm",
  fireworks: "llm",
  perplexity: "llm",
  bash: "tool",
  write: "tool",
  edit: "tool",
  delete: "tool",
  exec: "tool",
  read: "tool",
  ls: "tool",
  find: "tool",
  grep: "tool",
  curl: "tool",
  wget: "tool",
  fetch: "tool",
};

/**
 * Result of a rate limit check.
 */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Epoch timestamp (ms) when the window resets. */
  resetAt: number;
}

/**
 * Sliding-window rate limiter with configurable per-provider policies.
 *
 * Uses Map-based storage suitable for single-process deployments.
 * Supports burst allowance beyond the standard request limit.
 */
export class RateLimiter {
  private readonly policies: Map<string, RateLimitPolicy> = new Map();
  private readonly entries: Map<string, RateLimitEntry> = new Map();

  constructor() {
    // Load default policies
    for (const [category, policy] of Object.entries(DEFAULT_POLICIES)) {
      this.policies.set(category, policy);
    }
  }

  /**
   * Checks whether a request is allowed under the current rate limit policy.
   *
   * @param provider - Provider or tool name to check.
   * @param clientId - Optional client identifier for per-client limiting.
   * @returns Rate limit result with allowed status, remaining count, and reset time.
   */
  checkLimit(provider: string, clientId?: string): RateLimitResult {
    const key = `${provider}:${clientId ?? "default"}`;
    const now = Date.now();
    const policy = this.resolvePolicy(provider);
    let entry = this.entries.get(key);

    if (!entry || now - entry.windowStart >= policy.windowMs) {
      // Start a new window
      entry = { count: 0, windowStart: now, burstCount: 0 };
      this.entries.set(key, entry);
    }

    const maxBurst = policy.burstAllowance ?? 0;
    const totalCapacity = policy.maxRequests + maxBurst;
    const totalUsed = entry.count + entry.burstCount;

    if (totalUsed < policy.maxRequests) {
      // Within normal limit
      entry.count++;
      return {
        allowed: true,
        remaining: totalCapacity - totalUsed - 1,
        resetAt: entry.windowStart + policy.windowMs,
      };
    }

    if (totalUsed < totalCapacity) {
      // Using burst allowance
      entry.burstCount++;
      return {
        allowed: true,
        remaining: totalCapacity - totalUsed - 1,
        resetAt: entry.windowStart + policy.windowMs,
      };
    }

    // Over limit
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + policy.windowMs,
    };
  }

  /**
   * Configures a rate limit policy for a specific provider.
   *
   * @param provider - Provider name to configure.
   * @param policy - Rate limit policy to apply.
   * @throws {Error} If the policy validation fails.
   */
  configureProvider(provider: string, policy: RateLimitPolicy): void {
    const validated = RateLimitPolicySchema.parse(policy);
    this.policies.set(provider, validated);
  }

  /**
   * Resets rate limit counters for a specific provider and optional client.
   *
   * @param provider - Provider name to reset.
   * @param clientId - Optional client identifier to reset.
   */
  reset(provider: string, clientId?: string): void {
    const key = `${provider}:${clientId ?? "default"}`;
    this.entries.delete(key);
  }

  /**
   * Resolves the effective rate limit policy for a provider.
   *
   * Checks for a direct provider policy first, then falls back
   * to the provider's category default, then to the most restrictive default.
   */
  private resolvePolicy(provider: string): RateLimitPolicy {
    const direct = this.policies.get(provider);
    if (direct) return direct;

    const category = PROVIDER_CATEGORY[provider];
    if (category) {
      const categoryPolicy = this.policies.get(category);
      if (categoryPolicy) return categoryPolicy;
    }

    // Fallback to the most conservative default (llm)
    return DEFAULT_POLICIES["llm"];
  }
}
