import type { Command } from 'commander';
import { chalk, createReadline, handleError } from '../utils.js';
import { ProjectsService } from '../../services/projects-service.js';

export function registerProjectCommand(program: Command): void {
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
        handleError(err);
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
        handleError(err);
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
        handleError(err);
      }
    });

  projectCmd
    .command('delete <name>')
    .description('Delete a project')
    .action(async (name: string) => {
      try {
        const projects = new ProjectsService();
        // Confirm deletion
        const rl = createReadline();
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
        handleError(err);
      }
    });
}
