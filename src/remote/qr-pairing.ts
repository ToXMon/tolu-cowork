/**
 * @tolu/cowork-core — QR code pairing manager
 *
 * Generates and validates short-lived pairing codes for device authentication.
 * Inspired by Lunel's QR pairing with 5-minute TTL and single-use enforcement.
 */

import { randomBytes } from 'node:crypto';
import type { PairingCode, DeviceInfo, SessionToken } from './types.js';
import { PairingError } from './errors.js';

/** Charset without ambiguous characters (0/O, 1/l/I removed). */
const PAIRING_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Manages QR code pairing for device authentication.
 * Codes are 10 characters, single-use, and expire after 5 minutes.
 */
export class QRPairingManager {
  private codes: Map<string, PairingCode> = new Map();
  private devices: Map<string, DeviceInfo> = new Map();
  private rateLimits: Map<string, { count: number; windowStart: number }> = new Map();
  private readonly CODE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly CODE_LENGTH = 10;
  private readonly MAX_ATTEMPTS_PER_IP = 5;
  private readonly ATTEMPT_WINDOW = 60 * 60 * 1000; // 1 hour

  /**
   * Generate a new pairing code.
   * @returns A new PairingCode with 10-char alphanumeric string
   */
  generatePairingCode(): PairingCode {
    const code = this.generateCodeString();
    const now = Date.now();
    const pairingCode: PairingCode = {
      code,
      expiresAt: now + this.CODE_TTL,
      deviceId: null,
      used: false,
      createdAt: now,
    };
    this.codes.set(code, pairingCode);
    return pairingCode;
  }

  /**
   * Validate a pairing code.
   * @param code - Pairing code string to validate
   * @returns Validation result with optional device ID if code was used
   */
  validatePairingCode(code: string): { valid: boolean; deviceId?: string } {
    const entry = this.codes.get(code);
    if (!entry) {
      return { valid: false };
    }
    if (entry.used) {
      return { valid: false, deviceId: entry.deviceId ?? undefined };
    }
    if (Date.now() > entry.expiresAt) {
      return { valid: false };
    }
    return { valid: true };
  }

  /**
   * Complete pairing: exchange code for session token.
   * Marks code as used (single-use) and creates a device entry.
   * @param code - Valid pairing code
   * @param deviceInfo - Device information from the pairing request
   * @returns Session token for the newly paired device
   * @throws {PairingError} If code is invalid, expired, or already used
   */
  completePairing(
    code: string,
    deviceInfo: Omit<DeviceInfo, 'firstSeen' | 'lastSeen' | 'trustLevel'>,
  ): SessionToken {
    const entry = this.codes.get(code);
    if (!entry) {
      throw new PairingError('Invalid pairing code');
    }
    if (entry.used) {
      throw new PairingError('Pairing code already used');
    }
    if (Date.now() > entry.expiresAt) {
      throw new PairingError('Pairing code expired');
    }

    // Mark code as used
    entry.used = true;
    entry.deviceId = deviceInfo.deviceId;

    // Create device entry
    const now = Date.now();
    const device: DeviceInfo = {
      ...deviceInfo,
      firstSeen: now,
      lastSeen: now,
      trustLevel: 'paired',
    };
    this.devices.set(deviceInfo.deviceId, device);

    // Generate session token
    const token = randomBytes(64).toString('hex');
    const sessionToken: SessionToken = {
      token,
      deviceId: deviceInfo.deviceId,
      createdAt: now,
      expiresAt: now + 24 * 3600 * 1000, // 24 hours
      rotationAt: now + 3600 * 1000, // 1 hour
      scope: ['pair', 'session'],
    };

    return sessionToken;
  }

  /**
   * Check rate limit for a given source (e.g. IP address).
   * @param source - Rate limit key (IP, device ID, etc.)
   * @returns True if the request is within rate limits
   */
  checkRateLimit(source: string): boolean {
    const now = Date.now();
    let entry = this.rateLimits.get(source);

    if (!entry || now - entry.windowStart > this.ATTEMPT_WINDOW) {
      entry = { count: 1, windowStart: now };
      this.rateLimits.set(source, entry);
      return true;
    }

    entry.count++;
    return entry.count <= this.MAX_ATTEMPTS_PER_IP;
  }

  /**
   * Revoke a paired device.
   * @param deviceId - Device to revoke
   */
  revokePairing(deviceId: string): void {
    this.devices.delete(deviceId);
  }

  /**
   * List all paired devices.
   * @returns Array of device info for all paired devices
   */
  listPairedDevices(): DeviceInfo[] {
    return [...this.devices.values()];
  }

  /** Generate a random pairing code string. */
  private generateCodeString(): string {
    const bytes = randomBytes(this.CODE_LENGTH);
    let code = '';
    for (let i = 0; i < this.CODE_LENGTH; i++) {
      code += PAIRING_CHARSET[bytes[i]! % PAIRING_CHARSET.length];
    }
    return code;
  }
}
