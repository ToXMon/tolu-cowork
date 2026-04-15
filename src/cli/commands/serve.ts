import type { Command } from 'commander';
import { chalk } from '../utils.js';

export function registerServeCommand(program: Command): void {
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
}
