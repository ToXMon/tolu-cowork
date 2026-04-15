/**
 * @tolu/cowork-core — Security module tests
 *
 * Comprehensive test suite covering all security middleware components.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiKeyManager } from "../api-key-manager.js";
import { RateLimiter } from "../rate-limiter.js";
import { RequestResponseSanitizer } from "../sanitizer.js";
import { AuditLogger } from "../audit-logger.js";
import { PermissionSystem } from "../permission-system.js";
import {
  ApiKeyNotFoundError,
  SecurityError,
  EncryptionError,
  RateLimitExceededError,
  PermissionDeniedError,
  SanitizationError,
} from "../errors.js";

/** Creates a unique temp directory for each test. */
function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "tolu-security-test-"));
}

// ─── ApiKeyManager Tests ────────────────────────────────────────────────────

describe("ApiKeyManager", () => {
  let tempDir: string;
  let manager: ApiKeyManager;

  beforeEach(() => {
    tempDir = createTempDir();
    manager = new ApiKeyManager(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should store and retrieve a key", async () => {
    const id = await manager.storeKey("openai", "sk-test-key-1234567890");
    expect(id).toBeDefined();
    const retrieved = await manager.retrieveKey(id);
    expect(retrieved).toBe("sk-test-key-1234567890");
  });

  it("should list keys without exposing actual values", async () => {
    const id1 = await manager.storeKey("openai", "sk-test-key-111");
    const id2 = await manager.storeKey("anthropic", "sk-test-key-222");
    const keys = await manager.listKeys();
    expect(keys).toHaveLength(2);
    const ids = keys.map((k) => k.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    for (const key of keys) {
      expect(key).not.toHaveProperty("keyEncrypted");
      expect(key).not.toHaveProperty("keyHash");
    }
  });

  it("should delete a key", async () => {
    const id = await manager.storeKey("openai", "sk-test-key-to-delete");
    await manager.deleteKey(id);
    const keys = await manager.listKeys();
    expect(keys).toHaveLength(0);
  });

  it("should rotate a key", async () => {
    const id = await manager.storeKey("openai", "sk-old-key-12345");
    await manager.rotateKey(id, "sk-new-key-67890");
    const retrieved = await manager.retrieveKey(id);
    expect(retrieved).toBe("sk-new-key-67890");
  });

  it("should encrypt and decrypt correctly (roundtrip)", async () => {
    const original = "sk-super-secret-api-key-with-special-chars!@#$%";
    const id = await manager.storeKey("openai", original);
    const decrypted = await manager.retrieveKey(id);
    expect(decrypted).toBe(original);
  });

  it("should throw ApiKeyNotFoundError for non-existent key", async () => {
    await expect(manager.retrieveKey("nonexistent-id")).rejects.toThrow(
      ApiKeyNotFoundError,
    );
  });

  it("should inject key as correct env variable mapping", async () => {
    const id = await manager.storeKey("openai", "sk-test-inject-key");
    const env = await manager.injectToEnv(id);
    expect(env).toHaveProperty("OPENAI_API_KEY", "sk-test-inject-key");
  });

  it("should inject anthropic key with correct env name", async () => {
    const id = await manager.storeKey("anthropic", "ant-key-12345");
    const env = await manager.injectToEnv(id);
    expect(env).toHaveProperty("ANTHROPIC_API_KEY", "ant-key-12345");
  });

  it("should inject unknown provider with generic env name", async () => {
    const id = await manager.storeKey("custom-provider", "custom-key-xyz");
    const env = await manager.injectToEnv(id);
    expect(env).toHaveProperty("CUSTOM-PROVIDER_API_KEY", "custom-key-xyz");
  });
});

// ─── RateLimiter Tests ──────────────────────────────────────────────────────

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  it("should allow requests within limit", () => {
    const policy = { windowMs: 60000, maxRequests: 5 };
    limiter.configureProvider("test", policy);
    for (let i = 0; i < 5; i++) {
      const result = limiter.checkLimit("test");
      expect(result.allowed).toBe(true);
    }
  });

  it("should deny requests over limit", () => {
    const policy = { windowMs: 60000, maxRequests: 3 };
    limiter.configureProvider("test", policy);
    for (let i = 0; i < 3; i++) {
      limiter.checkLimit("test");
    }
    const result = limiter.checkLimit("test");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should reset sliding window", () => {
    const policy = { windowMs: 100, maxRequests: 2 };
    limiter.configureProvider("test", policy);
    limiter.checkLimit("test");
    limiter.checkLimit("test");
    expect(limiter.checkLimit("test").allowed).toBe(false);
    limiter.reset("test");
    const result = limiter.checkLimit("test");
    expect(result.allowed).toBe(true);
  });

  it("should support burst allowance", () => {
    const policy = { windowMs: 60000, maxRequests: 2, burstAllowance: 3 };
    limiter.configureProvider("test", policy);
    for (let i = 0; i < 5; i++) {
      const result = limiter.checkLimit("test");
      expect(result.allowed).toBe(true);
    }
    const result = limiter.checkLimit("test");
    expect(result.allowed).toBe(false);
  });

  it("should track different clients independently", () => {
    const policy = { windowMs: 60000, maxRequests: 2 };
    limiter.configureProvider("test", policy);
    limiter.checkLimit("test", "client-a");
    limiter.checkLimit("test", "client-a");
    expect(limiter.checkLimit("test", "client-a").allowed).toBe(false);
    expect(limiter.checkLimit("test", "client-b").allowed).toBe(true);
  });
});

// ─── Sanitizer Tests ────────────────────────────────────────────────────────

describe("RequestResponseSanitizer", () => {
  let sanitizer: RequestResponseSanitizer;

  beforeEach(() => {
    sanitizer = new RequestResponseSanitizer();
  });

  it("should strip API key patterns (sk-)", () => {
    const input = { message: "My key is sk-abcdefghij1234567890klmnop" };
    const result = sanitizer.sanitizeRequest(input);
    expect((result as Record<string, unknown>).message).toBe("My key is [REDACTED]");
  });

  it("should strip API key patterns (key-)", () => {
    const input = { data: "key-abcdefghij1234567890qrstuv" };
    const result = sanitizer.sanitizeResponse(input);
    expect((result as Record<string, unknown>).data).toBe("[REDACTED]");
  });

  it("should strip Bearer tokens", () => {
    const input = { auth: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature" };
    const result = sanitizer.sanitizeRequest(input);
    expect((result as Record<string, unknown>).auth).toBe("Bearer [REDACTED]");
  });

  it("should strip private IP addresses", () => {
    const input = { host: "10.0.0.1", loopback: "127.0.0.1", lan: "192.168.1.100" };
    const result = sanitizer.sanitizeResponse(input);
    const obj = result as Record<string, unknown>;
    expect(obj.host).toBe("[REDACTED]");
    expect(obj.loopback).toBe("[REDACTED]");
    expect(obj.lan).toBe("[REDACTED]");
  });

  it("should strip 172.16-31.x.x private IPs", () => {
    const input = { ip: "172.20.5.30" };
    const result = sanitizer.sanitizeRequest(input);
    expect((result as Record<string, unknown>).ip).toBe("[REDACTED]");
  });

  it("should strip file paths containing /home/", () => {
    const input = { path: "/home/user/secret/file.txt" };
    const result = sanitizer.sanitizeResponse(input);
    expect((result as Record<string, unknown>).path).toBe("[REDACTED]");
  });

  it("should strip file paths containing /Users/", () => {
    const input = { path: "/Users/john/.ssh/id_rsa" };
    const result = sanitizer.sanitizeResponse(input);
    expect((result as Record<string, unknown>).path).toBe("[REDACTED]");
  });

  it("should deep sanitize nested objects", () => {
    const input = {
      level1: {
        level2: {
          key: "sk-abcdefghijklmnopqrstuvwx123456",
          safe: "hello world",
        },
        items: ["Bearer token123abc", "normal text"],
      },
    };
    const result = sanitizer.sanitizeForLogging(input) as Record<string, unknown>;
    const l1 = result.level1 as Record<string, unknown>;
    const l2 = l1.level2 as Record<string, unknown>;
    expect(l2.key).toBe("[REDACTED]");
    expect(l2.safe).toBe("hello world");
    const items = l1.items as string[];
    expect(items[0]).toBe("Bearer [REDACTED]");
    expect(items[1]).toBe("normal text");
  });

  it("should support custom rules", () => {
    sanitizer.addRule({
      pattern: /\b\d{16}\b/g,
      replacement: "[CARD-REDACTED]",
      description: "Credit card numbers",
    });
    const input = { card: "1234567890123456" };
    const result = sanitizer.sanitizeRequest(input);
    expect((result as Record<string, unknown>).card).toBe("[CARD-REDACTED]");
  });

  it("should preserve numbers and booleans", () => {
    const input = { count: 42, active: true, name: "test" };
    const result = sanitizer.sanitizeForLogging(input) as Record<string, unknown>;
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.name).toBe("test");
  });
});

// ─── AuditLogger Tests ──────────────────────────────────────────────────────

describe("AuditLogger", () => {
  let tempDir: string;
  let logger: AuditLogger;

  beforeEach(() => {
    tempDir = createTempDir();
    logger = new AuditLogger(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should write and query entries", async () => {
    await logger.log({
      actor: "user-1",
      action: "tool.execute",
      resource: "bash",
      result: "success",
      sandboxLevel: "docker",
    });
    await logger.log({
      actor: "user-2",
      action: "key.retrieve",
      resource: "openai",
      result: "denied",
      sandboxLevel: "none",
    });
    const entries = await logger.query({ actor: "user-1" });
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe("user-1");
    expect(entries[0].action).toBe("tool.execute");
    expect(entries[0].result).toBe("success");
  });

  it("should query with multiple filters", async () => {
    await logger.log({
      actor: "user-1",
      action: "tool.execute",
      resource: "bash",
      result: "success",
      sandboxLevel: "docker",
    });
    await logger.log({
      actor: "user-1",
      action: "tool.execute",
      resource: "bash",
      result: "error",
      sandboxLevel: "docker",
    });
    const entries = await logger.query({ actor: "user-1", result: "success" });
    expect(entries).toHaveLength(1);
    expect(entries[0].result).toBe("success");
  });

  it("should export to CSV", async () => {
    await logger.log({
      actor: "user-1",
      action: "test.action",
      resource: "test-resource",
      result: "success",
      sandboxLevel: "docker",
      sourceIp: "1.2.3.4",
    });
    const csv = await logger.export("csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,timestamp,actor,action,resource,result,sandboxLevel,sourceIp,details");
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("user-1");
    expect(lines[1]).toContain("test.action");
  });

  it("should export to JSON", async () => {
    await logger.log({
      actor: "user-1",
      action: "test",
      resource: "res",
      result: "success",
      sandboxLevel: "none",
    });
    const json = await logger.export("json");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].actor).toBe("user-1");
  });

  it("should prune old entries", async () => {
    await logger.log({
      actor: "old-user",
      action: "old-action",
      resource: "res",
      result: "success",
      sandboxLevel: "none",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await logger.log({
      actor: "new-user",
      action: "new-action",
      resource: "res",
      result: "success",
      sandboxLevel: "none",
    });
    const pruned = await logger.prune(40);
    expect(pruned).toBe(1);
    const remaining = await logger.query({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0].actor).toBe("new-user");
  });

  it("should assign UUID and timestamp to entries", async () => {
    await logger.log({
      actor: "user-1",
      action: "test",
      resource: "res",
      result: "success",
      sandboxLevel: "none",
    });
    const entries = await logger.query({});
    expect(entries[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });
});

// ─── PermissionSystem Tests ─────────────────────────────────────────────────

describe("PermissionSystem", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    PermissionSystem.resetInstance();
  });

  afterEach(() => {
    PermissionSystem.resetInstance();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should deny dangerous tools at none level by default", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    expect(ps.checkPermission("bash", "none")).toBe(false);
    expect(ps.checkPermission("write", "none")).toBe(false);
    expect(ps.checkPermission("delete", "none")).toBe(false);
  });

  it("should allow dangerous tools at docker level by default", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    expect(ps.checkPermission("bash", "docker")).toBe(true);
    expect(ps.checkPermission("write", "docker")).toBe(true);
    expect(ps.checkPermission("edit", "docker")).toBe(true);
  });

  it("should allow read-only tools at any level including none", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    expect(ps.checkPermission("read", "none")).toBe(true);
    expect(ps.checkPermission("read", "path-only")).toBe(true);
    expect(ps.checkPermission("read", "docker")).toBe(true);
    expect(ps.checkPermission("ls", "none")).toBe(true);
    expect(ps.checkPermission("grep", "none")).toBe(true);
  });

  it("should require docker for network tools", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    expect(ps.checkPermission("curl", "none")).toBe(false);
    expect(ps.checkPermission("curl", "path-only")).toBe(false);
    expect(ps.checkPermission("curl", "docker")).toBe(true);
    expect(ps.checkPermission("fetch", "docker")).toBe(true);
  });

  it("should grant and revoke permissions", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    ps.grantPermission("custom-tool", ["docker", "path-only"]);
    expect(ps.checkPermission("custom-tool", "docker")).toBe(true);
    expect(ps.checkPermission("custom-tool", "path-only")).toBe(true);
    expect(ps.checkPermission("custom-tool", "none")).toBe(false);
    ps.revokePermission("custom-tool");
    expect(ps.checkPermission("custom-tool", "docker")).toBe(false);
    expect(ps.getToolPermissions("custom-tool")).toEqual([]);
  });

  it("should return permissions for a tool", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    const perms = ps.getToolPermissions("bash");
    expect(perms).toContain("docker");
    expect(perms).toContain("path-only");
  });

  it("should return empty array for unknown tools", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    expect(ps.getToolPermissions("unknown-tool")).toEqual([]);
  });

  it("should deny unknown tools by default", () => {
    const ps = PermissionSystem.getInstance(tempDir);
    expect(ps.checkPermission("totally-unknown", "docker")).toBe(false);
  });
});

// ─── Error Hierarchy Tests ──────────────────────────────────────────────────

describe("Error classes", () => {
  it("should maintain proper inheritance chain", () => {
    const apiErr = new ApiKeyNotFoundError("test", "id-1");
    expect(apiErr).toBeInstanceOf(SecurityError);
    expect(apiErr).toBeInstanceOf(Error);
    expect(apiErr.name).toBe("ApiKeyNotFoundError");
    expect(apiErr.keyId).toBe("id-1");

    const encErr = new EncryptionError("test", "encrypt");
    expect(encErr).toBeInstanceOf(SecurityError);
    expect(encErr.operation).toBe("encrypt");

    const rateErr = new RateLimitExceededError("test", "openai", 12345);
    expect(rateErr).toBeInstanceOf(SecurityError);
    expect(rateErr.provider).toBe("openai");
    expect(rateErr.resetAt).toBe(12345);

    const permErr = new PermissionDeniedError("test", "bash", "none");
    expect(permErr).toBeInstanceOf(SecurityError);
    expect(permErr.toolName).toBe("bash");
    expect(permErr.sandboxLevel).toBe("none");

    const sanErr = new SanitizationError("test", "field-a");
    expect(sanErr).toBeInstanceOf(SecurityError);
    expect(sanErr.field).toBe("field-a");
  });
});
