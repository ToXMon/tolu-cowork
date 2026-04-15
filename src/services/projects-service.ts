/**
 * @tolu/cowork-core — ProjectsService
 *
 * Manages persistent project workspaces with metadata tracking.
 * Each project maps to a workspace directory with its own config.
 */

import { promises as fs } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { ToluConfig } from '../config/config-schema.js';
import { ConfigLoader } from '../config/config-loader.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('projects-service');

// ─── Types ──────────────────────────────────────────────────────────────────

/** Metadata for a registered project workspace. */
export interface Project {
  /** Unique project name. */
  name: string;
  /** Absolute path to the workspace root directory. */
  path: string;
  /** Absolute path to the project's tolu.config.json. */
  configPath: string;
  /** Epoch ms when the project was created. */
  createdAt: number;
  /** Epoch ms when the project was last opened. */
  lastOpenedAt: number;
  /** Number of sessions opened for this project. */
  sessionCount: number;
  /** Optional human-readable project description. */
  description?: string;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a project cannot be found. */
export class ProjectNotFoundError extends Error {
  constructor(name: string) {
    super(`Project not found: ${name}`);
    this.name = 'ProjectNotFoundError';
  }
}

/** Thrown when a project already exists. */
export class ProjectExistsError extends Error {
  constructor(name: string) {
    super(`Project already exists: ${name}`);
    this.name = 'ProjectExistsError';
  }
}

/** Thrown when a workspace path is invalid. */
export class InvalidWorkspaceError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid workspace path "${path}": ${reason}`);
    this.name = 'InvalidWorkspaceError';
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Default root directory for project metadata storage. */
function defaultProjectsDir(): string {
  return join(homedir(), '.tolu', 'projects');
}

/** Build the path to a project's metadata directory. */
function projectMetaDir(projectsDir: string, name: string): string {
  return join(projectsDir, name);
}

/** Build the path to a project's metadata JSON file. */
function projectMetaFile(projectsDir: string, name: string): string {
  return join(projectMetaDir(projectsDir, name), 'project.json');
}

// ─── ProjectsService ────────────────────────────────────────────────────────

/**
 * Manages persistent project workspaces.
 *
 * Each project is stored as a JSON metadata file under ~/.tolu/projects/{name}/.
 * Projects reference a workspace directory on disk that contains a tolu.config.json.
 */
export class ProjectsService {
  private readonly projectsDir: string;

  /**
   * Create a new ProjectsService.
   *
   * @param projectsDir - Root directory for project metadata. Defaults to ~/.tolu/projects/
   */
  constructor(projectsDir?: string) {
    this.projectsDir = resolve(projectsDir ?? defaultProjectsDir());
  }

  /**
   * Create a new project workspace.
   *
   * Validates that the workspace path exists, creates metadata storage,
   * and writes a default tolu.config.json if one does not already exist.
   *
   * @param name - Unique project name.
   * @param path - Absolute or relative path to the workspace root.
   * @param description - Optional project description.
   * @returns The newly created Project.
   * @throws ProjectExistsError if a project with this name already exists.
   * @throws InvalidWorkspaceError if the workspace path does not exist.
   */
  async createProject(name: string, path: string, description?: string): Promise<Project> {
    const resolvedPath = resolve(path);

    // Validate workspace directory exists
    try {
      await fs.access(resolvedPath);
    } catch {
      throw new InvalidWorkspaceError(resolvedPath, 'directory does not exist');
    }

    // Check project doesn't already exist
    const metaFile = projectMetaFile(this.projectsDir, name);
    try {
      await fs.access(metaFile);
      throw new ProjectExistsError(name);
    } catch (err) {
      if (err instanceof ProjectExistsError) throw err;
      // File doesn't exist — proceed
    }

    // Ensure workspace has a config file
    const configPath = join(resolvedPath, 'tolu.config.json');
    try {
      await fs.access(configPath);
      logger.debug('Existing config found', { configPath });
    } catch {
      await ConfigLoader.writeDefault(configPath);
      logger.info('Created default config', { configPath });
    }

    const now = Date.now();
    const project: Project = {
      name,
      path: resolvedPath,
      configPath,
      createdAt: now,
      lastOpenedAt: now,
      sessionCount: 0,
      description,
    };

    // Write project metadata
    const metaDir = projectMetaDir(this.projectsDir, name);
    await fs.mkdir(metaDir, { recursive: true });
    await fs.writeFile(metaFile, JSON.stringify(project, null, 2) + '\n', 'utf-8');

    logger.info('Project created', { name, path: resolvedPath });
    return project;
  }

  /**
   * Get a project by name.
   *
   * @param name - Project name.
   * @returns The Project, or undefined if not found.
   */
  async getProject(name: string): Promise<Project | undefined> {
    const metaFile = projectMetaFile(this.projectsDir, name);
    try {
      const raw = await fs.readFile(metaFile, 'utf-8');
      return JSON.parse(raw) as Project;
    } catch {
      return undefined;
    }
  }

  /**
   * List all registered projects.
   *
   * @returns Array of all projects.
   */
  async listProjects(): Promise<Project[]> {
    try {
      await fs.mkdir(this.projectsDir, { recursive: true });
    } catch {
      // Directory creation failed; proceed with listing attempt
    }

    let entries: string[];
    try {
      entries = await fs.readdir(this.projectsDir);
    } catch {
      return [];
    }

    const projects: Project[] = [];

    for (const entry of entries) {
      const metaFile = join(this.projectsDir, entry, 'project.json');
      try {
        const raw = await fs.readFile(metaFile, 'utf-8');
        projects.push(JSON.parse(raw) as Project);
      } catch {
        // Skip entries without valid metadata
      }
    }

    return projects;
  }

  /**
   * Open a project, reading its config and updating access metadata.
   *
   * Reads the project's tolu.config.json, increments the session count,
   * and updates lastOpenedAt.
   *
   * @param name - Project name.
   * @returns The project and its loaded config.
   * @throws ProjectNotFoundError if the project does not exist.
   */
  async openProject(name: string): Promise<{ project: Project; config: ToluConfig }> {
    const project = await this.getProject(name);
    if (!project) {
      throw new ProjectNotFoundError(name);
    }

    // Load the project's config
    const config = await ConfigLoader.load(project.configPath);

    // Update access metadata
    project.lastOpenedAt = Date.now();
    project.sessionCount += 1;

    const metaFile = projectMetaFile(this.projectsDir, name);
    await fs.writeFile(metaFile, JSON.stringify(project, null, 2) + '\n', 'utf-8');

    logger.info('Project opened', { name, sessionCount: project.sessionCount });
    return { project, config };
  }

  /**
   * Delete a project and its metadata.
   *
   * Removes only the metadata directory — the workspace files are left untouched.
   *
   * @param name - Project name.
   * @throws ProjectNotFoundError if the project does not exist.
   */
  async deleteProject(name: string): Promise<void> {
    const project = await this.getProject(name);
    if (!project) {
      throw new ProjectNotFoundError(name);
    }

    const metaDir = projectMetaDir(this.projectsDir, name);
    await fs.rm(metaDir, { recursive: true, force: true });

    logger.info('Project deleted', { name });
  }

  /**
   * Get the workspace path for a project.
   *
   * @param projectName - Project name.
   * @returns Absolute path to the project workspace.
   * @throws ProjectNotFoundError if the project does not exist.
   */
  async getProjectSession(projectName: string): Promise<string> {
    const project = await this.getProject(projectName);
    if (!project) {
      throw new ProjectNotFoundError(projectName);
    }
    return project.path;
  }
}
