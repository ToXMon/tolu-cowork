/**
 * @tolu/cowork-core — Remote access module
 *
 * Provides QR pairing, session management, device trust verification,
 * and secure credential storage for remote device access.
 */

export {
  RemoteAccessError,
  PairingError,
  SessionError,
  DeviceTrustError,
  CredentialStoreError,
} from './errors.js';

export type {
  PairingCode,
  SessionToken,
  DeviceInfo,
  TrustChallenge,
  CredentialEntry,
} from './types.js';

export { QRPairingManager } from './qr-pairing.js';

export { SessionManager } from './session-manager.js';

export { DeviceTrustManager } from './device-trust.js';

export { SecureCredentialStore } from './credential-store.js';
