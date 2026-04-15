import type { Command } from 'commander';
import { chalk, ConfigLoader, handleError } from '../utils.js';

export function registerConfigCommand(program: Command): void {
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
        handleError(err);
      }
    });
}
