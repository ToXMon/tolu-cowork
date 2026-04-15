/**
 * @tolu/cowork-core — Permission System
 *
 * Tool-level permission management with sandbox level restrictions.
 * Default policies enforce least-privilege for dangerous operations.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { PermissionSet } from "./types.js";

/** Default directory for Tolu configuration and data. */
const TOLU_DIR = ".tolu";

/** Default permissions filename. */
const PERMISSIONS_FILE = "permissions.json";

/**
 * Default permission set enforcing least-privilege.
 *
 * - Dangerous tools (bash, write, edit, delete, exec) require docker or path-only
 * - Read-only tools (read, ls, find, grep) can run at any level including none
 * - Network tools (curl, wget, fetch) require docker
 * - Config tools (config, settings) require path-only or docker
 */
const DEFAULT_PERMISSIONS: PermissionSet = {
  bash: ["docker", "path-only"],
  write: ["docker", "path-only"],
  edit: ["docker", "path-only"],
  delete: ["docker", "path-only"],
  exec: ["docker", "path-only"],
  read: ["none", "path-only", "docker"],
  ls: ["none", "path-only", "docker"],
  find: ["none", "path-only", "docker"],
  grep: ["none", "path-only", "docker"],
  curl: ["docker"],
  wget: ["docker"],
  fetch: ["docker"],
  config: ["path-only", "docker"],
  settings: ["path-only", "docker"],
};

/**
 * Manages tool execution permissions based on sandbox isolation levels.
 *
 * Implements a singleton pattern to ensure consistent permission
 * state across the application. Permissions are loaded from disk
 * on first access and persisted when modified.
 */
export class PermissionSystem {
  private static instance: PermissionSystem | null = null;

  private readonly toluDir: string;
  private readonly permissionsFile: string;
  private permissions: PermissionSet;
  private loaded = false;

  /**
   * Gets the singleton PermissionSystem instance.
   *
   * @param baseDir - Optional base directory override (only used on first call).
   * @returns The shared PermissionSystem instance.
   */
  static getInstance(baseDir?: string): PermissionSystem {
    if (!PermissionSystem.instance) {
      PermissionSystem.instance = new PermissionSystem(baseDir);
    }
    return PermissionSystem.instance;
  }

  /**
   * Resets the singleton instance (useful for testing).
   */
  static resetInstance(): void {
    PermissionSystem.instance = null;
  }

  /**
   * Creates a new PermissionSystem instance.
   *
   * @param baseDir - Optional base directory override (defaults to ~/.tolu).
   */
  private constructor(baseDir?: string) {
    this.toluDir = baseDir ?? join(homedir(), TOLU_DIR);
    this.permissionsFile = join(this.toluDir, PERMISSIONS_FILE);
    this.permissions = { ...DEFAULT_PERMISSIONS };
  }

  /**
   * Checks whether a tool is permitted to run at the given sandbox level.
   *
   * @param toolName - Name of the tool to check.
   * @param sandboxLevel - Sandbox isolation level.
   * @returns True if the tool is permitted at this level.
   */
  checkPermission(toolName: string, sandboxLevel: string): boolean {
    const allowed = this.permissions[toolName];
    if (!allowed) {
      // Unknown tools are denied by default
      return false;
    }
    return allowed.includes(sandboxLevel);
  }

  /**
   * Grants a tool permission to run at the specified sandbox levels.
   *
   * @param toolName - Name of the tool to configure.
   * @param levels - Array of allowed sandbox levels.
   */
  grantPermission(toolName: string, levels: string[]): void {
    this.permissions[toolName] = levels;
    this.saveSync();
  }

  /**
   * Revokes all permissions for a tool.
   *
   * @param toolName - Name of the tool to revoke.
   */
  revokePermission(toolName: string): void {
    delete this.permissions[toolName];
    this.saveSync();
  }

  /**
   * Gets the list of allowed sandbox levels for a tool.
   *
   * @param toolName - Name of the tool to query.
   * @returns Array of allowed sandbox levels, or empty array if not configured.
   */
  getToolPermissions(toolName: string): string[] {
    return this.permissions[toolName] ?? [];
  }

  /**
   * Loads permissions from disk, merging with defaults.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.permissionsFile, "utf8");
      const stored = JSON.parse(raw) as PermissionSet;
      this.permissions = { ...DEFAULT_PERMISSIONS, ...stored };
    } catch {
      this.permissions = { ...DEFAULT_PERMISSIONS };
    }
    this.loaded = true;
  }

  /**
   * Saves current permissions to disk.
   */
  async save(): Promise<void> {
    await mkdir(this.toluDir, { recursive: true });
    await writeFile(
      this.permissionsFile,
      JSON.stringify(this.permissions, null, 2),
      { mode: 0o600 },
    );
  }

  /**
   * Synchronous save for use in non-async contexts.
   */
  private saveSync(): void {
    try {
      mkdirSync(this.toluDir, { recursive: true });
      writeFileSync(
        this.permissionsFile,
        JSON.stringify(this.permissions, null, 2),
        { mode: 0o600 },
      );
    } catch {
      // Silently fail - permissions will be in memory only
    }
  }
}
