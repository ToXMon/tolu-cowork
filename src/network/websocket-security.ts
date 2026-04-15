/**
 * @tolu/cowork-core — WebSocket security middleware
 *
 * Validates incoming WebSocket connections against origin whitelists,
 * enforces rate limits, validates frame sizes, and sanitizes messages.
 */

import type { WebSocketSecurityConfig } from './types.js';
import { WebSocketSecurityError } from './errors.js';

/** Tracks rate limit windows per session. */
interface RateLimitEntry {
  /** Message timestamps within the current sliding window. */
  timestamps: number[];
}

/**
 * WebSocket security validator.
 * Provides connection validation, rate limiting, frame size checks,
 * and message sanitization for WebSocket endpoints.
 */
export class WebSocketSecurity {
  private config: WebSocketSecurityConfig;
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  constructor(config?: Partial<WebSocketSecurityConfig>) {
    const defaults: WebSocketSecurityConfig = {
      maxFrameSize: 1024 * 1024,
      maxMessageRate: 100,
      pingInterval: 30000,
      originWhitelist: ['http://localhost:*'],
    };
    this.config = { ...defaults, ...config };
  }

  /**
   * Validate an incoming WebSocket connection request.
   * Checks origin against whitelist and validates required headers.
   * @param request - Incoming connection request with headers
   * @returns True if the connection is allowed
   */
  validateConnection(request: {
    headers: Record<string, string>;
    url?: string;
  }): boolean {
    const origin = request.headers['origin'] ?? request.headers['Origin'];
    if (!origin) {
      return false;
    }
    return this.isOriginAllowed(origin);
  }

  /**
   * Check rate limit for a session using a sliding window.
   * @param sessionId - Session identifier to check
   * @returns True if the message is within rate limits
   */
  checkRateLimit(sessionId: string): boolean {
    const now = Date.now();
    const windowMs = 1000; // 1 second window
    let entry = this.rateLimits.get(sessionId);

    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(sessionId, entry);
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter(
      (ts) => now - ts < windowMs,
    );

    if (entry.timestamps.length >= this.config.maxMessageRate) {
      return false;
    }

    entry.timestamps.push(now);
    return true;
  }

  /**
   * Validate frame size against configured maximum.
   * @param data - Frame data to validate
   * @param maxSize - Override maximum size (optional)
   * @returns True if the frame is within size limits
   */
  validateFrame(data: ArrayBuffer | Buffer, maxSize?: number): boolean {
    const limit = maxSize ?? this.config.maxFrameSize;
    const size = typeof data === 'object' && 'byteLength' in data
      ? data.byteLength
      : Buffer.byteLength(data as Buffer);
    return size <= limit;
  }

  /**
   * Sanitize a message before forwarding.
   * Strips functions, circular references, and sensitive patterns.
   * @param message - Message to sanitize
   * @returns Sanitized copy of the message
   */
  sanitizeMessage(message: unknown): unknown {
    return this.deepSanitize(message, new WeakSet());
  }

  /** Check if an origin matches the whitelist. */
  private isOriginAllowed(origin: string): boolean {
    return this.config.originWhitelist.some((pattern) => {
      if (pattern.includes('*')) {
        const regex = new RegExp(
          `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*')}$`,
        );
        return regex.test(origin);
      }
      return pattern === origin;
    });
  }

  /**
   * Recursively sanitize a value, stripping functions and sensitive patterns.
   * Uses a WeakSet to detect circular references.
   */
  private deepSanitize(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    switch (typeof value) {
      case 'string':
        return this.stripSensitivePatterns(value);
      case 'number':
      case 'boolean':
        return value;
      case 'function':
        return undefined;
      case 'object':
        break;
      default:
        return value;
    }

    // Handle Array
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      return value.map((item) => this.deepSanitize(item, seen));
    }

    // Handle Buffer
    if (Buffer.isBuffer(value)) {
      return value;
    }

    // Handle typed arrays (Uint8Array, etc.)
    if (ArrayBuffer.isView(value)) {
      return value;
    }

    // Handle plain objects
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === 'function') continue;
      // Skip keys that look like sensitive fields
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('privatekey') ||
        lowerKey.includes('private_key')
      ) {
        result[key] = '[REDACTED]';
        continue;
      }
      result[key] = this.deepSanitize(val, seen);
    }
    return result;
  }

  /** Strip common sensitive patterns from strings. */
  private stripSensitivePatterns(str: string): string {
    // Redact potential bearer tokens
    let result = str.replace(
      /bearer\s+[\w-]+\.[\w-]+\.[\w-]+/gi,
      '[REDACTED-TOKEN]',
    );
    // Redact potential API keys (long hex/base64 strings after common prefixes)
    result = result.replace(
      /(api[_-]?key|secret|token)\s*[:=]\s*['"]?[\w+/=]{20,}/gi,
      '$1=[REDACTED]',
    );
    return result;
  }
}
