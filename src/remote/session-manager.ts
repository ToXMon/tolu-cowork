/**
 * @tolu/cowork-core — Session token manager
 *
 * Manages authenticated session tokens with creation, validation,
 * rotation, and revocation. Tokens are hex-encoded 64-byte random values
 * with configurable TTL and automatic rotation windows.
 */

import { randomBytes } from 'node:crypto';
import type { SessionToken } from './types.js';
import { SessionError } from './errors.js';

/**
 * Manages session tokens for authenticated devices.
 * Tokens are 64 bytes of randomness, hex-encoded, with 24-hour TTL
 * and 1-hour rotation intervals.
 */
export class SessionManager {
  private sessions: Map<string, SessionToken> = new Map();
  private readonly TOKEN_BYTES = 64;
  private readonly DEFAULT_TTL = 24 * 3600 * 1000; // 24 hours
  private readonly ROTATION_INTERVAL = 3600 * 1000; // 1 hour

  /**
   * Create a new session token for a device.
   * @param deviceId - Device to create a session for
   * @param scope - Permission scopes for this session
   * @returns New session token
   */
  createSession(deviceId: string, scope?: string[]): SessionToken {
    const token = randomBytes(this.TOKEN_BYTES).toString('hex');
    const now = Date.now();
    const sessionToken: SessionToken = {
      token,
      deviceId,
      createdAt: now,
      expiresAt: now + this.DEFAULT_TTL,
      rotationAt: now + this.ROTATION_INTERVAL,
      scope: scope ?? ['default'],
    };
    this.sessions.set(token, sessionToken);
    return sessionToken;
  }

  /**
   * Validate a token.
   * @param token - Token string to validate
   * @returns Validation result with session data if valid
   */
  validateToken(token: string): { valid: boolean; session?: SessionToken } {
    const session = this.sessions.get(token);
    if (!session) {
      return { valid: false };
    }
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return { valid: false };
    }
    return { valid: true, session };
  }

  /**
   * Rotate a token (generate new, invalidate old).
   * @param currentToken - Current token to rotate
   * @returns New session token with reset rotation timer
   * @throws {SessionError} If token is invalid or expired
   */
  rotateToken(currentToken: string): SessionToken {
    const existing = this.sessions.get(currentToken);
    if (!existing) {
      throw new SessionError('Token not found');
    }
    if (Date.now() > existing.expiresAt) {
      this.sessions.delete(currentToken);
      throw new SessionError('Token expired');
    }

    // Invalidate old token
    this.sessions.delete(currentToken);

    // Create new token with same device and scope
    const newToken = randomBytes(this.TOKEN_BYTES).toString('hex');
    const now = Date.now();
    const sessionToken: SessionToken = {
      token: newToken,
      deviceId: existing.deviceId,
      createdAt: now,
      expiresAt: now + this.DEFAULT_TTL,
      rotationAt: now + this.ROTATION_INTERVAL,
      scope: existing.scope,
    };
    this.sessions.set(newToken, sessionToken);
    return sessionToken;
  }

  /**
   * Revoke a specific session.
   * @param token - Token to revoke
   */
  revokeSession(token: string): void {
    this.sessions.delete(token);
  }

  /**
   * Revoke all sessions for a device.
   * @param deviceId - Device to revoke all sessions for
   */
  revokeAllSessions(deviceId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.deviceId === deviceId) {
        this.sessions.delete(token);
      }
    }
  }

  /**
   * Cleanup expired sessions.
   * @returns Number of sessions cleaned up
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let count = 0;
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }

  /**
   * Check if token needs rotation.
   * @param token - Token to check
   * @returns True if the token has passed its rotation time
   */
  needsRotation(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) return false;
    return Date.now() > session.rotationAt;
  }
}
