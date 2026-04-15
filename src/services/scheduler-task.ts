/**
 * @tolu/cowork-core — Scheduler Types & Error Classes
 *
 * Task definition types and error classes for the scheduler module.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** A scheduled task that triggers an agent prompt on a cron schedule. */
export interface ScheduledTask {
  /** Unique task identifier. */
  id: string;
  /** Human-readable task name. */
  name: string;
  /** Cron expression (e.g. "0 9 * * *" for daily at 9am). */
  cron: string;
  /** The prompt to send to the agent when the task fires. */
  prompt: string;
  /** Optional project to run the task in. */
  projectId?: string;
  /** Whether the task is active. */
  enabled: boolean;
  /** Epoch ms of the last successful run. */
  lastRun?: number;
  /** Epoch ms of the next scheduled run. */
  nextRun?: number;
  /** Epoch ms when the task was created. */
  createdAt: number;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Events emitted by SchedulerService. */
export interface SchedulerEvents {
  /** Fired when a task begins execution. */
  taskStart: (task: ScheduledTask) => void;
  /** Fired when a task completes successfully. */
  taskComplete: (task: ScheduledTask) => void;
  /** Fired when a task encounters an error. */
  taskError: (task: ScheduledTask, error: Error) => void;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Thrown when a scheduled task is not found. */
export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`Scheduled task not found: ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

/** Thrown when a cron expression is invalid. */
export class InvalidCronError extends Error {
  constructor(expression: string) {
    super(`Invalid cron expression: "${expression}"`);
    this.name = 'InvalidCronError';
  }
}
