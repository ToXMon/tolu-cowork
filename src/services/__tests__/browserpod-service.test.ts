/**
 * @tolu/cowork-core — BrowserPod verification service tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserPodVerificationService } from '../browserpod-service.js';

describe('BrowserPodVerificationService', () => {
  let service: BrowserPodVerificationService;

  beforeEach(() => {
    service = new BrowserPodVerificationService({
      enabled: true,
      defaultTimeout: 60_000,
    });
  });

  describe('construction', () => {
    it('defaults to disabled', () => {
      const svc = new BrowserPodVerificationService();
      expect(svc.isActive()).toBe(false);
    });

    it('accepts enabled flag', () => {
      expect(service.isActive()).toBe(true);
    });
  });

  describe('createSession', () => {
    it('creates a session with correct defaults', () => {
      const session = service.createSession({
        task: 'Test task',
        files: { 'index.js': 'console.log("hello")' },
        command: 'node index.js',
        framework: 'node',
        timeout: 30_000,
      });

      expect(session.id).toBeTruthy();
      expect(session.active).toBe(false);
      expect(session.outputChunks).toBe(0);
      expect(session.result.buildStatus).toBe('pending');
      expect(session.result.success).toBe(false);
      expect(session.request.task).toBe('Test task');
    });

    it('generates unique session IDs', () => {
      const s1 = service.createSession({
        task: 'T1', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      const s2 = service.createSession({
        task: 'T2', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('startSession', () => {
    it('transitions to running', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.startSession(session.id);

      const result = service.getSession(session.id);
      expect(result.buildStatus).toBe('running');
    });

    it('throws for unknown session', () => {
      expect(() => service.startSession('nonexistent')).toThrow('not found');
    });
  });

  describe('appendOutput and getSession', () => {
    it('accumulates terminal output', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.startSession(session.id);
      service.appendOutput(session.id, 'line 1\n');
      service.appendOutput(session.id, 'line 2\n');

      const result = service.getSession(session.id);
      expect(result.terminalOutput).toBe('line 1\nline 2\n');
    });
  });

  describe('setPortal', () => {
    it('records portal URL and port', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.setPortal(session.id, 'https://abc.portal.browserpod.io', 3000);

      const result = service.getSession(session.id);
      expect(result.portalUrl).toBe('https://abc.portal.browserpod.io');
      expect(result.portal?.port).toBe(3000);
    });
  });

  describe('completeSession', () => {
    it('marks session as succeeded', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.startSession(session.id);
      service.completeSession(session.id, true);

      const result = service.getSession(session.id);
      expect(result.success).toBe(true);
      expect(result.buildStatus).toBe('success');
    });

    it('marks session as failed with error', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.startSession(session.id);
      service.completeSession(session.id, false, 'Build failed');

      const result = service.getSession(session.id);
      expect(result.success).toBe(false);
      expect(result.buildStatus).toBe('failed');
      expect(result.error).toBe('Build failed');
    });
  });

  describe('stopSession', () => {
    it('marks session as timed out', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.startSession(session.id);
      service.stopSession(session.id);

      const result = service.getSession(session.id);
      expect(result.buildStatus).toBe('timeout');
    });
  });

  describe('listSessions', () => {
    it('returns all sessions', () => {
      service.createSession({
        task: 'T1', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.createSession({
        task: 'T2', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });

      const sessions = service.listSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('cleanup', () => {
    it('removes inactive sessions older than maxAge', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.completeSession(session.id, true);

      const removed = service.cleanup(0);
      expect(removed).toBe(1);
      expect(service.listSessions()).toHaveLength(0);
    });

    it('preserves active sessions', () => {
      const session = service.createSession({
        task: 'Test', files: {}, command: 'ls', framework: 'node', timeout: 1000,
      });
      service.startSession(session.id);

      const removed = service.cleanup(0);
      expect(removed).toBe(0);
      expect(service.listSessions()).toHaveLength(1);
    });
  });

  describe('getSessionFull', () => {
    it('returns full session with request metadata', () => {
      const session = service.createSession({
        task: 'Full test',
        files: { 'a.js': '1' },
        command: 'node a.js',
        framework: 'node',
        timeout: 5000,
      });

      const full = service.getSessionFull(session.id);
      expect(full.request.task).toBe('Full test');
      expect(full.request.files).toEqual({ 'a.js': '1' });
      expect(full.active).toBe(false);
    });
  });

  describe('error cases', () => {
    it('getSession throws for unknown ID', () => {
      expect(() => service.getSession('bad')).toThrow('not found');
    });

    it('appendOutput throws for unknown ID', () => {
      expect(() => service.appendOutput('bad', 'x')).toThrow('not found');
    });

    it('setPortal throws for unknown ID', () => {
      expect(() => service.setPortal('bad', 'url', 80)).toThrow('not found');
    });

    it('completeSession throws for unknown ID', () => {
      expect(() => service.completeSession('bad', true)).toThrow('not found');
    });

    it('stopSession throws for unknown ID', () => {
      expect(() => service.stopSession('bad')).toThrow('not found');
    });
  });
});
