/**
 * @tolu/cowork-core — Security type definitions
 *
 * Configuration types, runtime schemas, and interfaces
 * for the security middleware layer.
 */

import { z } from "zod";

// ─── API Key Types ──────────────────────────────────────────────────────────

/**
 * Rotation policy for automatic API key rotation.
 */
export interface RotationPolicy {
  /** Interval in days between automatic rotations. */
  intervalDays: number;
  /** Epoch timestamp (ms) when the next rotation should occur. */
  nextRotation: number;
}

/**
 * Stored API key entry with encrypted key material.
 */
export interface ApiKeyEntry {
  /** Unique identifier for this key entry. */
  id: string;
  /** Provider name (e.g. "openai", "anthropic", "google"). */
  provider: string;
  /** AES-256-GCM encrypted API key (base64 encoded). */
  keyEncrypted: string;
  /** SHA-256 hash of the raw key for verification. */
  keyHash: string;
  /** Epoch timestamp (ms) when this key was created. */
  createdAt: number;
  /** Epoch timestamp (ms) when this key was last used. */
  lastUsed?: number;
  /** Optional automatic rotation policy. */
  rotationPolicy?: RotationPolicy;
}

/** Zod schema for validating rotation policy objects. */
export const RotationPolicySchema = z.object({
  intervalDays: z.number().int().positive(),
  nextRotation: z.number().int().positive(),
});

/** Zod schema for validating API key entries from storage. */
export const ApiKeyEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  keyEncrypted: z.string().min(1),
  keyHash: z.string().min(1),
  createdAt: z.number().int().positive(),
  lastUsed: z.number().int().positive().optional(),
  rotationPolicy: RotationPolicySchema.optional(),
});

// ─── Rate Limiting Types ────────────────────────────────────────────────────

/**
 * Rate limiting policy configuration.
 */
export interface RateLimitPolicy {
  /** Duration of the sliding window in milliseconds. */
  windowMs: number;
  /** Maximum number of requests allowed per window. */
  maxRequests: number;
  /** Optional burst allowance beyond maxRequests. */
  burstAllowance?: number;
}

/**
 * Runtime rate limit tracking entry.
 */
export interface RateLimitEntry {
  /** Number of requests in the current window. */
  count: number;
  /** Epoch timestamp (ms) when the current window started. */
  windowStart: number;
  /** Number of burst requests consumed. */
  burstCount: number;
}

/** Zod schema for validating rate limit policies. */
export const RateLimitPolicySchema = z.object({
  windowMs: z.number().int().positive(),
  maxRequests: z.number().int().positive(),
  burstAllowance: z.number().int().nonnegative().optional(),
});

// ─── Audit Logging Types ────────────────────────────────────────────────────

/**
 * Result of an audited action.
 */
export type AuditResult = "success" | "denied" | "error";

/**
 * Single audit log entry recording a security-relevant event.
 */
export interface AuditLogEntry {
  /** Unique identifier for this log entry. */
  id: string;
  /** Epoch timestamp (ms) when this event occurred. */
  timestamp: number;
  /** Identity of the actor performing the action. */
  actor: string;
  /** Action that was attempted (e.g. "tool.execute", "key.retrieve"). */
  action: string;
  /** Resource that was accessed or targeted. */
  resource: string;
  /** Outcome of the action. */
  result: AuditResult;
  /** Optional additional details about the event. */
  details?: string;
  /** Sandbox level in effect when the action occurred. */
  sandboxLevel: string;
  /** Source IP address of the request, if available. */
  sourceIp?: string;
}

/** Zod schema for validating audit log entries. */
export const AuditLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int().positive(),
  actor: z.string().min(1),
  action: z.string().min(1),
  resource: z.string().min(1),
  result: z.enum(["success", "denied", "error"]),
  details: z.string().optional(),
  sandboxLevel: z.string().min(1),
  sourceIp: z.string().optional(),
});

// ─── Permission Types ───────────────────────────────────────────────────────

/**
 * Mapping of tool names to their allowed sandbox levels.
 * Uses string instead of SandboxLevel enum for serialization compatibility.
 */
export type PermissionSet = Record<string, string[]>;

/** Zod schema for validating permission sets. */
export const PermissionSetSchema = z.record(z.array(z.string()));

// ─── Sanitization Types ─────────────────────────────────────────────────────

/**
 * A single sanitization rule that matches a pattern and replaces it.
 */
export interface SanitizationRule {
  /** Regular expression pattern to match. */
  pattern: RegExp;
  /** Replacement text for matched content. */
  replacement: string;
  /** Human-readable description of what this rule sanitizes. */
  description: string;
}

/** Zod schema for sanitization rule configuration (pattern as string). */
export const SanitizationRuleConfigSchema = z.object({
  pattern: z.string().min(1),
  flags: z.string().optional(),
  replacement: z.string(),
  description: z.string().min(1),
});
