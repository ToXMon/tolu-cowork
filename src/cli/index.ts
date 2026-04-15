#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
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
import { ProjectsService } from '../services/projects-service.js';
import { SkillsService } from '../services/skills-service.js';
import { Logger } from '../utils/logger.js';
import { formatAssistantMessage, formatUsage } from '../utils/format.js';

const logger = new Logger('cli');

// ─── Process-level Error Handlers ─────────────────────────────────────────────

process.on('unhandledRejection', (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`Fatal: unhandled rejection — ${message}\n`));
  process.exit(1);
});

process.on('uncaughtException', (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`Fatal: uncaught exception — ${message}\n`));
  process.exit(1);
});

// ─── Shared Setup ─────────────────────────────────────────────────────────────

interface AgentSetup {
  config: ToluConfig;
  agent: ToluAgent;
  session: AgentSession;
  skillsService: SkillsService | null;
}

async function setupAgent(
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

    // Inject skill content into system prompt
    const skills = skillsService.listSkills();
    if (skills.length > 0) {
      const skillsBlock = skills
        .map((s) => skillsService!.getSkillPrompt(s.name))
        .join('\n\n');
      const existing = agentConfig.systemPrompt ?? '';
      agentConfig.systemPrompt = existing.length > 0
        ? `${existing}\n\n${skillsBlock}`
        : skillsBlock;
      // Re-create agent with updated system prompt
      const updatedAgent = new ToluAgent({
        provider,
        sandboxManager,
        config: agentConfig,
      });
      // Re-register all tools on the new agent
      for (const tool of agent.listTools()) {
        updatedAgent.registerTool(tool);
      }
      return { config, agent: updatedAgent, session: new AgentSession(), skillsService };
    }
  }

  const session = new AgentSession();
  return { config, agent, session, skillsService };
}

// ─── Program Definition ──────────────────────────────────────────────────────

const program = new Command();
program
  .name('tolu')
  .description('Tolu Cowork — Open-source coding agent')
  .version('0.1.0');

// ─── 1. `tolu start` — Interactive agent session ─────────────────────────────

program
  .command('start')
  .description('Start an interactive agent session')
  .option('-p, --project <name>', 'Open specific project')
  .option('-m, --model <model>', 'Override model')
  .action(async (opts: { project?: string; model?: string }) => {
    try {
      let config = await ConfigLoader.loadWithOverrides();

      // Open project if specified
      if (opts.project) {
        const projects = new ProjectsService();
        const result = await projects.openProject(opts.project);
        config = result.config;
        console.log(chalk.green(`Opened project: ${result.project.name}`));
        console.log(chalk.gray(`  Path: ${result.project.path}`));
        console.log(chalk.gray(`  Session #${result.project.sessionCount}`));
      }

      // Override model if specified
      if (opts.model) {
        config.provider.model = opts.model;
      }

      const { agent, session, skillsService } = await setupAgent(config);

      console.log(chalk.bold('Tolu Cowork — Interactive Session'));
      console.log(chalk.gray(`Model: ${config.provider.model}`));
      console.log(chalk.gray(`Sandbox: ${config.sandbox.level}`));
      console.log(chalk.gray(`Tools: ${agent.listTools().length} loaded`));
      if (skillsService) {
        console.log(chalk.gray(`Skills: ${skillsService.listSkills().length} loaded`));
      }
      console.log(chalk.gray('Type /help for commands, /exit to quit\n'));

      let aborted = false;
      const rl = readline.createInterface({ input, output });

      const sigintHandler = (): void => {
        aborted = true;
        agent.abort();
        rl.close();
      };
      process.on('SIGINT', sigintHandler);

      while (!aborted) {
        let line: string;
        try {
          line = await rl.question(chalk.cyan('tolu> '));
        } catch {
          break;
        }

        const trimmed = line.trim();
        if (!trimmed) continue;

        // Handle slash commands
        if (trimmed.startsWith('/')) {
          const cmd = trimmed.toLowerCase();
          switch (cmd) {
            case '/exit':
            case '/quit':
              process.removeListener('SIGINT', sigintHandler);
              rl.close();
              console.log(chalk.gray('Goodbye!'));
              return;
            case '/help':
              console.log(chalk.bold('Commands:'));
              console.log('  /exit, /quit  — Exit session');
              console.log('  /help         — Show this help');
              console.log('  /skills       — List loaded skills');
              console.log('  /tools        — List loaded tools');
              console.log('  /usage        — Show session usage');
              continue;
            case '/skills':
              if (skillsService) {
                const skills = skillsService.listSkills();
                if (skills.length === 0) {
                  console.log(chalk.gray('No skills loaded'));
                } else {
                  for (const skill of skills) {
                    console.log(chalk.cyan(skill.name) + (skill.description ? ` — ${skill.description}` : ''));
                  }
                }
              } else {
                console.log(chalk.gray('No skills service configured'));
              }
              continue;
            case '/tools': {
              const tools = agent.listTools();
              for (const tool of tools) {
                console.log(chalk.cyan(tool.name) + ` — ${tool.description}`);
              }
              continue;
            }
            case '/usage': {
              const usage = session.getUsage();
              console.log(formatUsage(usage));
              continue;
            }
            default:
              console.log(chalk.yellow(`Unknown command: ${trimmed}. Type /help for commands.`));
              continue;
          }
        }

        // Run agent
        const spinner = ora('Thinking...').start();
        try {
          const result = await agent.run(trimmed, session);
          spinner.stop();
          console.log(formatAssistantMessage(result));
          console.log();
        } catch (err) {
          spinner.stop();
          const message = err instanceof Error ? err.message : String(err);
          console.log(chalk.red(`Error: ${message}`));
        }
      }

      process.removeListener('SIGINT', sigintHandler);
      rl.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

// ─── 2. `tolu run <prompt>` — Run single task ────────────────────────────────

program
  .command('run')
  .description('Run a single task prompt')
  .argument('<prompt>', 'The task prompt to run')
  .option('-m, --model <model>', 'Override model')
  .option('--max-turns <n>', 'Max agent turns', parseInt)
  .option('--sandbox <level>', 'Sandbox level: none, path-only, docker')
  .action(async (
    prompt: string,
    opts: { model?: string; maxTurns?: number; sandbox?: string },
  ) => {
    try {
      const config = await ConfigLoader.loadWithOverrides();

      // Apply overrides
      if (opts.model) {
        config.provider.model = opts.model;
      }
      if (opts.sandbox) {
        if (opts.sandbox === 'none' || opts.sandbox === 'path-only' || opts.sandbox === 'docker') {
          config.sandbox.level = opts.sandbox;
        } else {
          console.error(chalk.red(`Invalid sandbox level: ${opts.sandbox}. Use: none, path-only, docker`));
          process.exit(1);
        }
      }

      const { agent, session } = await setupAgent(config, opts.maxTurns);

      const spinner = ora('Running task...').start();
      try {
        const result = await agent.run(prompt, session);
        spinner.stop();
        console.log(formatAssistantMessage(result));
        console.log();

        // Print usage stats
        const usage = session.getUsage();
        console.log(chalk.bold('Session Usage:'));
        console.log(formatUsage(usage));
      } catch (err) {
        spinner.stop();
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

// ─── 3. `tolu serve` — Start gRPC server ──────────────────────────────────────

program
  .command('serve')
  .description('Start gRPC server')
  .option('-p, --port <port>', 'Port', '50051')
  .option('--tls', 'Enable TLS')
  .action(async (opts: { port: string; tls?: boolean }) => {
    const tlsEnabled = opts.tls ?? false;
    console.log(chalk.bold('Tolu Cowork — gRPC Server'));
    console.log(chalk.cyan(
      `gRPC server stub started on port ${opts.port} (TLS: ${tlsEnabled ? 'enabled' : 'disabled'})`,
    ));
    console.log(chalk.yellow('Full gRPC implementation coming soon'));
  });

// ─── 4. `tolu project` — Manage projects ─────────────────────────────────────

const projectCmd = program.command('project').description('Manage projects');

projectCmd
  .command('list')
  .description('List all projects')
  .action(async () => {
    try {
      const projects = new ProjectsService();
      const list = await projects.listProjects();

      if (list.length === 0) {
        console.log(chalk.gray('No projects found. Use `tolu project create` to add one.'));
        return;
      }

      // Table header
      const nameWidth = 20;
      const pathWidth = 40;
      console.log(
        chalk.bold('Name'.padEnd(nameWidth)) +
        chalk.bold('Path'.padEnd(pathWidth)) +
        chalk.bold('Last Opened'),
      );
      console.log('─'.repeat(nameWidth + pathWidth + 20));

      for (const project of list) {
        const date = new Date(project.lastOpenedAt);
        const dateStr = date.toISOString().replace('T', ' ').slice(0, 19);
        console.log(
          project.name.padEnd(nameWidth) +
          project.path.padEnd(pathWidth) +
          dateStr,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('create <name>')
  .description('Create a new project')
  .requiredOption('-d, --dir <path>', 'Workspace directory path')
  .action(async (name: string, opts: { dir: string }) => {
    try {
      const projects = new ProjectsService();
      const project = await projects.createProject(name, opts.dir);
      console.log(chalk.green(`Project created: ${project.name}`));
      console.log(chalk.gray(`  Path: ${project.path}`));
      console.log(chalk.gray(`  Config: ${project.configPath}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('open <name>')
  .description('Show project info')
  .action(async (name: string) => {
    try {
      const projects = new ProjectsService();
      const { project, config } = await projects.openProject(name);
      console.log(chalk.bold(`Project: ${project.name}`));
      console.log(chalk.gray(`  Path: ${project.path}`));
      console.log(chalk.gray(`  Config: ${project.configPath}`));
      console.log(chalk.gray(`  Sessions: ${project.sessionCount}`));
      const created = new Date(project.createdAt).toISOString().replace('T', ' ').slice(0, 19);
      const opened = new Date(project.lastOpenedAt).toISOString().replace('T', ' ').slice(0, 19);
      console.log(chalk.gray(`  Created: ${created}`));
      console.log(chalk.gray(`  Last opened: ${opened}`));
      if (project.description) {
        console.log(chalk.gray(`  Description: ${project.description}`));
      }
      console.log(chalk.gray(`  Model: ${config.provider.model}`));
      console.log(chalk.gray(`  Sandbox: ${config.sandbox.level}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

projectCmd
  .command('delete <name>')
  .description('Delete a project')
  .action(async (name: string) => {
    try {
      const projects = new ProjectsService();
      // Confirm deletion
      const rl = readline.createInterface({ input, output });
      const answer = await rl.question(
        chalk.yellow(`Delete project "${name}"? This removes metadata only, not workspace files. [y/N] `),
      );
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(chalk.gray('Cancelled'));
        return;
      }

      await projects.deleteProject(name);
      console.log(chalk.green(`Project deleted: ${name}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

// ─── 5. `tolu skills` — Manage skills ─────────────────────────────────────────

const skillsCmd = program.command('skills').description('Manage skills');

skillsCmd
  .command('list')
  .description('List available skills')
  .action(async () => {
    try {
      const config = await ConfigLoader.loadWithOverrides();
      if (config.skills.directories.length === 0) {
        console.log(chalk.gray('No skills directories configured.'));
        return;
      }

      const service = new SkillsService(config.skills.directories);
      await service.loadSkills();
      const skills = service.listSkills();

      if (skills.length === 0) {
        console.log(chalk.gray('No skills found.'));
        return;
      }

      // Table header
      const nameWidth = 25;
      const descWidth = 50;
      console.log(
        chalk.bold('Name'.padEnd(nameWidth)) +
        chalk.bold('Description'.padEnd(descWidth)) +
        chalk.bold('File'),
      );
      console.log('─'.repeat(nameWidth + descWidth + 20));

      for (const skill of skills) {
        console.log(
          skill.name.padEnd(nameWidth) +
          (skill.description ?? '').slice(0, descWidth).padEnd(descWidth) +
          skill.filePath,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

skillsCmd
  .command('install <path>')
  .description('Install a skill from a file path')
  .action(async (skillPath: string) => {
    try {
      const config = await ConfigLoader.loadWithOverrides();
      if (config.skills.directories.length === 0) {
        console.error(chalk.red('No skills directories configured.'));
        process.exit(1);
        return;
      }

      const { promises: fs } = await import('node:fs');
      const { basename, resolve: resolvePath, join } = await import('node:path');

      const sourcePath = resolvePath(skillPath);

      // Verify source file exists and is .md
      if (!sourcePath.endsWith('.md')) {
        console.error(chalk.red('Skill files must be .md files.'));
        process.exit(1);
        return;
      }

      try {
        await fs.access(sourcePath);
      } catch {
        console.error(chalk.red(`File not found: ${sourcePath}`));
        process.exit(1);
        return;
      }

      // Copy to first skills directory
      const targetDir = resolvePath(config.skills.directories[0]);
      await fs.mkdir(targetDir, { recursive: true });
      const targetPath = join(targetDir, basename(sourcePath));
      await fs.copyFile(sourcePath, targetPath);

      console.log(chalk.green(`Skill installed: ${basename(sourcePath)}`));
      console.log(chalk.gray(`  → ${targetPath}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

// ─── 6. `tolu config` — Show/edit configuration ──────────────────────────────

program
  .command('config')
  .description('Show or edit configuration')
  .option('--init', 'Create default config file')
  .option('--show', 'Show resolved config')
  .action(async (opts: { init?: boolean; show?: boolean }) => {
    try {
      if (opts.init) {
        const targetPath = './tolu.config.json';
        await ConfigLoader.writeDefault(targetPath);
        console.log(chalk.green(`Default config written to ${targetPath}`));
        return;
      }

      if (opts.show) {
        const config = await ConfigLoader.loadWithOverrides();
        const json = JSON.stringify(config, null, 2);
        // Syntax-highlighted JSON with chalk
        const highlighted = json
          .replace(/"([^"]+)":/g, chalk.cyan('"$1"') + ':')
          .replace(/: "([^"]*)"/g, ': ' + chalk.green('"$1"'))
          .replace(/: (\d+\.?\d*)/g, ': ' + chalk.yellow('$1'))
          .replace(/: (true|false)/g, ': ' + chalk.magenta('$1'));
        console.log(highlighted);
        return;
      }

      // No flag — show help
      program.commands
        .find((c) => c.name() === 'config')
        ?.help();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse();
