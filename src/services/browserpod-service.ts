/**
 * @tolu/cowork-core — BrowserPod Verification Service
 *
 * Manages verification sessions for live browser-based code verification.
 * The core manages sessions and state; the web UI handles actual
 * BrowserPod SDK interaction via the session API.
 *
 * Graceful degradation: works WITHOUT BrowserPod (Docker-only mode).
 */

import { randomUUID } from 'node:crypto';
import { Logger } from '../utils/logger.js';
import type {
  VerificationRequest,
  VerificationResult,
  VerificationSession,
  VerificationFramework,
} from '../types/verification-types.js';
import { FRAMEWORK_CONFIGS } from '../types/verification-types.js';

const logger = new Logger('browserpod-service');

// ─── Session Store ────────────────────────────────────────────────────────────

/** In-memory session storage. Replace with Redis/DB for persistence. */
class SessionStore {
  private sessions = new Map<string, VerificationSession>();
  private outputBuffers = new Map<string, string[]>();

  set(session: VerificationSession): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): VerificationSession | undefined {
    return this.sessions.get(id);
  }

  getAll(): VerificationSession[] {
    return [...this.sessions.values()];
  }

  delete(id: string): boolean {
    this.outputBuffers.delete(id);
    return this.sessions.delete(id);
  }

  appendOutput(sessionId: string, chunk: string): void {
    const buffer = this.outputBuffers.get(sessionId) ?? [];
    buffer.push(chunk);
    this.outputBuffers.set(sessionId, buffer);
  }

  getOutput(sessionId: string): string {
    return (this.outputBuffers.get(sessionId) ?? []).join('');
  }

  /** Remove sessions older than maxAge ms. Returns count removed. */
  cleanup(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (!session.active && session.result.completedAt <= cutoff) {
        this.sessions.delete(id);
        this.outputBuffers.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

// ─── Output Stream ────────────────────────────────────────────────────────────

/** Async iterable that yields output chunks for a session. */
async function* streamOutput(
  store: SessionStore,
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  let offset = 0;
  while (!signal?.aborted) {
    const session = store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const output = store.getOutput(sessionId);
    if (output.length > offset) {
      yield output.slice(offset);
      offset = output.length;
    }

    if (!session.active) break;

    // Backpressure: wait 100ms before polling again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// ─── BrowserPod Verification Service ─────────────────────────────────────────

export class BrowserPodVerificationService {
  private store = new SessionStore();
  private enabled: boolean;
  private defaultTimeout: number;

  constructor(opts?: {
    enabled?: boolean;
    defaultTimeout?: number;
  }) {
    this.enabled = opts?.enabled ?? false;
    this.defaultTimeout = opts?.defaultTimeout ?? 60_000;
  }

  /** Whether BrowserPod verification is available. */
  isActive(): boolean {
    return this.enabled;
  }

  /** Create a new verification session. */
  createSession(request: VerificationRequest): VerificationSession {
    const id = randomUUID();
    const now = Date.now();
    const frameworkConfig = FRAMEWORK_CONFIGS[request.framework];

    const session: VerificationSession = {
      id,
      request,
      result: {
        sessionId: id,
        success: false,
        terminalOutput: '',
        buildStatus: 'pending',
        startedAt: now,
        completedAt: now,
      },
      active: false,
      outputChunks: 0,
    };

    this.store.set(session);
    logger.info(`Session ${id} created: ${request.task} (${frameworkConfig.framework})`);
    return session;
  }

  /** Start verification for a session. */
  startSession(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.active = true;
    session.result.buildStatus = 'running';
    this.store.set(session);
    logger.info(`Session ${sessionId} started`);
  }

  /** Get session status and results. */
  getSession(sessionId: string): VerificationResult {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return {
      ...session.result,
      terminalOutput: this.store.getOutput(sessionId),
    };
  }

  /** Get full session including request metadata. */
  getSessionFull(sessionId: string): VerificationSession {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session;
  }

  /** List all sessions. */
  listSessions(): VerificationResult[] {
    return this.store.getAll().map((s) => ({
      ...s.result,
      terminalOutput: this.store.getOutput(s.id),
    }));
  }

  /** Append output to a running session. Called by web UI bridge. */
  appendOutput(sessionId: string, chunk: string): void {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.store.appendOutput(sessionId, chunk);
    session.outputChunks++;
  }

  /** Update session portal URL. Called when BrowserPod fires onPortal. */
  setPortal(sessionId: string, url: string, port: number): void {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.result.portalUrl = url;
    session.result.portal = {
      url,
      port,
      discoveredAt: Date.now(),
    };
    this.store.set(session);
    logger.info(`Session ${sessionId} portal: ${url} (port ${port})`);
  }

  /** Complete a session with success/failure. */
  completeSession(sessionId: string, success: boolean, error?: string): void {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.active = false;
    session.result.success = success;
    session.result.buildStatus = success ? 'success' : 'failed';
    session.result.error = error;
    session.result.completedAt = Date.now();
    session.result.terminalOutput = this.store.getOutput(sessionId);
    this.store.set(session);
    logger.info(`Session ${sessionId} completed: ${success ? 'success' : 'failed'}`);
  }

  /** Stream terminal output for a session. */
  streamOutput(sessionId: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
    return streamOutput(this.store, sessionId, signal);
  }

  /** Stop a running verification. */
  stopSession(sessionId: string): void {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.active = false;
    session.result.buildStatus = 'timeout';
    session.result.completedAt = Date.now();
    session.result.terminalOutput = this.store.getOutput(sessionId);
    this.store.set(session);
    logger.info(`Session ${sessionId} stopped`);
  }

  /** Clean up completed sessions older than maxAge ms. */
  cleanup(maxAge: number): number {
    const removed = this.store.cleanup(maxAge);
    logger.info(`Cleaned up ${removed} expired sessions`);
    return removed;
  }
}
