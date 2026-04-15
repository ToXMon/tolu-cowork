import type { Command } from 'commander';
import { chalk, ConfigLoader, setupAgent, createSpinner, handleError } from '../utils.js';
import { formatAssistantMessage, formatUsage } from '../../utils/format.js';

export function registerRunCommand(program: Command): void {
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

        const spinner = createSpinner('Running task...');
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
        handleError(err);
      }
    });
}
