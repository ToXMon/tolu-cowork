/**
 * @tolu/cowork-core — Remote access error classes
 *
 * Custom error hierarchy for remote access operations.
 * All errors extend RemoteAccessError for unified catch handling.
 */

/**
 * Base error for all remote access failures.
 */
export class RemoteAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteAccessError';
  }
}

/**
 * Thrown when pairing code operations fail.
 */
export class PairingError extends RemoteAccessError {
  constructor(message: string) {
    super(message);
    this.name = 'PairingError';
  }
}

/**
 * Thrown when session token operations fail.
 */
export class SessionError extends RemoteAccessError {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * Thrown when device trust verification fails.
 */
export class DeviceTrustError extends RemoteAccessError {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceTrustError';
  }
}

/**
 * Thrown when credential store operations fail.
 */
export class CredentialStoreError extends RemoteAccessError {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}
