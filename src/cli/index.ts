#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerStartCommand } from './commands/start.js';
import { registerRunCommand } from './commands/run.js';
import { registerServeCommand } from './commands/serve.js';
import { registerProjectCommand } from './commands/project.js';
import { registerSkillsCommand } from './commands/skills.js';
import { registerConfigCommand } from './commands/config.js';

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

// ─── Program Definition ──────────────────────────────────────────────────────

const program = new Command();
program
  .name('tolu')
  .description('Tolu Cowork — Open-source coding agent')
  .version('0.1.0');

// Register all subcommands
registerStartCommand(program);
registerRunCommand(program);
registerServeCommand(program);
registerProjectCommand(program);
registerSkillsCommand(program);
registerConfigCommand(program);

// ─── Parse ───────────────────────────────────────────────────────────────────

program.parse();
