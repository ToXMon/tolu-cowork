/**
 * @tolu/cowork-core — Network security module tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { E2EEncryption } from '../e2e-encryption.js';
import { E2EEncryptionError } from '../errors.js';
import { TLSConfigurator } from '../tls-config.js';
import { TLSConfigError } from '../errors.js';
import { WebSocketSecurity } from '../websocket-security.js';
import { CertificatePinning } from '../cert-pinning.js';
import { CertificatePinError } from '../errors.js';

describe('E2EEncryption', () => {
  let encryption: E2EEncryption;

  afterEach(() => {
    encryption?.destroy();
  });

  it('should generate a valid NaCl keypair', () => {
    encryption = new E2EEncryption();
    const kp = encryption.generateKeyPair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });

  it('should create a client session', () => {
    encryption = new E2EEncryption();
    const session = encryption.createSession();
    expect(session.established).toBe(false);
    expect(session.role).toBe('client');
    expect(session.remotePublicKey).toBeNull();
    expect(session.rxKey).toBeNull();
    expect(session.txKey).toBeNull();
    expect(session.sessionId).toBeTruthy();
  });

  it('should perform full handshake and encrypt/decrypt round-trip', () => {
    const client = new E2EEncryption();
    const server = new E2EEncryption();

    // Client initiates
    const clientSession = client.createSession();

    // Server handles client hello
    const serverSession = server.handleClientHello(clientSession.localPublicKey);

    // Client completes handshake with server's public key
    client.completeHandshake(clientSession.sessionId, serverSession.localPublicKey);

    // Verify both sides are established
    expect(client.getSession(clientSession.sessionId)?.established).toBe(true);
    expect(serverSession.established).toBe(true);

    // Client encrypts → Server decrypts
    const plaintext = new TextEncoder().encode('Hello, E2E!');
    const encrypted = client.encrypt(clientSession.sessionId, plaintext);
    expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
    expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);

    const decrypted = server.decrypt(serverSession.sessionId, encrypted);
    expect(new TextDecoder().decode(decrypted)).toBe('Hello, E2E!');

    // Server encrypts → Client decrypts
    const serverMsg = new TextEncoder().encode('Server response');
    const serverEncrypted = server.encrypt(serverSession.sessionId, serverMsg);
    const clientDecrypted = client.decrypt(clientSession.sessionId, serverEncrypted);
    expect(new TextDecoder().decode(clientDecrypted)).toBe('Server response');

    client.destroy();
    server.destroy();
  });

  it('should destroy sessions and clear key material', () => {
    encryption = new E2EEncryption();
    const session = encryption.createSession();
    const sessionId = session.sessionId;
    // Keep direct reference to the private key buffer (not a copy)
    const privKeyRef = session.localPrivateKey;

    encryption.destroySession(sessionId);
    expect(encryption.getSession(sessionId)).toBeUndefined();
    // Private key should be zeroed in-place
    expect(privKeyRef.every((b) => b === 0)).toBe(true);
  });

  it('should reject operations on non-existent sessions', () => {
    encryption = new E2EEncryption();
    expect(() => encryption.encrypt('nonexistent', new Uint8Array(0))).toThrow(E2EEncryptionError);
    expect(() => encryption.decrypt('nonexistent', { nonce: new Uint8Array(24), ciphertext: new Uint8Array(0) })).toThrow(E2EEncryptionError);
    expect(() => encryption.completeHandshake('nonexistent', new Uint8Array(32))).toThrow(E2EEncryptionError);
  });
});

describe('TLSConfigurator', () => {
  it('should reject non-existent cert files', async () => {
    await expect(
      TLSConfigurator.validateCertificate('/nonexistent/path/cert.pem'),
    ).rejects.toThrow(TLSConfigError);
  });

  it('should generate a self-signed certificate', async () => {
    const { cert, key } = await TLSConfigurator.generateSelfSignedCert({
      commonName: 'test.local',
      days: 30,
    });
    expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(cert).toContain('-----END CERTIFICATE-----');
    expect(key).toContain('-----BEGIN');
    expect(key).toContain('PRIVATE KEY-----');
  });

  it('should validate a generated self-signed certificate', async () => {
    const { cert, key } = await TLSConfigurator.generateSelfSignedCert({
      commonName: 'validation.test',
    });

    // Write to temp file for validation
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tolu-tls-'));
    const certPath = path.join(tmpDir, 'cert.pem');
    await fs.writeFile(certPath, cert);

    const result = await TLSConfigurator.validateCertificate(certPath);
    expect(result.valid).toBe(true);
    expect(result.subject).toContain('validation.test');

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });
});

describe('WebSocketSecurity', () => {
  it('should validate connections with allowed origins', () => {
    const ws = new WebSocketSecurity();
    expect(
      ws.validateConnection({ headers: { origin: 'http://localhost:3000' } }),
    ).toBe(true);
  });

  it('should reject connections with disallowed origins', () => {
    const ws = new WebSocketSecurity();
    expect(
      ws.validateConnection({ headers: { origin: 'https://evil.com' } }),
    ).toBe(false);
  });

  it('should reject connections with no origin', () => {
    const ws = new WebSocketSecurity();
    expect(
      ws.validateConnection({ headers: {} }),
    ).toBe(false);
  });

  it('should enforce rate limits', () => {
    const ws = new WebSocketSecurity({ maxMessageRate: 3 });
    expect(ws.checkRateLimit('session-1')).toBe(true);
    expect(ws.checkRateLimit('session-1')).toBe(true);
    expect(ws.checkRateLimit('session-1')).toBe(true);
    expect(ws.checkRateLimit('session-1')).toBe(false); // 4th message exceeds limit
  });

  it('should validate frame sizes', () => {
    const ws = new WebSocketSecurity({ maxFrameSize: 100 });
    expect(ws.validateFrame(new ArrayBuffer(50))).toBe(true);
    expect(ws.validateFrame(new ArrayBuffer(150))).toBe(false);
  });

  it('should sanitize sensitive fields from messages', () => {
    const ws = new WebSocketSecurity();
    const result = ws.sanitizeMessage({
      user: 'alice',
      password: 'secret123',
      apiKey: 'sk-abcdef123456',
      data: { token: 'jwt-token-here', name: 'test' },
    }) as Record<string, unknown>;

    expect(result.user).toBe('alice');
    expect(result.password).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
  });
});

describe('CertificatePinning', () => {
  it('should validate global pins', () => {
    const pinning = new CertificatePinning();
    const pin = 'sha256/abc123def456';
    pinning.addPin(pin);
    expect(pinning.validateCertificate(pin)).toBe(true);
  });

  it('should reject unknown pins when enforced', () => {
    const pinning = new CertificatePinning(true);
    pinning.addPin('sha256/known-pin');
    expect(() => pinning.validateCertificate('sha256/unknown-pin')).toThrow(CertificatePinError);
  });

  it('should validate per-device pins', () => {
    const pinning = new CertificatePinning();
    const devicePin = 'sha256/device-specific';
    pinning.pinForDevice('phone-1', [devicePin]);
    expect(pinning.validateCertificate(devicePin, 'phone-1')).toBe(true);
  });

  it('should remove device pins', () => {
    const pinning = new CertificatePinning(true);
    const globalPin = 'sha256/global-pin';
    const devicePin = 'sha256/device-pin';
    pinning.addPin(globalPin);
    pinning.pinForDevice('phone-1', [devicePin]);
    pinning.removeDevicePins('phone-1');
    expect(() => pinning.validateCertificate(devicePin, 'phone-1')).toThrow(CertificatePinError);
  });

  it('should allow all certs when no pins configured', () => {
    const pinning = new CertificatePinning(true);
    expect(pinning.validateCertificate('sha256/anything')).toBe(true);
  });

  it('should not throw when enforcement is disabled', () => {
    const pinning = new CertificatePinning(false);
    pinning.addPin('sha256/known');
    expect(pinning.validateCertificate('sha256/unknown')).toBe(false);
    // Does not throw
  });
});
