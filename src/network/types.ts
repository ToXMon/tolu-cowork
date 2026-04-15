/**
 * @tolu/cowork-core — Network security type definitions
 *
 * Zod schemas and TypeScript interfaces for TLS, E2E encryption,
 * WebSocket security, and certificate pinning.
 */

import { z } from 'zod';

/** TLS configuration for secure connections. */
export const TlsConfigSchema = z.object({
  certPath: z.string(),
  keyPath: z.string(),
  caPath: z.string().optional(),
  minVersion: z.enum(['TLSv1.2', 'TLSv1.3']).default('TLSv1.3'),
});
/** Validated TLS configuration. */
export type TlsConfig = z.infer<typeof TlsConfigSchema>;

/** Mutual TLS configuration with client verification. */
export const MtlsConfigSchema = TlsConfigSchema.extend({
  clientCaPath: z.string(),
  verifyClient: z.boolean().default(true),
});
/** Validated mTLS configuration. */
export type MtlsConfig = z.infer<typeof MtlsConfigSchema>;

/** Represents an active E2E encrypted session. */
export interface E2ESession {
  /** Unique session identifier. */
  sessionId: string;
  /** Local NaCl box public key. */
  localPublicKey: Uint8Array;
  /** Local NaCl box private key. */
  localPrivateKey: Uint8Array;
  /** Remote NaCl box public key (null before handshake completes). */
  remotePublicKey: Uint8Array | null;
  /** Symmetric key for receiving (decrypting) messages. */
  rxKey: Uint8Array | null;
  /** Symmetric key for sending (encrypting) messages. */
  txKey: Uint8Array | null;
  /** Whether the handshake is complete and keys are derived. */
  established: boolean;
  /** Whether this side is the client or server. */
  role: 'client' | 'server';
  /** Timestamp when session was created. */
  createdAt: number;
  /** Timestamp when session expires. */
  expiresAt: number;
}

/** Encrypted message with nonce. */
export interface E2EMessage {
  /** Unique nonce for this encrypted message. */
  nonce: Uint8Array;
  /** Encrypted ciphertext. */
  ciphertext: Uint8Array;
}

/** WebSocket security configuration. */
export const WebSocketSecurityConfigSchema = z.object({
  maxFrameSize: z.number().default(1024 * 1024),
  maxMessageRate: z.number().default(100),
  pingInterval: z.number().default(30000),
  originWhitelist: z.array(z.string()).default(['http://localhost:*']),
});
/** Validated WebSocket security configuration. */
export type WebSocketSecurityConfig = z.infer<typeof WebSocketSecurityConfigSchema>;

/** Certificate pinning configuration. */
export interface CertPinConfig {
  /** SHA-256 hashes of expected certificate public keys. */
  pins: string[];
  /** Whether to reject connections that don't match pins. */
  enforce: boolean;
}
