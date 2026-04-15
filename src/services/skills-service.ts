/**
 * @tolu/cowork-core — SkillsService
 *
 * Loads and manages markdown skill files with YAML frontmatter.
 * Scans configured directories for `.md` files, parses metadata
 * from frontmatter, and provides search/retrieval for prompt injection.
 */

import { promises as fs } from 'node:fs';
import { resolve, basename } from 'node:path';
import YAML from 'yaml';
import { glob } from 'glob';
import { Logger } from '../utils/logger.js';

const logger = new Logger('skills-service');

// ─── Types ──────────────────────────────────────────────────────────────────

/** A parsed skill loaded from a markdown file. */
export interface Skill {
  /** Human-readable skill name (from frontmatter or filename). */
  name: string;
  /** Short description of what the skill does. */
  description: string;
  /** Raw markdown content (body after frontmatter). */
  content: string;
  /** Absolute path to the source `.md` file. */
  filePath: string;
  /** All frontmatter key-value pairs. */
  metadata: Record<string, string>;
  /** Epoch ms when this skill was loaded into memory. */
  loadedAt: number;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a skill file cannot be parsed. */
export class SkillLoadError extends Error {
  /** Path of the file that failed to load. */
  public readonly filePath: string;

  constructor(message: string, filePath: string) {
    super(message);
    this.name = 'SkillLoadError';
    this.filePath = filePath;
  }
}

/** Thrown when a requested skill is not found. */
export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`Skill not found: ${name}`);
    this.name = 'SkillNotFoundError';
  }
}

// ─── Frontmatter Parsing ────────────────────────────────────────────────────

/**
 * Extract YAML frontmatter and body from raw markdown.
 *
 * Frontmatter is delimited by `---` on its own line at the start of the file.
 *
 * @param raw - Raw markdown file content.
 * @returns Tuple of [frontmatter string, body string].
 */
function parseFrontmatter(raw: string): [string, string] {
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith('---')) {
    return ['', raw];
  }

  // Find the closing --- delimiter
  const closeIndex = trimmed.indexOf('\n---', 3);
  if (closeIndex === -1) {
    return ['', raw];
  }

  const frontmatter = trimmed.slice(3, closeIndex).trim();
  const body = trimmed.slice(closeIndex + 4).trimStart();

  return [frontmatter, body];
}

/**
 * Parse a single skill file into a Skill object.
 *
 * @param filePath - Absolute path to the `.md` file.
 * @returns Parsed Skill.
 */
async function parseSkillFile(filePath: string): Promise<Skill> {
  const resolved = resolve(filePath);
  let raw: string;

  try {
    raw = await fs.readFile(resolved, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SkillLoadError(`Failed to read skill file: ${message}`, resolved);
  }

  const [frontmatterRaw, body] = parseFrontmatter(raw);

  // Parse YAML frontmatter
  const parsed: Record<string, unknown> = frontmatterRaw.length > 0
    ? (YAML.parse(frontmatterRaw) as Record<string, unknown>) ?? {}
    : {};

  // Build metadata map (string values only)
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      metadata[key] = value;
    } else if (value !== null && value !== undefined) {
      metadata[key] = String(value);
    }
  }

  // Name: frontmatter > filename (without extension)
  const name = typeof parsed['name'] === 'string' && parsed['name'].length > 0
    ? parsed['name']
    : basename(resolved, '.md');

  // Description: frontmatter only
  const description = typeof parsed['description'] === 'string'
    ? parsed['description']
    : '';

  return {
    name,
    description,
    content: body,
    filePath: resolved,
    metadata,
    loadedAt: Date.now(),
  };
}

// ─── SkillsService ──────────────────────────────────────────────────────────

/**
 * Loads and manages markdown skill files from configured directories.
 *
 * Scans directories for `.md` files, parses YAML frontmatter for metadata,
 * and caches results in memory for fast lookup.
 */
export class SkillsService {
  private readonly skillsDirectories: string[];
  private readonly cache: Map<string, Skill> = new Map();

  /**
   * Create a new SkillsService.
   *
   * @param skillsDirectories - Array of directory paths to scan for skill files.
   */
  constructor(skillsDirectories: string[]) {
    this.skillsDirectories = skillsDirectories.map((d) => resolve(d));
  }

  /**
   * Scan all configured directories for `.md` files and load them.
   *
   * Existing cache is replaced on each call.
   */
  async loadSkills(): Promise<void> {
    const newCache = new Map<string, Skill>();

    for (const dir of this.skillsDirectories) {
      let pattern: string[];
      try {
        pattern = await glob('**/*.md', { cwd: dir, absolute: true });
      } catch {
        logger.warn(`Skills directory not accessible, skipping`, { dir });
        continue;
      }

      for (const filePath of pattern) {
        try {
          const skill = await parseSkillFile(filePath);
          newCache.set(skill.name, skill);
          logger.debug(`Loaded skill`, { name: skill.name, path: filePath });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`Failed to load skill file`, { path: filePath, error: message });
        }
      }
    }

    this.cache.clear();
    for (const [key, value] of newCache) {
      this.cache.set(key, value);
    }

    logger.info(`Loaded ${this.cache.size} skill(s) from ${this.skillsDirectories.length} director(ies)`);
  }

  /**
   * Get a skill by name.
   *
   * @param name - Skill name (from frontmatter or filename without extension).
   * @returns The Skill, or undefined if not found.
   */
  getSkill(name: string): Skill | undefined {
    return this.cache.get(name);
  }

  /**
   * List all loaded skills.
   *
   * @returns Array of all cached Skills.
   */
  listSkills(): Skill[] {
    return Array.from(this.cache.values());
  }

  /**
   * Search skills by a text query.
   *
   * Case-insensitive search across skill name, description, and content.
   *
   * @param query - Search text.
   * @returns Matching skills.
   */
  searchSkills(query: string): Skill[] {
    const lower = query.toLowerCase();
    const results: Skill[] = [];

    for (const skill of this.cache.values()) {
      const haystack = `${skill.name} ${skill.description} ${skill.content}`.toLowerCase();
      if (haystack.includes(lower)) {
        results.push(skill);
      }
    }

    return results;
  }

  /**
   * Get formatted skill content ready for system prompt injection.
   *
   * Wraps the skill content with a header indicating the skill name.
   *
   * @param name - Skill name to retrieve.
   * @returns Formatted skill string for prompt injection.
   * @throws SkillNotFoundError if the skill does not exist.
   */
  getSkillPrompt(name: string): string {
    const skill = this.cache.get(name);
    if (!skill) {
      throw new SkillNotFoundError(name);
    }

    return `## Skill: ${skill.name}\n\n${skill.description ? `${skill.description}\n\n` : ''}${skill.content}`;
  }

  /**
   * Clear the cache and reload all skills from disk.
   */
  async reload(): Promise<void> {
    logger.info('Reloading skills...');
    this.cache.clear();
    await this.loadSkills();
  }
}
