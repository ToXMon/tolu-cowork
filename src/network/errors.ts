/**
 * @tolu/cowork-core — Network security error classes
 *
 * Custom error hierarchy for network security operations.
 * All errors extend NetworkError for unified catch handling.
 */

/**
 * Base error for all network security failures.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Thrown when E2E encryption operations fail.
 */
export class E2EEncryptionError extends NetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'E2EEncryptionError';
  }
}

/**
 * Thrown when TLS configuration is invalid or loading fails.
 */
export class TLSConfigError extends NetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'TLSConfigError';
  }
}

/**
 * Thrown when WebSocket security validation fails.
 */
export class WebSocketSecurityError extends NetworkError {
  constructor(message: string) {
    super(message);
    this.name = 'WebSocketSecurityError';
  }
}

/**
 * Thrown when certificate pin validation fails.
 */
export class CertificatePinError extends NetworkError {
  /** Device identifier associated with the pin failure. */
  public readonly deviceId?: string;

  constructor(message: string, deviceId?: string) {
    super(message);
    this.name = 'CertificatePinError';
    this.deviceId = deviceId;
  }
}
