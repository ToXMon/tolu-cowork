/**
 * @tolu/cowork-core — SubAgentsService
 *
 * Spawns and manages sub-agent sessions that share the parent's
 * provider but operate with independent sessions and tracking.
 */

import * as crypto from 'node:crypto';
import { ToluAgent } from '../agent/tolu-agent.js';
import { AgentSession } from '../agent/agent-session.js';
import type { ToluProvider } from '../provider/tolu-provider.js';
import type { ToluAssistantMessage } from '../types/index.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('sub-agents-service');

// ─── Types ──────────────────────────────────────────────────────────────────

/** Tracking metadata for a spawned sub-agent. */
export interface SubAgent {
  /** Unique sub-agent identifier. */
  id: string;
  /** Human-readable name for this sub-agent. */
  name: string;
  /** Role description guiding the sub-agent's behavior. */
  role: string;
  /** Current execution status. */
  status: 'idle' | 'running' | 'error';
  /** Epoch ms when the sub-agent was created. */
  createdAt: number;
  /** Epoch ms of the last activity (execution start or completion). */
  lastActivityAt: number;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a referenced sub-agent is not found. */
export class SubAgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Sub-agent not found: ${id}`);
    this.name = 'SubAgentNotFoundError';
  }
}

/** Thrown when attempting to execute on a sub-agent that is already running. */
export class SubAgentBusyError extends Error {
  constructor(id: string) {
    super(`Sub-agent is already running: ${id}`);
    this.name = 'SubAgentBusyError';
  }
}

// ─── Internal Entry ─────────────────────────────────────────────────────────

/** Internal tracking entry for a sub-agent and its resources. */
interface SubAgentEntry {
  agent: ToluAgent;
  session: AgentSession;
  info: SubAgent;
}

// ─── SubAgentsService ───────────────────────────────────────────────────────

/**
 * Spawns and manages sub-agent sessions.
 *
 * Sub-agents share the parent's provider configuration but maintain
 * their own ToluAgent instances and AgentSessions for isolation.
 */
export class SubAgentsService {
  private readonly parentAgent: ToluAgent;
  private readonly provider: ToluProvider;
  private readonly entries: Map<string, SubAgentEntry> = new Map();

  /**
   * Create a new SubAgentsService.
   *
   * @param parentAgent - The parent agent whose configuration is shared.
   * @param provider - The provider instance used to create new sub-agents.
   */
  constructor(parentAgent: ToluAgent, provider: ToluProvider) {
    this.parentAgent = parentAgent;
    this.provider = provider;
  }

  /**
   * Spawn a new sub-agent with a given name and role.
   *
   * Creates a fresh ToluAgent and AgentSession sharing the parent's provider.
   *
   * @param name - Human-readable name for the sub-agent.
   * @param role - Role description guiding its behavior.
   * @returns Sub-agent tracking metadata.
   */
  spawn(name: string, role: string): SubAgent {
    const id = crypto.randomUUID();
    const now = Date.now();

    const agent = new ToluAgent({ provider: this.provider });
    const session = new AgentSession();

    const info: SubAgent = {
      id,
      name,
      role,
      status: 'idle',
      createdAt: now,
      lastActivityAt: now,
    };

    this.entries.set(id, { agent, session, info });

    logger.info('Sub-agent spawned', { id, name, role });
    return info;
  }

  /**
   * Execute a prompt on a sub-agent.
   *
   * Updates the sub-agent's status to 'running' during execution,
   * then to 'idle' on success or 'error' on failure.
   *
   * @param subAgentId - ID of the sub-agent to execute on.
   * @param prompt - The prompt to send to the sub-agent.
   * @returns The assistant's response message.
   * @throws SubAgentNotFoundError if the sub-agent does not exist.
   * @throws SubAgentBusyError if the sub-agent is already running.
   */
  async execute(subAgentId: string, prompt: string): Promise<ToluAssistantMessage> {
    const entry = this.entries.get(subAgentId);
    if (!entry) {
      throw new SubAgentNotFoundError(subAgentId);
    }

    if (entry.info.status === 'running') {
      throw new SubAgentBusyError(subAgentId);
    }

    entry.info.status = 'running';
    entry.info.lastActivityAt = Date.now();

    logger.info('Sub-agent executing', { id: subAgentId, name: entry.info.name });

    try {
      const result = await entry.agent.run(prompt, entry.session);
      entry.info.status = 'idle';
      entry.info.lastActivityAt = Date.now();

      logger.info('Sub-agent completed', { id: subAgentId, name: entry.info.name });
      return result;
    } catch (err) {
      entry.info.status = 'error';
      entry.info.lastActivityAt = Date.now();

      const message = err instanceof Error ? err.message : String(err);
      logger.error('Sub-agent execution failed', { id: subAgentId, error: message });
      throw err;
    }
  }

  /**
   * Get the current status of a sub-agent.
   *
   * @param subAgentId - ID of the sub-agent.
   * @returns Sub-agent metadata, or undefined if not found.
   */
  getStatus(subAgentId: string): SubAgent | undefined {
    return this.entries.get(subAgentId)?.info;
  }

  /**
   * List all tracked sub-agents.
   *
   * @returns Array of all sub-agent metadata.
   */
  listSubAgents(): SubAgent[] {
    return Array.from(this.entries.values()).map((entry) => entry.info);
  }

  /**
   * Terminate a specific sub-agent.
   *
   * Aborts any running operation and removes the sub-agent from tracking.
   *
   * @param subAgentId - ID of the sub-agent to terminate.
   */
  terminate(subAgentId: string): void {
    const entry = this.entries.get(subAgentId);
    if (!entry) return;

    // Abort any running agent loop
    entry.agent.abort();
    this.entries.delete(subAgentId);

    logger.info('Sub-agent terminated', { id: subAgentId, name: entry.info.name });
  }

  /**
   * Terminate all tracked sub-agents.
   *
   * Aborts all running operations and clears the tracking map.
   */
  terminateAll(): void {
    for (const entry of this.entries.values()) {
      entry.agent.abort();
    }

    const count = this.entries.size;
    this.entries.clear();

    logger.info(`All sub-agents terminated`, { count });
  }
}
