/**
 * @tolu/cowork-core — API Key Manager
 *
 * Manages storage, retrieval, rotation, and injection of
 * provider API keys with AES-256-GCM encryption.
 */

import { createCipheriv, createDecipheriv, randomUUID, scryptSync, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ApiKeyEntry } from "./types.js";
import { ApiKeyNotFoundError, ApiKeyRotationError, EncryptionError } from "./errors.js";

/** Algorithm used for key encryption. */
const CIPHER_ALGORITHM = "aes-256-gcm";

/** Length of the GCM authentication tag in bytes. */
const AUTH_TAG_LENGTH = 16;

/** Length of the initialization vector in bytes. */
const IV_LENGTH = 12;

/** Key derivation length in bytes (256 bits). */
const KEY_LENGTH = 32;

/** Default directory for Tolu configuration and data. */
const TOLU_DIR = ".tolu";

/** Mapping of provider names to their standard environment variable names. */
const PROVIDER_ENV_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cohere: "COHERE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
};

/**
 * Derives a 256-bit encryption key from a master secret using scrypt.
 *
 * @param secret - The master secret string.
 * @returns Derived key as a Buffer.
 * @throws {EncryptionError} If key derivation fails.
 */
function deriveKey(secret: string): Buffer {
  try {
    return scryptSync(secret, "tolu-cowork-salt", KEY_LENGTH);
  } catch (err) {
    throw new EncryptionError(
      `Failed to derive encryption key: ${err instanceof Error ? err.message : String(err)}`,
      "key-derivation",
    );
  }
}

/**
 * Encrypts plaintext using AES-256-GCM.
 *
 * @param plaintext - Data to encrypt.
 * @param key - Derived encryption key.
 * @returns Base64-encoded string containing IV + ciphertext + auth tag.
 * @throws {EncryptionError} If encryption fails.
 */
function encrypt(plaintext: string, key: Buffer): string {
  try {
    const iv = Buffer.alloc(IV_LENGTH);
    globalThis.crypto.getRandomValues(iv);
    const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, authTag]).toString("base64");
  } catch (err) {
    throw new EncryptionError(
      `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
      "encrypt",
    );
  }
}

/**
 * Decrypts AES-256-GCM encrypted data.
 *
 * @param encoded - Base64-encoded string containing IV + ciphertext + auth tag.
 * @param key - Derived encryption key.
 * @returns Decrypted plaintext string.
 * @throws {EncryptionError} If decryption or authentication fails.
 */
function decrypt(encoded: string, key: Buffer): string {
  try {
    const data = Buffer.from(encoded, "base64");
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch (err) {
    throw new EncryptionError(
      `Decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      "decrypt",
    );
  }
}

/**
 * Computes a SHA-256 hash of a raw API key for verification.
 *
 * @param rawKey - The plaintext API key.
 * @returns Hex-encoded SHA-256 hash.
 */
function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Manages API key lifecycle: storage, retrieval, rotation, and injection.
 *
 * Keys are encrypted at rest using AES-256-GCM with a master key
 * sourced from the TOLU_ENCRYPTION_KEY environment variable or
 * a generated key stored in ~/.tolu/master.key.
 */
export class ApiKeyManager {
  private readonly toluDir: string;
  private readonly keysFile: string;
  private readonly masterKeyFile: string;
  private readonly encryptionKey: Buffer;
  private keys: Map<string, ApiKeyEntry> = new Map();
  private loaded = false;

  /**
   * Creates a new ApiKeyManager instance.
   *
   * @param baseDir - Optional base directory override (defaults to ~/.tolu).
   */
  constructor(baseDir?: string) {
    this.toluDir = baseDir ?? join(homedir(), TOLU_DIR);
    this.keysFile = join(this.toluDir, "keys.json");
    this.masterKeyFile = join(this.toluDir, "master.key");
    this.encryptionKey = this.resolveMasterKey();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Encrypts and stores an API key for the given provider.
   *
   * @param provider - Provider name (e.g. "openai", "anthropic").
   * @param apiKey - The plaintext API key to store.
   * @returns The unique identifier assigned to this key entry.
   * @throws {EncryptionError} If key encryption fails.
   */
  async storeKey(provider: string, apiKey: string): Promise<string> {
    await this.ensureLoaded();
    const id = randomUUID();
    const keyEncrypted = encrypt(apiKey, this.encryptionKey);
    const keyHash = hashKey(apiKey);
    const entry: ApiKeyEntry = {
      id,
      provider,
      keyEncrypted,
      keyHash,
      createdAt: Date.now(),
    };
    this.keys.set(id, entry);
    await this.persist();
    return id;
  }

  /**
   * Decrypts and returns the API key with the given identifier.
   *
   * @param id - Unique identifier of the key entry.
   * @returns The decrypted plaintext API key.
   * @throws {ApiKeyNotFoundError} If no key with this id exists.
   * @throws {EncryptionError} If decryption fails.
   */
  async retrieveKey(id: string): Promise<string> {
    await this.ensureLoaded();
    const entry = this.keys.get(id);
    if (!entry) {
      throw new ApiKeyNotFoundError(`API key not found: ${id}`, id);
    }
    const rawKey = decrypt(entry.keyEncrypted, this.encryptionKey);
    entry.lastUsed = Date.now();
    await this.persist();
    return rawKey;
  }

  /**
   * Replaces an existing API key with a new one.
   *
   * @param id - Unique identifier of the key to rotate.
   * @param newKey - The new plaintext API key.
   * @throws {ApiKeyNotFoundError} If no key with this id exists.
   * @throws {ApiKeyRotationError} If rotation fails.
   */
  async rotateKey(id: string, newKey: string): Promise<void> {
    await this.ensureLoaded();
    const entry = this.keys.get(id);
    if (!entry) {
      throw new ApiKeyNotFoundError(`Cannot rotate: API key not found: ${id}`, id);
    }
    try {
      const keyEncrypted = encrypt(newKey, this.encryptionKey);
      const keyHash = hashKey(newKey);
      entry.keyEncrypted = keyEncrypted;
      entry.keyHash = keyHash;
      entry.createdAt = Date.now();
      entry.lastUsed = undefined;
      await this.persist();
    } catch (err) {
      throw new ApiKeyRotationError(
        `Failed to rotate key ${id}: ${err instanceof Error ? err.message : String(err)}`,
        id,
      );
    }
  }

  /**
   * Permanently removes an API key from storage.
   *
   * @param id - Unique identifier of the key to delete.
   * @throws {ApiKeyNotFoundError} If no key with this id exists.
   */
  async deleteKey(id: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.keys.has(id)) {
      throw new ApiKeyNotFoundError(`Cannot delete: API key not found: ${id}`, id);
    }
    this.keys.delete(id);
    await this.persist();
  }

  /**
   * Lists all stored key metadata without exposing actual key values.
   *
   * @returns Array of key metadata objects (id, provider, createdAt, lastUsed).
   */
  async listKeys(): Promise<
    Array<{ id: string; provider: string; createdAt: number; lastUsed?: number }>
  > {
    await this.ensureLoaded();
    return Array.from(this.keys.values()).map((entry) => ({
      id: entry.id,
      provider: entry.provider,
      createdAt: entry.createdAt,
      lastUsed: entry.lastUsed,
    }));
  }

  /**
   * Retrieves a key and returns it as an environment variable mapping.
   *
   * @param id - Unique identifier of the key entry.
   * @returns Record mapping the provider's env var name to the API key.
   * @throws {ApiKeyNotFoundError} If no key with this id exists.
   */
  async injectToEnv(id: string): Promise<Record<string, string>> {
    await this.ensureLoaded();
    const entry = this.keys.get(id);
    if (!entry) {
      throw new ApiKeyNotFoundError(`Cannot inject: API key not found: ${id}`, id);
    }
    const rawKey = decrypt(entry.keyEncrypted, this.encryptionKey);
    const envVar =
      PROVIDER_ENV_MAP[entry.provider] ?? `${entry.provider.toUpperCase()}_API_KEY`;
    entry.lastUsed = Date.now();
    await this.persist();
    return { [envVar]: rawKey };
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Resolves the master encryption key from environment or file.
   * Generates and persists a new key if neither source is available.
   */
  private resolveMasterKey(): Buffer {
    const envKey = process.env["TOLU_ENCRYPTION_KEY"];
    if (envKey) {
      return deriveKey(envKey);
    }

    if (existsSync(this.masterKeyFile)) {
      const stored = readFileSync(this.masterKeyFile, "utf8").trim();
      return deriveKey(stored);
    }

    const newKey = randomUUID() + randomUUID();
    mkdirSync(this.toluDir, { recursive: true });
    writeFileSync(this.masterKeyFile, newKey, { mode: 0o600 });
    return deriveKey(newKey);
  }

  /**
   * Ensures key data has been loaded from disk.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.keysFile, "utf8");
      const parsed: ApiKeyEntry[] = JSON.parse(raw);
      for (const entry of parsed) {
        this.keys.set(entry.id, entry);
      }
    } catch {
      this.keys = new Map();
    }
    this.loaded = true;
  }

  /**
   * Persists current key entries to disk.
   */
  private async persist(): Promise<void> {
    await mkdir(this.toluDir, { recursive: true });
    const entries = Array.from(this.keys.values());
    await writeFile(this.keysFile, JSON.stringify(entries, null, 2), {
      mode: 0o600,
    });
  }
}
