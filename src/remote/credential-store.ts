/**
 * @tolu/cowork-core — Secure credential store
 *
 * Stores device credentials encrypted at rest using AES-256-GCM.
 * Key derivation via scrypt. Supports passphrase changes with re-encryption.
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CredentialEntry } from './types.js';
import { CredentialStoreError } from './errors.js';

/** Encrypted blob structure stored on disk. */
interface EncryptedBlob {
  salt: string;
  iv: string;
  authTag: string;
  data: string;
}

/** On-disk store format. */
interface StoreFile {
  version: number;
  entries: Record<string, EncryptedBlob>;
}

const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const STORE_VERSION = 1;

/**
 * Secure credential store with AES-256-GCM encryption at rest.
 * Credentials are encrypted per-entry using a key derived from a passphrase
 * via scrypt. Supports passphrase rotation with full re-encryption.
 */
export class SecureCredentialStore {
  private storePath: string;
  private passphrase: string | null = null;
  private cache: Map<string, CredentialEntry> = new Map();

  constructor() {
    this.storePath = '';
  }

  /**
   * Initialize the store with a passphrase.
   * Creates directory if needed. If store exists, validates passphrase.
   * @param storePath - Directory path for the credential store
   * @param passphrase - Master passphrase for encryption
   * @throws {CredentialStoreError} If passphrase doesn't match existing store
   */
  async initialize(storePath: string, passphrase: string): Promise<void> {
    this.storePath = storePath;
    this.passphrase = passphrase;

    await fs.mkdir(storePath, { recursive: true });

    const filePath = path.join(storePath, 'credentials.json');
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const store: StoreFile = JSON.parse(data);

      // Validate passphrase by trying to decrypt an entry
      if (store.entries && Object.keys(store.entries).length > 0) {
        const firstKey = Object.keys(store.entries)[0]!;
        try {
          this.decryptEntry(store.entries[firstKey]!, passphrase);
        } catch {
          throw new CredentialStoreError('Invalid passphrase');
        }
      }

      // Load cache
      for (const [deviceId, blob] of Object.entries(store.entries)) {
        try {
          const decrypted = this.decryptEntry(blob, passphrase);
          this.cache.set(deviceId, decrypted);
        } catch {
          // Skip entries that can't be decrypted
        }
      }
    } catch (e) {
      if (e instanceof CredentialStoreError) throw e;
      // File doesn't exist yet — create empty store
      const emptyStore: StoreFile = { version: STORE_VERSION, entries: {} };
      await fs.writeFile(filePath, JSON.stringify(emptyStore, null, 2), 'utf-8');
    }
  }

  /**
   * Store credentials for a device.
   * @param deviceId - Device to store credentials for
   * @param credentials - Key-value credential pairs
   * @throws {CredentialStoreError} If store not initialized
   */
  async store(deviceId: string, credentials: Record<string, string>): Promise<void> {
    this.ensureInitialized();

    const entry: CredentialEntry = {
      deviceId,
      credentials,
      updatedAt: Date.now(),
    };
    this.cache.set(deviceId, entry);
    await this.persist();
  }

  /**
   * Retrieve credentials for a device.
   * @param deviceId - Device to retrieve credentials for
   * @returns Credential key-value pairs
   * @throws {CredentialStoreError} If store not initialized or device not found
   */
  async retrieve(deviceId: string): Promise<Record<string, string>> {
    this.ensureInitialized();

    const entry = this.cache.get(deviceId);
    if (!entry) {
      throw new CredentialStoreError(`No credentials found for device: ${deviceId}`);
    }
    return { ...entry.credentials };
  }

  /**
   * Delete credentials for a device.
   * @param deviceId - Device to delete credentials for
   */
  async delete(deviceId: string): Promise<void> {
    this.ensureInitialized();

    if (!this.cache.has(deviceId)) {
      throw new CredentialStoreError(`No credentials found for device: ${deviceId}`);
    }
    this.cache.delete(deviceId);
    await this.persist();
  }

  /**
   * Change the passphrase (re-encrypt everything).
   * @param oldPass - Current passphrase
   * @param newPass - New passphrase
   * @throws {CredentialStoreError} If old passphrase is incorrect
   */
  async changePassphrase(oldPass: string, newPass: string): Promise<void> {
    this.ensureInitialized();

    if (oldPass !== this.passphrase) {
      throw new CredentialStoreError('Current passphrase is incorrect');
    }

    this.passphrase = newPass;
    await this.persist();
  }

  /** Throw if not initialized. */
  private ensureInitialized(): void {
    if (!this.passphrase || !this.storePath) {
      throw new CredentialStoreError('Credential store not initialized');
    }
  }

  /** Persist cache to disk with encryption. */
  private async persist(): Promise<void> {
    const filePath = path.join(this.storePath, 'credentials.json');
    const entries: Record<string, EncryptedBlob> = {};

    for (const [deviceId, entry] of this.cache) {
      entries[deviceId] = this.encryptEntry(
        JSON.stringify(entry),
        this.passphrase!,
      );
    }

    const store: StoreFile = { version: STORE_VERSION, entries };
    await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
  }

  /** Encrypt a string with AES-256-GCM. */
  private encryptEntry(plaintext: string, passphrase: string): EncryptedBlob {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = scryptSync(
      passphrase,
      salt,
      SCRYPT_KEY_LENGTH,
    );

    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted.toString('base64'),
    };
  }

  /** Decrypt an encrypted blob. */
  private decryptEntry(blob: EncryptedBlob, passphrase: string): CredentialEntry {
    const salt = Buffer.from(blob.salt, 'base64');
    const iv = Buffer.from(blob.iv, 'base64');
    const authTag = Buffer.from(blob.authTag, 'base64');
    const data = Buffer.from(blob.data, 'base64');

    const key = scryptSync(
      passphrase,
      salt,
      SCRYPT_KEY_LENGTH,
    );

    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf-8')) as CredentialEntry;
  }
}
