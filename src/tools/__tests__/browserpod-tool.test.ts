/**
 * @tolu/cowork-core — BrowserPod verification tool tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createBrowserPodTool } from '../browserpod-tool.js';
import { BrowserPodVerificationService } from '../../services/browserpod-service.js';
import type { ToolExecutionContext } from '../tool-interface.js';

const mockContext: ToolExecutionContext = {
  workingDirectory: '/tmp/test',
  sessionId: 'test-session',
};

describe('createBrowserPodTool', () => {
  describe('when service is disabled', () => {
    const service = new BrowserPodVerificationService({ enabled: false });
    const tool = createBrowserPodTool(service);

    it('has correct name', () => {
      expect(tool.name).toBe('browserpod_verify');
    });

    it('has description', () => {
      expect(tool.description).toContain('live browser sandbox');
    });

    it('has parameter schema', () => {
      expect(tool.parameterSchema.type).toBe('object');
      expect(tool.parameterSchema.required).toContain('files');
      expect(tool.parameterSchema.required).toContain('command');
    });

    it('returns error when BrowserPod is disabled', async () => {
      const result = await tool.execute(
        { files: { 'a.js': '1' }, command: 'node a.js' },
        mockContext,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('not enabled'),
      });
    });
  });

  describe('when service is enabled', () => {
    let service: BrowserPodVerificationService;
    let tool: ReturnType<typeof createBrowserPodTool>;

    beforeEach(() => {
      service = new BrowserPodVerificationService({ enabled: true });
      tool = createBrowserPodTool(service);
    });

    it('rejects invalid arguments', async () => {
      const result = await tool.execute({}, mockContext);
      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: expect.stringContaining('Invalid arguments'),
      });
    });

    it('rejects missing files', async () => {
      const result = await tool.execute(
        { command: 'node a.js' },
        mockContext,
      );
      expect(result.isError).toBe(true);
    });

    it('rejects missing command', async () => {
      const result = await tool.execute(
        { files: { 'a.js': '1' } },
        mockContext,
      );
      expect(result.isError).toBe(true);
    });

    it('creates a verification session', async () => {
      const result = await tool.execute(
        {
          files: { 'index.js': 'console.log("hello")' },
          command: 'node index.js',
          framework: 'node',
          task: 'Test verify',
        },
        mockContext,
      );

      expect(result.isError).toBe(false);
      expect(result.toolName).toBe('browserpod_verify');

      const body = JSON.parse(
        (result.content[0] as { text: string }).text,
      );
      expect(body.sessionId).toBeTruthy();
      expect(body.status).toBe('pending');
      expect(body.filesWritten).toBe(1);
      expect(body.command).toBe('node index.js');
      expect(body.framework).toBe('node');
    });

    it('defaults framework to auto', async () => {
      const result = await tool.execute(
        {
          files: { 'a.js': '1' },
          command: 'npm start',
        },
        mockContext,
      );

      expect(result.isError).toBe(false);
      const body = JSON.parse(
        (result.content[0] as { text: string }).text,
      );
      expect(body.framework).toBe('auto');
    });

    it('uses default task when not provided', async () => {
      const result = await tool.execute(
        {
          files: { 'a.js': '1' },
          command: 'npm start',
        },
        mockContext,
      );

      const body = JSON.parse(
        (result.content[0] as { text: string }).text,
      );
      expect(body.message).toContain('Verification session created');
    });

    it('tracks duration', async () => {
      const result = await tool.execute(
        {
          files: { 'a.js': '1' },
          command: 'node a.js',
        },
        mockContext,
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });
});
