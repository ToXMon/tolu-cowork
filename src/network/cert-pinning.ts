/**
 * @tolu/cowork-core — Certificate pinning
 *
 * Manages SHA-256 certificate pin hashes for global and per-device validation.
 * Used to prevent MITM attacks on WebSocket and API connections.
 */

import { CertificatePinError } from './errors.js';

/**
 * Certificate pinning manager.
 * Stores SHA-256 hashes of known certificate public keys and validates
 * incoming certificates against global and device-specific pin sets.
 */
export class CertificatePinning {
  private pins: Map<string, Set<string>> = new Map();
  private globalPins: Set<string> = new Set();
  private enforce: boolean;

  constructor(enforce?: boolean) {
    this.enforce = enforce ?? true;
  }

  /**
   * Add a global pin (SHA-256 hash of certificate public key).
   * @param publicKeyHash - SHA-256 hex digest of the certificate's public key
   */
  addPin(publicKeyHash: string): void {
    this.globalPins.add(publicKeyHash.toLowerCase());
  }

  /**
   * Set pins for a specific device (for phone dispatch).
   * Replaces any existing pins for the device.
   * @param deviceId - Device identifier
   * @param pins - Array of SHA-256 hex digests
   */
  pinForDevice(deviceId: string, pins: string[]): void {
    const normalized = new Set(pins.map((p) => p.toLowerCase()));
    this.pins.set(deviceId, normalized);
  }

  /**
   * Validate a certificate against known pins.
   * If deviceId is provided, checks device-specific pins first, then global.
   * If no deviceId, checks only global pins.
   * @param certFingerprint - SHA-256 hex digest of the certificate to validate
   * @param deviceId - Optional device to check device-specific pins
   * @returns True if the fingerprint matches a known pin
   * @throws {CertificatePinError} If enforcement is enabled and pin doesn't match
   */
  validateCertificate(certFingerprint: string, deviceId?: string): boolean {
    const fingerprint = certFingerprint.toLowerCase();

    // Check device-specific pins first
    if (deviceId) {
      const devicePins = this.pins.get(deviceId);
      if (devicePins && devicePins.has(fingerprint)) {
        return true;
      }
    }

    // Check global pins
    if (this.globalPins.has(fingerprint)) {
      return true;
    }

    // If no pins are configured at all, allow through
    if (this.globalPins.size === 0 && (deviceId ? !this.pins.has(deviceId) || this.pins.get(deviceId)!.size === 0 : true)) {
      return true;
    }

    if (this.enforce) {
      throw new CertificatePinError(
        `Certificate fingerprint ${fingerprint} does not match any known pins`,
        deviceId,
      );
    }

    return false;
  }

  /**
   * Remove a device's pins.
   * @param deviceId - Device identifier to remove pins for
   */
  removeDevicePins(deviceId: string): void {
    this.pins.delete(deviceId);
  }
}
