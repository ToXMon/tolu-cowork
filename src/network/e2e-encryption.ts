/**
 * @tolu/cowork-core — End-to-end encryption using NaCl (tweetnacl)
 *
 * Implements the Lunel-inspired E2E handshake pattern:
 * 1. Key exchange via NaCl box keypairs
 * 2. Shared secret derivation via nacl.box.before
 * 3. HKDF-SHA256 to derive separate rx/tx symmetric keys
 * 4. Message encryption via nacl.secretbox
 */

import nacl from 'tweetnacl';
import { createHmac, randomBytes } from 'node:crypto';
import type { E2ESession, E2EMessage } from './types.js';
import { E2EEncryptionError } from './errors.js';

/** Salt used for HKDF extract phase. */
const HKDF_SALT = 'tolu-cowork-e2e';

/** HKDF extract: PRK = HMAC-SHA256(salt, inputKeyingMaterial). */
function hkdfExtract(ikm: Uint8Array, salt: string): Buffer {
  return createHmac('sha256', salt).update(ikm).digest();
}

/** HKDF expand: OKM = HMAC-SHA256(PRK, info || 0x01) for single-block output. */
function hkdfExpand(prk: Buffer, info: string): Buffer {
  const infoBuf = Buffer.from(info);
  const oneByte = Buffer.from([0x01]);
  return createHmac('sha256', prk)
    .update(Buffer.concat([infoBuf, oneByte]))
    .digest();
}

/**
 * Derive rx and tx keys from a shared secret using HKDF-SHA256.
 * Client: rx = 'tolu-cowork-rx', tx = 'tolu-cowork-tx'
 * Server: rx = 'tolu-cowork-tx', tx = 'tolu-cowork-rx' (swapped)
 */
function deriveKeys(
  sharedSecret: Uint8Array,
  role: 'client' | 'server',
): { rxKey: Uint8Array; txKey: Uint8Array } {
  const prk = hkdfExtract(sharedSecret, HKDF_SALT);
  const rxInfo = role === 'client' ? 'tolu-cowork-rx' : 'tolu-cowork-tx';
  const txInfo = role === 'client' ? 'tolu-cowork-tx' : 'tolu-cowork-rx';
  return {
    rxKey: new Uint8Array(hkdfExpand(prk, rxInfo)),
    txKey: new Uint8Array(hkdfExpand(prk, txInfo)),
  };
}

/** Zero out a Uint8Array contents for secure cleanup. */
function zeroOut(arr: Uint8Array): void {
  arr.fill(0);
}

/**
 * Manages E2E encrypted sessions using NaCl box keypairs and secretbox.
 *
 * Handshake flow:
 * - Client calls createSession() → sends public key to server
 * - Server calls handleClientHello(clientPub) → sends its public key back
 * - Client calls completeHandshake(sessionId, serverPub) → derives rx/tx keys
 * - Both sides now encrypt/decrypt with derived symmetric keys
 */
export class E2EEncryption {
  private sessions: Map<string, E2ESession> = new Map();
  private readonly SESSION_TTL = 3600_000; // 1 hour
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60_000);
  }

  /**
   * Generate a new NaCl box keypair.
   * @returns Ed25519 keypair suitable for box operations
   */
  generateKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array } {
    const kp = nacl.box.keyPair();
    return { publicKey: kp.publicKey, privateKey: kp.secretKey };
  }

  /**
   * Create a new E2E session (client-side).
   * Generates a keypair and starts an unestablished session.
   * @returns New E2E session awaiting server's public key
   */
  createSession(): E2ESession {
    const kp = this.generateKeyPair();
    const sessionId = randomBytes(32).toString('hex');
    const now = Date.now();
    const session: E2ESession = {
      sessionId,
      localPublicKey: kp.publicKey,
      localPrivateKey: kp.privateKey,
      remotePublicKey: null,
      rxKey: null,
      txKey: null,
      established: false,
      role: 'client',
      createdAt: now,
      expiresAt: now + this.SESSION_TTL,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Handle incoming client hello (server-side).
   * Creates a server session and derives keys immediately.
   * @param clientPublicKey - Client's NaCl box public key
   * @returns Server-side E2E session with derived keys
   */
  handleClientHello(clientPublicKey: Uint8Array): E2ESession {
    const kp = this.generateKeyPair();
    const sessionId = randomBytes(32).toString('hex');
    const now = Date.now();

    const sharedSecret = nacl.box.before(clientPublicKey, kp.privateKey);
    const { rxKey, txKey } = deriveKeys(sharedSecret, 'server');

    const session: E2ESession = {
      sessionId,
      localPublicKey: kp.publicKey,
      localPrivateKey: kp.privateKey,
      remotePublicKey: clientPublicKey,
      rxKey,
      txKey,
      established: true,
      role: 'server',
      createdAt: now,
      expiresAt: now + this.SESSION_TTL,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Complete handshake with server's public key (client-side).
   * Derives rx/tx keys using HKDF-SHA256.
   * @param sessionId - Client session to complete
   * @param remotePublicKey - Server's NaCl box public key
   * @throws {E2EEncryptionError} If session not found or already established
   */
  completeHandshake(sessionId: string, remotePublicKey: Uint8Array): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new E2EEncryptionError(`Session not found: ${sessionId}`);
    }
    if (session.established) {
      throw new E2EEncryptionError(`Session already established: ${sessionId}`);
    }
    if (session.role !== 'client') {
      throw new E2EEncryptionError('completeHandshake is for client-side only');
    }

    const sharedSecret = nacl.box.before(remotePublicKey, session.localPrivateKey);
    const { rxKey, txKey } = deriveKeys(sharedSecret, 'client');

    session.remotePublicKey = remotePublicKey;
    session.rxKey = rxKey;
    session.txKey = txKey;
    session.established = true;
  }

  /**
   * Encrypt a message for a session using nacl.secretbox.
   * @param sessionId - Established session ID
   * @param plaintext - Raw message bytes to encrypt
   * @returns Encrypted message with nonce
   * @throws {E2EEncryptionError} If session not found or not established
   */
  encrypt(sessionId: string, plaintext: Uint8Array): E2EMessage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new E2EEncryptionError(`Session not found: ${sessionId}`);
    }
    if (!session.established || !session.txKey) {
      throw new E2EEncryptionError(`Session not established: ${sessionId}`);
    }

    const nonce = randomBytes(nacl.secretbox.nonceLength);
    const ciphertext = nacl.secretbox(plaintext, nonce, session.txKey);
    if (!ciphertext) {
      throw new E2EEncryptionError('Encryption failed');
    }
    return { nonce, ciphertext };
  }

  /**
   * Decrypt a message for a session using nacl.secretbox.open.
   * @param sessionId - Established session ID
   * @param message - Encrypted message with nonce
   * @returns Decrypted plaintext bytes
   * @throws {E2EEncryptionError} If session not found, not established, or decryption fails
   */
  decrypt(sessionId: string, message: E2EMessage): Uint8Array {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new E2EEncryptionError(`Session not found: ${sessionId}`);
    }
    if (!session.established || !session.rxKey) {
      throw new E2EEncryptionError(`Session not established: ${sessionId}`);
    }

    const plaintext = nacl.secretbox.open(
      message.ciphertext,
      message.nonce,
      session.rxKey,
    );
    if (!plaintext) {
      throw new E2EEncryptionError('Decryption failed — invalid ciphertext or nonce');
    }
    return plaintext;
  }

  /**
   * Destroy a session and zero out all key material.
   * @param sessionId - Session to destroy
   */
  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    zeroOut(session.localPrivateKey);
    if (session.rxKey) zeroOut(session.rxKey);
    if (session.txKey) zeroOut(session.txKey);
    this.sessions.delete(sessionId);
  }

  /**
   * Get session info (without private key material).
   * @param sessionId - Session to look up
   * @returns Session object or undefined
   */
  getSession(sessionId: string): E2ESession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all active session IDs.
   * @returns Array of session IDs
   */
  listSessions(): string[] {
    return [...this.sessions.keys()];
  }

  /** Clean up expired sessions. */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.destroySession(id);
      }
    }
  }

  /** Destroy all sessions and stop cleanup interval. */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    for (const id of this.sessions.keys()) {
      this.destroySession(id);
    }
  }
}
