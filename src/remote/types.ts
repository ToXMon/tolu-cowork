/**
 * @tolu/cowork-core — Remote access type definitions
 *
 * Interfaces for QR pairing, session tokens, device trust,
 * challenge-response authentication, and credential storage.
 */

/** Represents a pairing code for device authentication. */
export interface PairingCode {
  /** 10-character alphanumeric code (no ambiguous chars). */
  code: string;
  /** Expiration timestamp (5 minutes from creation). */
  expiresAt: number;
  /** Device that used this code, or null if unused. */
  deviceId: string | null;
  /** Whether this code has been used. */
  used: boolean;
  /** Creation timestamp. */
  createdAt: number;
}

/** Represents an authenticated session token. */
export interface SessionToken {
  /** Hex-encoded 64-byte random token. */
  token: string;
  /** Device this session belongs to. */
  deviceId: string;
  /** Creation timestamp. */
  createdAt: number;
  /** Expiration timestamp (24 hours). */
  expiresAt: number;
  /** When this token should be rotated (1 hour). */
  rotationAt: number;
  /** Permission scopes for this session. */
  scope: string[];
}

/** Information about a registered device. */
export interface DeviceInfo {
  /** Unique device identifier. */
  deviceId: string;
  /** Human-readable device name. */
  name: string;
  /** Device fingerprint (hash of hardware/software characteristics). */
  fingerprint: string;
  /** First time this device was seen. */
  firstSeen: number;
  /** Last time this device was active. */
  lastSeen: number;
  /** Current trust level of the device. */
  trustLevel: 'untrusted' | 'paired' | 'trusted';
  /** Base64-encoded Ed25519 public key for challenge-response. */
  publicKey?: string;
}

/** Challenge-response flow state for device trust verification. */
export interface TrustChallenge {
  /** Current step in the challenge flow. */
  step: 'challenge' | 'response' | 'verify' | 'complete';
  /** Base64-encoded random challenge bytes. */
  challenge?: string;
  /** Base64-encoded signature of the challenge. */
  signature?: string;
  /** Device being challenged. */
  deviceId: string;
}

/** Stored credentials for a device. */
export interface CredentialEntry {
  /** Device these credentials belong to. */
  deviceId: string;
  /** Key-value credential pairs (encrypted at rest). */
  credentials: Record<string, string>;
  /** Last update timestamp. */
  updatedAt: number;
}
