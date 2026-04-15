import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// ─── Hoisted mock functions (accessible inside vi.mock factories) ─────────────

const {
  mockWriteDefault,
  mockLoadWithOverrides,
  mockSetupAgent,
  mockHandleError,
  mockQuestion,
  mockSpinnerStop,
} = vi.hoisted(() => ({
  mockWriteDefault: vi.fn().mockResolvedValue(undefined),
  mockLoadWithOverrides: vi.fn(),
  mockSetupAgent: vi.fn(),
  mockHandleError: vi.fn(),
  mockQuestion: vi.fn(),
  mockSpinnerStop: vi.fn(),
}));

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const mockConfig = {
  provider: { model: 'test-model', baseUrl: 'http://localhost', apiKey: 'key', provider: 'openai', temperature: 0.7, maxTokens: 4096 },
  sandbox: { level: 'none' as const },
  skills: { directories: [] as string[] },
  tools: { disabled: [] as string[], enabled: [] as string[], custom: [] as { module: string }[] },
  agent: { maxTurns: 10, toolExecution: 'sequential' as const, systemPrompt: '' },
};

const mockAgentResult = {
  config: mockConfig,
  agent: { run: vi.fn().mockResolvedValue('mock output'), listTools: vi.fn().mockReturnValue([]), abort: vi.fn() },
  session: { getUsage: vi.fn().mockReturnValue({ totalTokens: 100 }) },
  skillsService: null as null,
};

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../utils.js', () => ({
  ConfigLoader: { writeDefault: mockWriteDefault, loadWithOverrides: mockLoadWithOverrides },
  chalk: {
    red: (s: string) => s, green: (s: string) => s, cyan: (s: string) => s,
    yellow: (s: string) => s, magenta: (s: string) => s, gray: (s: string) => s, bold: (s: string) => s,
  },
  handleError: mockHandleError,
  setupAgent: mockSetupAgent,
  createSpinner: vi.fn().mockReturnValue({ stop: mockSpinnerStop }),
  createReadline: vi.fn().mockReturnValue({ question: mockQuestion, close: vi.fn() }),
}));

vi.mock('../../services/projects-service.js', () => ({
  ProjectsService: vi.fn().mockImplementation(() => ({
    listProjects: vi.fn().mockResolvedValue([]),
    openProject: vi.fn().mockResolvedValue({
      project: { name: 'test', path: '/tmp', configPath: '/tmp/c', sessionCount: 0, lastOpenedAt: '2025-01-01', createdAt: '2025-01-01' },
      config: mockConfig,
    }),
    createProject: vi.fn().mockResolvedValue({ name: 'test', path: '/tmp', configPath: '/tmp/c' }),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../services/skills-service.js', () => ({
  SkillsService: vi.fn().mockImplementation(() => ({
    loadSkills: vi.fn().mockResolvedValue(undefined),
    listSkills: vi.fn().mockReturnValue([]),
    getSkillPrompt: vi.fn().mockReturnValue(''),
  })),
}));

vi.mock('../../utils/format.js', () => ({
  formatAssistantMessage: (m: string) => m,
  formatUsage: () => 'usage',
}));

// ─── Import command registrars (after mocks are in place) ─────────────────────

import { registerStartCommand } from '../commands/start.js';
import { registerRunCommand } from '../commands/run.js';
import { registerServeCommand } from '../commands/serve.js';
import { registerProjectCommand } from '../commands/project.js';
import { registerSkillsCommand } from '../commands/skills.js';
import { registerConfigCommand } from '../commands/config.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProgram(): Command {
  const p = new Command();
  p.exitOverride();
  p.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  return p;
}

function registerAll(p: Command): void {
  registerStartCommand(p);
  registerRunCommand(p);
  registerServeCommand(p);
  registerProjectCommand(p);
  registerSkillsCommand(p);
  registerConfigCommand(p);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CLI', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadWithOverrides.mockResolvedValue({ ...mockConfig });
    mockSetupAgent.mockResolvedValue(mockAgentResult);
    mockQuestion.mockRejectedValue(new Error('readline closed'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  // ── 1. Command registration ──────────────────────────────────────────────

  describe('command registration', () => {
    it('registers all 6 subcommands on the program', () => {
      const program = makeProgram();
      registerAll(program);
      const names = program.commands.map((c) => c.name());
      expect(names).toEqual(expect.arrayContaining(['start', 'run', 'serve', 'project', 'skills', 'config']));
      expect(names).toHaveLength(6);
    });

    it('each subcommand has a description', () => {
      const program = makeProgram();
      registerAll(program);
      for (const cmd of program.commands) {
        expect(cmd.description().length).toBeGreaterThan(0);
      }
    });
  });

  // ── 2 & 3. Config command ───────────────────────────────────────────────

  describe('config command', () => {
    it('--init calls ConfigLoader.writeDefault', async () => {
      const program = makeProgram();
      registerConfigCommand(program);
      await program.parseAsync(['node', 'tolu', 'config', '--init']);
      expect(mockWriteDefault).toHaveBeenCalledWith('./tolu.config.json');
    });

    it('--show calls loadWithOverrides and outputs JSON', async () => {
      mockLoadWithOverrides.mockResolvedValue({ ...mockConfig });
      const program = makeProgram();
      registerConfigCommand(program);
      await program.parseAsync(['node', 'tolu', 'config', '--show']);
      expect(mockLoadWithOverrides).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalled();
      expect(String(logSpy.mock.calls[0][0])).toContain('test-model');
    });

    it('no flags does not call ConfigLoader methods', async () => {
      const program = makeProgram();
      registerConfigCommand(program);
      await program.parseAsync(['node', 'tolu', 'config']);
      expect(mockWriteDefault).not.toHaveBeenCalled();
      expect(mockLoadWithOverrides).not.toHaveBeenCalled();
    });
  });

  // ── 4. Error handling for missing args ──────────────────────────────────

  describe('error handling for missing args', () => {
    it('run without prompt argument throws', async () => {
      const program = makeProgram();
      registerRunCommand(program);
      await expect(
        program.parseAsync(['node', 'tolu', 'run']),
      ).rejects.toThrow();
    });

    it('project create without --dir throws', async () => {
      const program = makeProgram();
      registerProjectCommand(program);
      await expect(
        program.parseAsync(['node', 'tolu', 'project', 'create', 'x']),
      ).rejects.toThrow();
    });
  });

  // ── 5. Subcommand invocation ───────────────────────────────────────────

  describe('subcommand invocation', () => {
    it('serve outputs port info', async () => {
      const program = makeProgram();
      registerServeCommand(program);
      await program.parseAsync(['node', 'tolu', 'serve', '--port', '9999']);
      const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
      expect(output).toContain('9999');
    });

    it('serve with --tls flag outputs TLS enabled', async () => {
      const program = makeProgram();
      registerServeCommand(program);
      await program.parseAsync(['node', 'tolu', 'serve', '--tls']);
      const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
      expect(output).toContain('enabled');
    });

    it('run invokes setupAgent and prints result', async () => {
      const program = makeProgram();
      registerRunCommand(program);
      await program.parseAsync(['node', 'tolu', 'run', 'do stuff']);
      expect(mockSetupAgent).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalled();
    });

    it('project list completes without error', async () => {
      const program = makeProgram();
      registerProjectCommand(program);
      await program.parseAsync(['node', 'tolu', 'project', 'list']);
      expect(logSpy).toHaveBeenCalled();
    });

    it('skills list calls loadWithOverrides', async () => {
      const program = makeProgram();
      registerSkillsCommand(program);
      await program.parseAsync(['node', 'tolu', 'skills', 'list']);
      expect(mockLoadWithOverrides).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    });

    it('start enters REPL and exits cleanly on readline close', async () => {
      const program = makeProgram();
      registerStartCommand(program);
      await program.parseAsync(['node', 'tolu', 'start']);
      expect(mockSetupAgent).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls.map((c) => String(c[0])).join(' ');
      expect(output).toContain('Interactive Session');
    });
  });
});
