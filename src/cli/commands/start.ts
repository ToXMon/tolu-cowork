import type { Command } from 'commander';
import { chalk, ConfigLoader, setupAgent, createReadline, handleError } from '../utils.js';
import { ProjectsService } from '../../services/projects-service.js';
import { formatAssistantMessage, formatUsage } from '../../utils/format.js';

export function registerStartCommand(program: Command): void {
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
        const rl = createReadline();

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
          const { createSpinner } = await import('../utils.js');
          const spinner = createSpinner('Thinking...');
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
        handleError(err);
      }
    });
}
