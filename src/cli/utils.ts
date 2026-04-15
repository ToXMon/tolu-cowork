import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Ora } from 'ora';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ConfigLoader } from '../config/config-loader.js';
import type { ToluConfig } from '../config/config-schema.js';
import type { ToluProviderConfig, ToluModelCostRates } from '../types/index.js';
import { ToluProvider } from '../provider/tolu-provider.js';
import { ToluAgent } from '../agent/tolu-agent.js';
import { AgentSession } from '../agent/agent-session.js';
import { ToolLoader } from '../tools/tool-loader.js';
import { SandboxManager } from '../sandbox/sandbox-manager.js';
import { SkillsService } from '../services/skills-service.js';

// ─── Agent Setup ──────────────────────────────────────────────────────────────

export interface AgentSetup {
  config: ToluConfig;
  agent: ToluAgent;
  session: AgentSession;
  skillsService: SkillsService | null;
}

export async function setupAgent(
  config: ToluConfig,
  maxTurns?: number,
): Promise<AgentSetup> {
  const providerConfig: ToluProviderConfig = {
    baseUrl: config.provider.baseUrl,
    apiKey: config.provider.apiKey ?? '',
    model: config.provider.model,
    provider: config.provider.provider,
    temperature: config.provider.temperature,
    maxTokens: config.provider.maxTokens,
    reasoning: config.provider.reasoning,
  };

  if (config.provider.costRates) {
    providerConfig.costRates = config.provider.costRates as ToluModelCostRates;
  }

  const provider = new ToluProvider(providerConfig);

  const sandboxManager = config.sandbox.level !== 'none'
    ? new SandboxManager()
    : undefined;

  const agentConfig: {
    maxTurns?: number;
    toolExecution?: 'sequential' | 'parallel';
    systemPrompt?: string;
  } = {
    maxTurns: maxTurns ?? config.agent.maxTurns,
    toolExecution: config.agent.toolExecution,
    systemPrompt: config.agent.systemPrompt,
  };

  const agent = new ToluAgent({
    provider,
    sandboxManager,
    config: agentConfig,
  });

  // Load tools
  const toolLoader = new ToolLoader();
  const disabledSet = new Set(config.tools.disabled);
  const allTools = toolLoader.loadBuiltinTools();
  const enabledSet = config.tools.enabled.length > 0
    ? new Set(config.tools.enabled)
    : null;

  for (const tool of allTools) {
    if (disabledSet.has(tool.name)) continue;
    if (enabledSet && !enabledSet.has(tool.name)) continue;
    agent.registerTool(tool);
  }

  // Load custom tools
  for (const custom of config.tools.custom) {
    const loaded = await toolLoader.loadFromDirectory(custom.module);
    for (const tool of loaded) {
      if (disabledSet.has(tool.name)) continue;
      agent.registerTool(tool);
    }
  }

  // Load skills
  let skillsService: SkillsService | null = null;
  if (config.skills.directories.length > 0) {
    skillsService = new SkillsService(config.skills.directories);
    await skillsService.loadSkills();

    const skills = skillsService.listSkills();
    if (skills.length > 0) {
      const skillsBlock = skills
        .map((s) => skillsService!.getSkillPrompt(s.name))
        .join('\n\n');
      const existing = agentConfig.systemPrompt ?? '';
      agentConfig.systemPrompt = existing.length > 0
        ? `${existing}\n\n${skillsBlock}`
        : skillsBlock;
      const updatedAgent = new ToluAgent({
        provider,
        sandboxManager,
        config: agentConfig,
      });
      for (const tool of agent.listTools()) {
        updatedAgent.registerTool(tool);
      }
      return { config, agent: updatedAgent, session: new AgentSession(), skillsService };
    }
  }

  const session = new AgentSession();
  return { config, agent, session, skillsService };
}

// ─── Spinner helper ──────────────────────────────────────────────────────────

export function createSpinner(text: string): Ora {
  return ora(text).start();
}

// ─── Readline helper ─────────────────────────────────────────────────────────

export function createReadline(): readline.Interface {
  return readline.createInterface({ input, output });
}

// ─── Error handler ───────────────────────────────────────────────────────────

export function handleError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

// ─── Re-exports for convenience ──────────────────────────────────────────────

export { ConfigLoader };
export { chalk };
export type { Command };
