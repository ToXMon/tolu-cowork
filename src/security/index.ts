/**
 * @tolu/cowork-core — Security barrel export
 *
 * Re-exports all security types, classes, and errors.
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  RotationPolicy,
  ApiKeyEntry,
  RateLimitPolicy,
  RateLimitEntry,
  AuditResult,
  AuditLogEntry,
  PermissionSet,
  SanitizationRule,
} from "./types.js";

export {
  RotationPolicySchema,
  ApiKeyEntrySchema,
  RateLimitPolicySchema,
  AuditLogEntrySchema,
  PermissionSetSchema,
  SanitizationRuleConfigSchema,
} from "./types.js";

// ─── Errors ─────────────────────────────────────────────────────────────────
export {
  SecurityError,
  ApiKeyNotFoundError,
  ApiKeyRotationError,
  EncryptionError,
  RateLimitExceededError,
  PermissionDeniedError,
  SanitizationError,
} from "./errors.js";

// ─── Core Modules ───────────────────────────────────────────────────────────
export { ApiKeyManager } from "./api-key-manager.js";
export { RateLimiter } from "./rate-limiter.js";
export type { RateLimitResult } from "./rate-limiter.js";
export { RequestResponseSanitizer } from "./sanitizer.js";
export { AuditLogger } from "./audit-logger.js";
export { PermissionSystem } from "./permission-system.js";
