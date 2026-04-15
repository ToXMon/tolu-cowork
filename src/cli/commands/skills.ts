import type { Command } from 'commander';
import { chalk, ConfigLoader, handleError } from '../utils.js';
import { SkillsService } from '../../services/skills-service.js';

export function registerSkillsCommand(program: Command): void {
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
        handleError(err);
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
        handleError(err);
      }
    });
}
