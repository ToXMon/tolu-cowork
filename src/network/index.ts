/**
 * @tolu/cowork-core — Network security module
 *
 * Provides E2E encryption, TLS configuration, WebSocket security,
 * and certificate pinning for secure network communications.
 */

export {
  NetworkError,
  E2EEncryptionError,
  TLSConfigError,
  WebSocketSecurityError,
  CertificatePinError,
} from './errors.js';

export {
  TlsConfigSchema,
  MtlsConfigSchema,
  WebSocketSecurityConfigSchema,
} from './types.js';

export type {
  TlsConfig,
  MtlsConfig,
  E2ESession,
  E2EMessage,
  WebSocketSecurityConfig,
  CertPinConfig,
} from './types.js';

export { E2EEncryption } from './e2e-encryption.js';

export { TLSConfigurator } from './tls-config.js';
export type { CertValidationResult } from './tls-config.js';

export { WebSocketSecurity } from './websocket-security.js';

export { CertificatePinning } from './cert-pinning.js';
