/**
 * @tolu/cowork-core — Tool loader
 *
 * Loads tool definitions from config files, directories, or built-in set.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ToluToolDefinition } from "./tool-interface.js";
import { ReadTool, WriteTool, EditTool, ListTool } from "./file-tools.js";
import { BashTool } from "./bash-tool.js";
import { GrepTool, FindTool, GlobTool } from "./search-tool.js";
import { WebSearchTool, WebFetchTool } from "./web-tool.js";

// ─── Built-in Tools Registry ─────────────────────────────────────────────────

const BUILTIN_TOOLS: ReadonlyMap<string, ToluToolDefinition> = new Map([
  [ReadTool.name, ReadTool],
  [WriteTool.name, WriteTool],
  [EditTool.name, EditTool],
  [ListTool.name, ListTool],
  [BashTool.name, BashTool],
  [GrepTool.name, GrepTool],
  [FindTool.name, FindTool],
  [GlobTool.name, GlobTool],
  [WebSearchTool.name, WebSearchTool],
  [WebFetchTool.name, WebFetchTool],
]);

// ─── Tool Config Schema ──────────────────────────────────────────────────────

interface ToolConfig {
  tools: {
    enabled?: string[];
    disabled?: string[];
    custom?: Array<{ module: string }>;
  };
}

// ─── ToolLoader ──────────────────────────────────────────────────────────────

/**
 * Loads tool definitions from various sources:
 * - Built-in tools by name
 * - JSON/YAML config files
 * - Directories containing ES modules exporting ToluToolDefinition
 */
export class ToolLoader {
  /**
   * Load tools from a JSON or YAML configuration file.
   *
   * The config format is:
   * ```json
   * {
   *   "tools": {
   *     "enabled": ["read_file", "bash"],
   *     "disabled": [],
   *     "custom": [{ "module": "./my-tool.js" }]
   *   }
   * }
   * ```
   *
   * @param configPath - Path to the JSON or YAML config file.
   * @returns Array of loaded tool definitions.
   */
  async loadFromConfig(configPath: string): Promise<ToluToolDefinition[]> {
    const resolved = path.resolve(configPath);
    const raw = await fs.readFile(resolved, "utf-8");

    let config: ToolConfig;
    if (resolved.endsWith(".yaml") || resolved.endsWith(".yml")) {
      config = parseYaml(raw) as ToolConfig;
    } else {
      config = JSON.parse(raw) as ToolConfig;
    }

    const tools: ToluToolDefinition[] = [];
    const disabled = new Set(config.tools?.disabled ?? []);

    // Load enabled built-in tools
    const enabled = config.tools?.enabled ?? [];
    for (const name of enabled) {
      if (disabled.has(name)) continue;
      const builtin = BUILTIN_TOOLS.get(name);
      if (builtin) {
        tools.push(builtin);
      }
    }

    // Load custom tools from modules
    const custom = config.tools?.custom ?? [];
    const configDir = path.dirname(resolved);
    for (const { module } of custom) {
      const modulePath = path.resolve(configDir, module);
      // eslint-disable-next-line no-await-in-loop
      const loaded = await this.loadModule(modulePath);
      if (loaded && !disabled.has(loaded.name)) {
        tools.push(loaded);
      }
    }

    return tools;
  }

  /**
   * Load all tool modules from a directory.
   *
   * Each file should be an ES module that exports a `ToluToolDefinition`
   * as the default export or as a named export called `tool`.
   *
   * @param dirPath - Directory containing tool modules.
   * @returns Array of loaded tool definitions.
   */
  async loadFromDirectory(dirPath: string): Promise<ToluToolDefinition[]> {
    const resolved = path.resolve(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });

    const tools: ToluToolDefinition[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs")) continue;

      const modulePath = path.join(resolved, entry.name);
      // eslint-disable-next-line no-await-in-loop
      const loaded = await this.loadModule(modulePath);
      if (loaded) {
        tools.push(loaded);
      }
    }

    return tools;
  }

  /**
   * Return all built-in tool definitions.
   *
   * @returns Array of all built-in tools.
   */
  loadBuiltinTools(): ToluToolDefinition[] {
    return Array.from(BUILTIN_TOOLS.values());
  }

  /**
   * Dynamically import a module and extract the tool definition.
   *
   * Looks for a default export that is a ToluToolDefinition,
   * or a named export called `tool`.
   */
  private async loadModule(modulePath: string): Promise<ToluToolDefinition | null> {
    try {
      const imported = await import(modulePath);
      const mod = imported as Record<string, unknown>;

      if (
        mod.default &&
        typeof mod.default === "object" &&
        mod.default !== null &&
        "name" in mod.default &&
        "execute" in mod.default
      ) {
        return mod.default as ToluToolDefinition;
      }

      if (
        mod.tool &&
        typeof mod.tool === "object" &&
        mod.tool !== null &&
        "name" in mod.tool &&
        "execute" in mod.tool
      ) {
        return mod.tool as ToluToolDefinition;
      }

      return null;
    } catch {
      return null;
    }
  }
}
