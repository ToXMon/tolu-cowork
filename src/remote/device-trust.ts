/**
 * @tolu/cowork-core — Device trust management
 *
 * Manages device registration, challenge-response authentication,
 * and trust level escalation based on age and session count.
 */

import nacl from 'tweetnacl';
import { randomBytes } from 'node:crypto';
import type { DeviceInfo, TrustChallenge } from './types.js';
import { DeviceTrustError } from './errors.js';

/**
 * Manages device trust levels and challenge-response verification.
 * Devices can escalate from 'untrusted' → 'paired' → 'trusted' based on
 * time and session thresholds. Supports Ed25519 signature verification
 * when a public key is registered.
 */
export class DeviceTrustManager {
  private devices: Map<string, DeviceInfo> = new Map();
  private pendingChallenges: Map<string, { challenge: string; createdAt: number }> = new Map();
  private sessionCounts: Map<string, number> = new Map();
  private readonly CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly TRUST_THRESHOLD_DAYS = 7;
  private readonly TRUST_THRESHOLD_SESSIONS = 5;

  /**
   * Register a new device.
   * @param info - Device registration info
   * @returns Registered device info
   */
  registerDevice(info: {
    deviceId: string;
    name: string;
    fingerprint: string;
    publicKey?: string;
  }): DeviceInfo {
    const now = Date.now();
    const device: DeviceInfo = {
      deviceId: info.deviceId,
      name: info.name,
      fingerprint: info.fingerprint,
      firstSeen: now,
      lastSeen: now,
      trustLevel: 'untrusted',
      publicKey: info.publicKey,
    };
    this.devices.set(info.deviceId, device);
    this.sessionCounts.set(info.deviceId, 0);
    return device;
  }

  /**
   * Generate a challenge for a device.
   * @param deviceId - Device to challenge
   * @returns Challenge object with random bytes
   * @throws {DeviceTrustError} If device not found
   */
  challengeDevice(deviceId: string): TrustChallenge {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceTrustError(`Device not found: ${deviceId}`);
    }

    const challengeBytes = randomBytes(32);
    const challenge = challengeBytes.toString('base64');

    this.pendingChallenges.set(deviceId, {
      challenge,
      createdAt: Date.now(),
    });

    return {
      step: 'challenge',
      challenge,
      deviceId,
    };
  }

  /**
   * Verify a device's challenge response.
   * If the device has a registered Ed25519 public key, verifies the signature.
   * Otherwise, just verifies the challenge exists and matches.
   * @param deviceId - Device responding to the challenge
   * @param response - Challenge response with signature
   * @returns Verification result with optional next step
   */
  verifyResponse(
    deviceId: string,
    response: TrustChallenge,
  ): { verified: boolean; nextStep?: TrustChallenge } {
    const pending = this.pendingChallenges.get(deviceId);
    if (!pending) {
      return { verified: false };
    }

    // Check challenge TTL
    if (Date.now() - pending.createdAt > this.CHALLENGE_TTL) {
      this.pendingChallenges.delete(deviceId);
      return { verified: false };
    }

    // Verify challenge matches
    if (response.challenge !== pending.challenge) {
      return { verified: false };
    }

    const device = this.devices.get(deviceId);
    if (!device) {
      return { verified: false };
    }

    // If device has a public key, verify Ed25519 signature
    if (device.publicKey && response.signature) {
      try {
        const publicKey = Uint8Array.from(
          Buffer.from(device.publicKey, 'base64'),
        );
        const signature = Uint8Array.from(
          Buffer.from(response.signature, 'base64'),
        );
        const message = Uint8Array.from(
          Buffer.from(pending.challenge, 'base64'),
        );

        const valid = nacl.sign.detached.verify(message, signature, publicKey);
        if (!valid) {
          return { verified: false };
        }
      } catch {
        return { verified: false };
      }
    }

    // Challenge verified — update session count
    this.pendingChallenges.delete(deviceId);
    const count = this.sessionCounts.get(deviceId) ?? 0;
    this.sessionCounts.set(deviceId, count + 1);

    // Update last seen
    device.lastSeen = Date.now();

    return {
      verified: true,
      nextStep: { step: 'complete', deviceId },
    };
  }

  /**
   * Update trust level for a device.
   * @param deviceId - Device to update
   * @param level - New trust level
   * @throws {DeviceTrustError} If device not found
   */
  updateTrustLevel(deviceId: string, level: DeviceInfo['trustLevel']): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceTrustError(`Device not found: ${deviceId}`);
    }
    device.trustLevel = level;
  }

  /**
   * Check and potentially escalate trust level.
   * Auto-escalates to 'trusted' after 7 days + 5 sessions.
   * @param deviceId - Device to check
   * @returns True if trust was escalated
   */
  checkTrustEscalation(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device || device.trustLevel !== 'paired') {
      return false;
    }

    const daysSinceFirstSeen =
      (Date.now() - device.firstSeen) / (24 * 3600 * 1000);
    const sessionCount = this.sessionCounts.get(deviceId) ?? 0;

    if (
      daysSinceFirstSeen >= this.TRUST_THRESHOLD_DAYS &&
      sessionCount >= this.TRUST_THRESHOLD_SESSIONS
    ) {
      device.trustLevel = 'trusted';
      return true;
    }

    return false;
  }

  /**
   * Get device info.
   * @param deviceId - Device to look up
   * @returns Device info or undefined
   */
  getDevice(deviceId: string): DeviceInfo | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Remove a device and its associated data.
   * @param deviceId - Device to remove
   */
  removeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    this.pendingChallenges.delete(deviceId);
    this.sessionCounts.delete(deviceId);
  }
}
