/**
 * @tolu/cowork-core — Security error classes
 *
 * Custom error hierarchy for security middleware operations.
 * All errors extend SecurityError for unified catch handling.
 */

/**
 * Base error for all security-related failures.
 */
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Thrown when a requested API key cannot be found in storage.
 */
export class ApiKeyNotFoundError extends SecurityError {
  /** Identifier of the key that was not found. */
  public readonly keyId: string;

  constructor(message: string, keyId: string) {
    super(message);
    this.name = "ApiKeyNotFoundError";
    this.keyId = keyId;
  }
}

/**
 * Thrown when API key rotation fails.
 */
export class ApiKeyRotationError extends SecurityError {
  /** Identifier of the key that failed rotation. */
  public readonly keyId: string;

  constructor(message: string, keyId: string) {
    super(message);
    this.name = "ApiKeyRotationError";
    this.keyId = keyId;
  }
}

/**
 * Thrown when encryption or decryption operations fail.
 */
export class EncryptionError extends SecurityError {
  /** The cryptographic operation that failed. */
  public readonly operation: "encrypt" | "decrypt" | "key-derivation";

  constructor(message: string, operation: "encrypt" | "decrypt" | "key-derivation") {
    super(message);
    this.name = "EncryptionError";
    this.operation = operation;
  }
}

/**
 * Thrown when a request exceeds the configured rate limit.
 */
export class RateLimitExceededError extends SecurityError {
  /** Provider that was rate-limited. */
  public readonly provider: string;
  /** Epoch timestamp (ms) when the rate limit window resets. */
  public readonly resetAt: number;

  constructor(message: string, provider: string, resetAt: number) {
    super(message);
    this.name = "RateLimitExceededError";
    this.provider = provider;
    this.resetAt = resetAt;
  }
}

/**
 * Thrown when a tool attempts to execute at an unauthorized sandbox level.
 */
export class PermissionDeniedError extends SecurityError {
  /** Name of the tool that was denied. */
  public readonly toolName: string;
  /** Sandbox level that was attempted. */
  public readonly sandboxLevel: string;

  constructor(message: string, toolName: string, sandboxLevel: string) {
    super(message);
    this.name = "PermissionDeniedError";
    this.toolName = toolName;
    this.sandboxLevel = sandboxLevel;
  }
}

/**
 * Thrown when input/output sanitization encounters an unexpected failure.
 */
export class SanitizationError extends SecurityError {
  /** The field or data path that caused the failure. */
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "SanitizationError";
    this.field = field;
  }
}
