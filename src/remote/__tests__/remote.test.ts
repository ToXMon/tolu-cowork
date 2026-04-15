/**
 * @tolu/cowork-core — Remote access module tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nacl from 'tweetnacl';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { QRPairingManager } from '../qr-pairing.js';
import { PairingError } from '../errors.js';
import { SessionManager } from '../session-manager.js';
import { SessionError } from '../errors.js';
import { DeviceTrustManager } from '../device-trust.js';
import { DeviceTrustError } from '../errors.js';
import { SecureCredentialStore } from '../credential-store.js';
import { CredentialStoreError } from '../errors.js';

describe('QRPairingManager', () => {
  let manager: QRPairingManager;

  beforeEach(() => {
    manager = new QRPairingManager();
  });

  it('should generate a valid pairing code', () => {
    const code = manager.generatePairingCode();
    expect(code.code).toHaveLength(10);
    expect(code.used).toBe(false);
    expect(code.deviceId).toBeNull();
    expect(code.expiresAt).toBeGreaterThan(Date.now());
  });

  it('should validate a valid code', () => {
    const code = manager.generatePairingCode();
    const result = manager.validatePairingCode(code.code);
    expect(result.valid).toBe(true);
  });

  it('should reject an invalid code', () => {
    const result = manager.validatePairingCode('nonexistent');
    expect(result.valid).toBe(false);
  });

  it('should reject an expired code', () => {
    vi.useFakeTimers();
    const code = manager.generatePairingCode();
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes
    const result = manager.validatePairingCode(code.code);
    expect(result.valid).toBe(false);
    vi.useRealTimers();
  });

  it('should complete pairing and create device', () => {
    const code = manager.generatePairingCode();
    const session = manager.completePairing(code.code, {
      deviceId: 'device-1',
      name: 'My Phone',
      fingerprint: 'abc123',
    });

    expect(session.token).toHaveLength(128); // 64 bytes hex
    expect(session.deviceId).toBe('device-1');
    expect(session.scope).toContain('pair');

    const devices = manager.listPairedDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe('My Phone');
  });

  it('should enforce single-use codes', () => {
    const code = manager.generatePairingCode();
    manager.completePairing(code.code, {
      deviceId: 'device-1',
      name: 'Phone',
      fingerprint: 'fp1',
    });

    expect(() =>
      manager.completePairing(code.code, {
        deviceId: 'device-2',
        name: 'Other',
        fingerprint: 'fp2',
      }),
    ).toThrow(PairingError);
  });

  it('should revoke a paired device', () => {
    const code = manager.generatePairingCode();
    manager.completePairing(code.code, {
      deviceId: 'device-1',
      name: 'Phone',
      fingerprint: 'fp1',
    });

    manager.revokePairing('device-1');
    expect(manager.listPairedDevices()).toHaveLength(0);
  });

  it('should enforce rate limits', () => {
    expect(manager.checkRateLimit('192.168.1.1')).toBe(true);
    expect(manager.checkRateLimit('192.168.1.1')).toBe(true);
    expect(manager.checkRateLimit('192.168.1.1')).toBe(true);
    expect(manager.checkRateLimit('192.168.1.1')).toBe(true);
    expect(manager.checkRateLimit('192.168.1.1')).toBe(true);
    expect(manager.checkRateLimit('192.168.1.1')).toBe(false); // 6th attempt blocked
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('should create a session', () => {
    const session = manager.createSession('device-1');
    expect(session.token).toHaveLength(128);
    expect(session.deviceId).toBe('device-1');
    expect(session.scope).toEqual(['default']);
  });

  it('should validate a valid token', () => {
    const session = manager.createSession('device-1');
    const result = manager.validateToken(session.token);
    expect(result.valid).toBe(true);
    expect(result.session?.deviceId).toBe('device-1');
  });

  it('should reject an invalid token', () => {
    const result = manager.validateToken('nonexistent-token');
    expect(result.valid).toBe(false);
  });

  it('should reject an expired token', () => {
    vi.useFakeTimers();
    const session = manager.createSession('device-1');
    vi.advanceTimersByTime(25 * 3600 * 1000); // 25 hours
    const result = manager.validateToken(session.token);
    expect(result.valid).toBe(false);
    vi.useRealTimers();
  });

  it('should rotate a token', () => {
    const session = manager.createSession('device-1');
    const newSession = manager.rotateToken(session.token);

    expect(newSession.token).not.toBe(session.token);
    expect(newSession.deviceId).toBe('device-1');

    // Old token should be invalid
    expect(manager.validateToken(session.token).valid).toBe(false);
    // New token should be valid
    expect(manager.validateToken(newSession.token).valid).toBe(true);
  });

  it('should revoke a session', () => {
    const session = manager.createSession('device-1');
    manager.revokeSession(session.token);
    expect(manager.validateToken(session.token).valid).toBe(false);
  });

  it('should revoke all sessions for a device', () => {
    const s1 = manager.createSession('device-1');
    const s2 = manager.createSession('device-1');
    const s3 = manager.createSession('device-2');

    manager.revokeAllSessions('device-1');
    expect(manager.validateToken(s1.token).valid).toBe(false);
    expect(manager.validateToken(s2.token).valid).toBe(false);
    expect(manager.validateToken(s3.token).valid).toBe(true);
  });

  it('should detect when rotation is needed', () => {
    vi.useFakeTimers();
    const session = manager.createSession('device-1');
    expect(manager.needsRotation(session.token)).toBe(false);
    vi.advanceTimersByTime(2 * 3600 * 1000); // 2 hours
    expect(manager.needsRotation(session.token)).toBe(true);
    vi.useRealTimers();
  });

  it('should cleanup expired sessions', () => {
    vi.useFakeTimers();
    manager.createSession('device-1');
    manager.createSession('device-2');
    vi.advanceTimersByTime(25 * 3600 * 1000); // 25 hours
    const count = manager.cleanupExpiredSessions();
    expect(count).toBe(2);
    vi.useRealTimers();
  });
});

describe('DeviceTrustManager', () => {
  let trustManager: DeviceTrustManager;

  beforeEach(() => {
    trustManager = new DeviceTrustManager();
  });

  it('should register a new device', () => {
    const device = trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
    });
    expect(device.trustLevel).toBe('untrusted');
    expect(device.name).toBe('My Phone');
  });

  it('should challenge a device', () => {
    trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
    });

    const challenge = trustManager.challengeDevice('phone-1');
    expect(challenge.step).toBe('challenge');
    expect(challenge.challenge).toBeTruthy();
    expect(challenge.deviceId).toBe('phone-1');
  });

  it('should verify a challenge response without public key', () => {
    trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
    });

    const challenge = trustManager.challengeDevice('phone-1');
    const result = trustManager.verifyResponse('phone-1', {
      step: 'response',
      challenge: challenge.challenge,
      deviceId: 'phone-1',
    });

    expect(result.verified).toBe(true);
    expect(result.nextStep?.step).toBe('complete');
  });

  it('should verify a challenge response with Ed25519 signature', () => {
    const keyPair = nacl.sign.keyPair();
    const pubKeyBase64 = Buffer.from(keyPair.publicKey).toString('base64');

    trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
      publicKey: pubKeyBase64,
    });

    const challenge = trustManager.challengeDevice('phone-1');
    const challengeBytes = Uint8Array.from(Buffer.from(challenge.challenge!, 'base64'));
    const signature = nacl.sign.detached(challengeBytes, keyPair.secretKey);

    const result = trustManager.verifyResponse('phone-1', {
      step: 'response',
      challenge: challenge.challenge,
      signature: Buffer.from(signature).toString('base64'),
      deviceId: 'phone-1',
    });

    expect(result.verified).toBe(true);
  });

  it('should reject invalid challenge responses', () => {
    trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
    });

    const challenge = trustManager.challengeDevice('phone-1');
    const result = trustManager.verifyResponse('phone-1', {
      step: 'response',
      challenge: 'wrong-challenge',
      deviceId: 'phone-1',
    });

    expect(result.verified).toBe(false);
  });

  it('should not escalate trust without meeting thresholds', () => {
    trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
    });
    trustManager.updateTrustLevel('phone-1', 'paired');
    expect(trustManager.checkTrustEscalation('phone-1')).toBe(false);
  });

  it('should remove a device', () => {
    trustManager.registerDevice({
      deviceId: 'phone-1',
      name: 'My Phone',
      fingerprint: 'fp123',
    });
    trustManager.removeDevice('phone-1');
    expect(trustManager.getDevice('phone-1')).toBeUndefined();
  });

  it('should throw when challenging unknown device', () => {
    expect(() => trustManager.challengeDevice('unknown')).toThrow(DeviceTrustError);
  });
});

describe('SecureCredentialStore', () => {
  let store: SecureCredentialStore;
  let tmpDir: string;

  beforeEach(async () => {
    store = new SecureCredentialStore();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tolu-cred-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should initialize with a new store', async () => {
    await store.initialize(tmpDir, 'test-passphrase');
    const filePath = path.join(tmpDir, 'credentials.json');
    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    expect(data.version).toBe(1);
  });

  it('should store and retrieve credentials', async () => {
    await store.initialize(tmpDir, 'test-pass');
    await store.store('device-1', { apiKey: 'sk-abc123', region: 'us-east' });
    const creds = await store.retrieve('device-1');
    expect(creds.apiKey).toBe('sk-abc123');
    expect(creds.region).toBe('us-east');
  });

  it('should delete credentials', async () => {
    await store.initialize(tmpDir, 'test-pass');
    await store.store('device-1', { key: 'value' });
    await store.delete('device-1');
    await expect(store.retrieve('device-1')).rejects.toThrow(CredentialStoreError);
  });

  it('should reject wrong passphrase on existing store', async () => {
    await store.initialize(tmpDir, 'correct-pass');
    await store.store('device-1', { key: 'value' });

    const store2 = new SecureCredentialStore();
    await expect(store2.initialize(tmpDir, 'wrong-pass')).rejects.toThrow(CredentialStoreError);
  });

  it('should change passphrase and re-encrypt', async () => {
    await store.initialize(tmpDir, 'old-pass');
    await store.store('device-1', { secret: 'my-secret' });

    await store.changePassphrase('old-pass', 'new-pass');

    // Should still be able to retrieve
    const creds = await store.retrieve('device-1');
    expect(creds.secret).toBe('my-secret');

    // Re-open with new passphrase
    const store2 = new SecureCredentialStore();
    await store2.initialize(tmpDir, 'new-pass');
    const creds2 = await store2.retrieve('device-1');
    expect(creds2.secret).toBe('my-secret');
  });

  it('should reject operations before initialization', async () => {
    const uninitStore = new SecureCredentialStore();
    await expect(uninitStore.store('x', {})).rejects.toThrow(CredentialStoreError);
    await expect(uninitStore.retrieve('x')).rejects.toThrow(CredentialStoreError);
  });

  it('should persist credentials across reinitialization', async () => {
    await store.initialize(tmpDir, 'pass');
    await store.store('dev-1', { token: 'abc' });

    const store2 = new SecureCredentialStore();
    await store2.initialize(tmpDir, 'pass');
    const creds = await store2.retrieve('dev-1');
    expect(creds.token).toBe('abc');
  });
});
