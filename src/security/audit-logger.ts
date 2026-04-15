/**
 * @tolu/cowork-core — Audit Logger
 *
 * Persistent audit logging for security-relevant events.
 * Stores entries in JSONL format with query, export, and prune support.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AuditLogEntry } from "./types.js";
import { RequestResponseSanitizer } from "./sanitizer.js";

/** Default directory for Tolu configuration and data. */
const TOLU_DIR = ".tolu";

/** Default audit log filename. */
const AUDIT_LOG_FILE = "audit.log";

/** CSV column headers for export. */
const CSV_HEADERS = [
  "id",
  "timestamp",
  "actor",
  "action",
  "resource",
  "result",
  "sandboxLevel",
  "sourceIp",
  "details",
] as const;

/**
 * Escapes a value for safe inclusion in a CSV file.
 *
 * @param value - The value to escape.
 * @returns The CSV-safe string.
 */
function csvEscape(value: string | undefined): string {
  if (value === undefined) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Persistent audit logger for security events.
 *
 * Writes entries to a JSONL file (one JSON object per line) for
 * efficient append operations. Supports querying by field values,
 * exporting to JSON or CSV, and pruning old entries.
 */
export class AuditLogger {
  private readonly logFile: string;
  private readonly toluDir: string;
  private readonly sanitizer: RequestResponseSanitizer;

  /**
   * Creates a new AuditLogger instance.
   *
   * @param baseDir - Optional base directory override (defaults to ~/.tolu).
   */
  constructor(baseDir?: string) {
    this.toluDir = baseDir ?? join(homedir(), TOLU_DIR);
    this.logFile = join(this.toluDir, AUDIT_LOG_FILE);
    this.sanitizer = new RequestResponseSanitizer();
  }

  /**
   * Writes a new audit log entry to the log file.
   *
   * @param entry - Partial audit log entry (id and timestamp are auto-generated).
   * @throws {Error} If writing to the log file fails.
   */
  async log(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
    await mkdir(this.toluDir, { recursive: true });

    const fullEntry: AuditLogEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      sandboxLevel: entry.sandboxLevel,
      details: entry.details
        ? (this.sanitizer.sanitizeForLogging(entry.details) as string)
        : undefined,
      sourceIp: entry.sourceIp,
    };

    const line = JSON.stringify(fullEntry) + "\n";
    await appendFile(this.logFile, line, { encoding: "utf8" });
  }

  /**
   * Queries audit log entries matching the given filters.
   *
   * All filter fields are optional. Only entries where all provided
   * filter fields match (exact equality) are returned.
   *
   * @param filters - Partial fields to match against.
   * @param limit - Maximum number of entries to return (default 100).
   * @returns Array of matching audit log entries, newest first.
   */
  async query(
    filters: Partial<AuditLogEntry>,
    limit = 100,
  ): Promise<AuditLogEntry[]> {
    const entries = await this.readAllEntries();
    const filterKeys = Object.keys(filters) as Array<keyof AuditLogEntry>;

    const matched = entries.filter((entry) =>
      filterKeys.every((key) => {
        const filterVal = filters[key];
        const entryVal = entry[key];
        if (filterVal === undefined) return true;
        return entryVal === filterVal;
      }),
    );

    matched.sort((a, b) => b.timestamp - a.timestamp);
    return matched.slice(0, limit);
  }

  /**
   * Exports all audit log entries in the specified format.
   *
   * @param format - Export format: "json" for JSON array, "csv" for CSV with headers.
   * @returns Formatted string of all log entries.
   */
  async export(format: "json" | "csv"): Promise<string> {
    const entries = await this.readAllEntries();

    if (format === "json") {
      return JSON.stringify(entries, null, 2);
    }

    const headerLine = CSV_HEADERS.join(",");
    const dataLines = entries.map((entry) =>
      CSV_HEADERS.map((col) =>
        csvEscape(
          String(entry[col as keyof AuditLogEntry] ?? ""),
        ),
      ).join(","),
    );
    return [headerLine, ...dataLines].join("\n");
  }

  /**
   * Removes audit log entries older than the specified age.
   *
   * @param maxAge - Maximum age in milliseconds. Entries older than this are removed.
   * @returns The number of entries that were pruned.
   */
  async prune(maxAge: number): Promise<number> {
    const entries = await this.readAllEntries();
    const cutoff = Date.now() - maxAge;
    const kept = entries.filter((entry) => entry.timestamp >= cutoff);
    const prunedCount = entries.length - kept.length;

    if (prunedCount > 0) {
      await mkdir(this.toluDir, { recursive: true });
      const lines = kept.map((e) => JSON.stringify(e)).join("\n");
      if (lines.length > 0) {
        await writeFile(this.logFile, lines + "\n", { encoding: "utf8" });
      } else {
        try {
          await unlink(this.logFile);
        } catch {
          // File may not exist, which is fine
        }
      }
    }

    return prunedCount;
  }

  // ─── Internal Helpers ──────────────────────────────────────────────

  /**
   * Reads all entries from the JSONL log file.
   */
  private async readAllEntries(): Promise<AuditLogEntry[]> {
    try {
      const content = await readFile(this.logFile, "utf8");
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim().length > 0);
      return lines.map((line) => JSON.parse(line) as AuditLogEntry);
    } catch {
      return [];
    }
  }
}
