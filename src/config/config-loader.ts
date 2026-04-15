import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { ToluConfigSchema, type ToluConfig } from './config-schema.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('config');

const CONFIG_FILENAME = 'tolu.config.json';

/**
 * Error thrown when config file cannot be found, read, or parsed.
 */
export class ConfigError extends Error {
  /** Path of the config file that caused the error, if applicable. */
  public readonly filePath: string;

  constructor(message: string, filePath: string) {
    super(message);
    this.name = 'ConfigError';
    this.filePath = filePath;
  }
}

/**
 * Loads, validates, and writes tolu.config.json files.
 */
export class ConfigLoader {
  /**
   * Load and validate config from an explicit path or by searching upward.
   * @param configPath - Optional explicit path to the config file.
   * @returns Validated ToluConfig.
   * @throws ConfigError if the file is not found or fails validation.
   */
  static async load(configPath?: string): Promise<ToluConfig> {
    const filePath = configPath ?? (await ConfigLoader.findConfig());

    if (!filePath) {
      throw new ConfigError(
        `Config file not found. Searched for "${CONFIG_FILENAME}" upward from ${resolve('.')}`,
        resolve('.'),
      );
    }

    const resolvedPath = resolve(filePath);

    let raw: string;
    try {
      raw = await fs.readFile(resolvedPath, 'utf-8');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      throw new ConfigError(
        `Failed to read config file: ${message}`,
        resolvedPath,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigError(
        `Config file contains invalid JSON: ${resolvedPath}`,
        resolvedPath,
      );
    }

    return ConfigLoader.validate(parsed, resolvedPath);
  }

  /**
   * Walk upward from startDir (or cwd) looking for tolu.config.json.
   * @param startDir - Directory to start searching from.
   * @returns Absolute path to the config file, or null if not found.
   */
  static async findConfig(startDir?: string): Promise<string | null> {
    let current = resolve(startDir ?? process.cwd());
    const root = resolve('/');

    while (current !== root) {
      const candidate = resolve(current, CONFIG_FILENAME);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // not found here, go up
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    // Check root as well
    const rootCandidate = resolve(root, CONFIG_FILENAME);
    try {
      await fs.access(rootCandidate);
      return rootCandidate;
    } catch {
      // not found at root
    }

    return null;
  }

  /**
   * Load config with environment variable overrides applied.
   * Search order: explicit path → TOLU_CONFIG env → ./tolu.config.json → ~/.tolu/config.json
   * @param configPath - Optional explicit path to the config file.
   * @returns Validated ToluConfig with env overrides applied.
   * @throws ConfigError if no config file is found or validation fails.
   */
  static async loadWithOverrides(configPath?: string): Promise<ToluConfig> {
    let resolvedPath = configPath ?? '';

    if (!resolvedPath) {
      // Check TOLU_CONFIG env var
      const envConfig = process.env['TOLU_CONFIG'];
      if (envConfig) {
        resolvedPath = envConfig;
      } else {
        // Check ./tolu.config.json
        const localPath = resolve('.', CONFIG_FILENAME);
        try {
          await fs.access(localPath);
          resolvedPath = localPath;
        } catch {
          // Check ~/.tolu/config.json
          const homeConfig = resolve(homedir(), '.tolu', CONFIG_FILENAME);
          try {
            await fs.access(homeConfig);
            resolvedPath = homeConfig;
          } catch {
            // Fall through to load() which will throw ConfigError
          }
        }
      }
    }

    const config = await ConfigLoader.load(resolvedPath || undefined);

    // Apply environment variable overrides
    const apiKey = process.env['TOLU_API_KEY'];
    if (apiKey) {
      config.provider.apiKey = apiKey;
    }

    const baseUrl = process.env['TOLU_BASE_URL'];
    if (baseUrl) {
      config.provider.baseUrl = baseUrl;
    }

    const model = process.env['TOLU_MODEL'];
    if (model) {
      config.provider.model = model;
    }

    const sandboxLevel = process.env['TOLU_SANDBOX_LEVEL'];
    if (
      sandboxLevel === 'none' ||
      sandboxLevel === 'path-only' ||
      sandboxLevel === 'docker'
    ) {
      config.sandbox.level = sandboxLevel;
    }

    return config;
  }

  /**
   * Validate a raw config object against the Zod schema.
   * @param config - Raw config object to validate.
   * @param filePath - Optional file path for error reporting.
   * @returns Validated ToluConfig.
   * @throws ConfigError if validation fails.
   */
  static validate(config: unknown, filePath?: string): ToluConfig {
    try {
      return ToluConfigSchema.parse(config);
    } catch (err) {
      const pathLabel = filePath ?? '<unknown>';
      if (err instanceof Error && 'errors' in err) {
        const zodErr = err as { errors: Array<{ path: (string | number)[]; message: string }> };
        const details = zodErr.errors
          .map((e) => `  ${e.path.join('.')}: ${e.message}`)
          .join('\n');
        throw new ConfigError(
          `Config validation failed in ${pathLabel}:\n${details}`,
          pathLabel,
        );
      }
      throw new ConfigError(
        `Config validation failed in ${pathLabel}: ${err instanceof Error ? err.message : String(err)}`,
        pathLabel,
      );
    }
  }

  /**
   * Write a default config file with the minimum required fields.
   * @param filePath - Path to write the config file to.
   */
  static async writeDefault(filePath: string): Promise<void> {
    const defaultConfig = ToluConfigSchema.parse({
      provider: {
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    const resolvedPath = resolve(filePath);
    const dir = dirname(resolvedPath);

    await fs.mkdir(dir, { recursive: true });

    const content = JSON.stringify(defaultConfig, null, 2) + '\n';
    await fs.writeFile(resolvedPath, content, 'utf-8');

    logger.info(`Default config written to ${resolvedPath}`);
  }
}
