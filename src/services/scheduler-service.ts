/**
 * @tolu/cowork-core — SchedulerService
 *
 * Cron-based task scheduler for automated agent prompts.
 * Stores scheduled tasks persistently and manages cron execution.
 */

import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import cron from 'node-cron';
import { Logger } from '../utils/logger.js';

const logger = new Logger('scheduler-service');

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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Default path for persistent task storage. */
function defaultTasksFile(): string {
  return join(homedir(), '.tolu', 'scheduler', 'tasks.json');
}

/**
 * Calculate the next run time from a cron expression.
 *
 * Uses a simple iterative approach: check each minute for the next 5 years.
 *
 * @param expression - Cron expression.
 * @returns Epoch ms of the next scheduled run, or undefined if none found.
 */
function calculateNextRun(expression: string): number | undefined {
  if (!cron.validate(expression)) return undefined;

  // node-cron doesn't expose a "next run" calculator directly.
  // We iterate forward in 1-minute increments for up to 366 days.
  const now = new Date();
  const maxDate = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);

  // Start checking from the next full minute
  const start = new Date(now);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  // Parse cron fields
  const fields = expression.trim().split(/\s+/);

  // Check each minute until we find one that matches
  for (let d = new Date(start); d < maxDate; d.setMinutes(d.getMinutes() + 1)) {
    if (cronTimeMatch(fields, d)) {
      return d.getTime();
    }
  }

  return undefined;
}

/**
 * Check if a parsed cron expression matches a given date.
 *
 * Simplified implementation supporting standard 5-field cron.
 */
function cronTimeMatch(fields: string[], date: Date): boolean {
  if (fields.length !== 5) return false;

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;

  return (
    fieldMatches(minuteField, date.getMinutes(), 0, 59) &&
    fieldMatches(hourField, date.getHours(), 0, 23) &&
    fieldMatches(dayOfMonthField, date.getDate(), 1, 31) &&
    fieldMatches(monthField, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dayOfWeekField, date.getDay(), 0, 6)
  );
}

/** Check if a single cron field matches a value. */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;

  // Handle step values (e.g. */5)
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step === 0) return false;
    return value % step === 0;
  }

  // Handle ranges (e.g. 1-5)
  if (field.includes('-')) {
    const parts = field.split('-');
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // Handle lists (e.g. 1,3,5)
  if (field.includes(',')) {
    const items = field.split(',').map((s) => parseInt(s, 10));
    return items.includes(value);
  }

  // Single value
  const parsed = parseInt(field, 10);
  return !isNaN(parsed) && parsed === value;
}

// ─── SchedulerService ───────────────────────────────────────────────────────

/**
 * Cron-based task scheduler for automated agent prompts.
 *
 * Stores tasks in ~/.tolu/scheduler/tasks.json and manages cron
 * execution using node-cron. Emits events for task lifecycle.
 */
export class SchedulerService extends EventEmitter {
  private readonly tasksFile: string;
  private tasks: Map<string, ScheduledTask> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private running = false;

  /**
   * Create a new SchedulerService.
   *
   * @param tasksFile - Optional override path for tasks storage file.
   */
  constructor(tasksFile?: string) {
    super();
    this.tasksFile = resolve(tasksFile ?? defaultTasksFile());
  }

  /**
   * Load tasks from persistent storage.
   */
  private async loadTasks(): Promise<void> {
    try {
      const raw = await fs.readFile(this.tasksFile, 'utf-8');
      const parsed = JSON.parse(raw) as ScheduledTask[];
      this.tasks.clear();
      for (const task of parsed) {
        this.tasks.set(task.id, task);
      }
      logger.debug(`Loaded ${this.tasks.size} task(s) from storage`);
    } catch {
      this.tasks.clear();
    }
  }

  /**
   * Persist current tasks to storage.
   */
  private async saveTasks(): Promise<void> {
    const dir = dirname(this.tasksFile);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.tasks.values()), null, 2) + '\n';
    await fs.writeFile(this.tasksFile, data, 'utf-8');
  }

  /**
   * Add a new scheduled task.
   *
   * @param task - Task data without id, createdAt, lastRun, and nextRun.
   * @returns The newly created ScheduledTask.
   * @throws InvalidCronError if the cron expression is invalid.
   */
  async addTask(
    task: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRun' | 'nextRun'>,
  ): Promise<ScheduledTask> {
    if (!cron.validate(task.cron)) {
      throw new InvalidCronError(task.cron);
    }

    const now = Date.now();
    const newTask: ScheduledTask = {
      ...task,
      id: crypto.randomUUID(),
      createdAt: now,
      nextRun: calculateNextRun(task.cron),
    };

    this.tasks.set(newTask.id, newTask);
    await this.saveTasks();

    // Schedule immediately if the scheduler is running
    if (this.running && newTask.enabled) {
      this.scheduleTask(newTask);
    }

    logger.info('Task added', { id: newTask.id, name: newTask.name, cron: newTask.cron });
    return newTask;
  }

  /**
   * Remove a scheduled task by ID.
   *
   * @param id - Task ID to remove.
   * @throws TaskNotFoundError if the task does not exist.
   */
  async removeTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }

    this.stopTask(id);
    this.tasks.delete(id);
    await this.saveTasks();

    logger.info('Task removed', { id, name: task.name });
  }

  /**
   * Enable a disabled task.
   *
   * @param id - Task ID to enable.
   * @throws TaskNotFoundError if the task does not exist.
   */
  async enableTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }

    task.enabled = true;
    task.nextRun = calculateNextRun(task.cron);
    await this.saveTasks();

    if (this.running) {
      this.scheduleTask(task);
    }

    logger.info('Task enabled', { id, name: task.name });
  }

  /**
   * Disable an enabled task.
   *
   * @param id - Task ID to disable.
   * @throws TaskNotFoundError if the task does not exist.
   */
  async disableTask(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }

    task.enabled = false;
    task.nextRun = undefined;
    this.stopTask(id);
    await this.saveTasks();

    logger.info('Task disabled', { id, name: task.name });
  }

  /**
   * List all scheduled tasks.
   *
   * @returns Array of all tasks.
   */
  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get a task by ID.
   *
   * @param id - Task ID.
   * @returns The task, or undefined if not found.
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Start the cron scheduler.
   *
   * Loads tasks from storage and schedules all enabled tasks.
   */
  async start(): Promise<void> {
    if (this.running) return;

    await this.loadTasks();
    this.running = true;

    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }

    logger.info(`Scheduler started with ${this.cronJobs.size} active job(s)`);
  }

  /**
   * Stop the scheduler and all running cron jobs.
   */
  stop(): void {
    for (const [id, job] of this.cronJobs) {
      job.stop();
      logger.debug('Stopped cron job', { id });
    }
    this.cronJobs.clear();
    this.running = false;

    logger.info('Scheduler stopped');
  }

  /**
   * Trigger immediate execution of a task.
   *
   * Logs the execution and emits events. Actual agent execution
   * requires provider setup from the CLI layer.
   *
   * @param id - Task ID to run immediately.
   * @throws TaskNotFoundError if the task does not exist.
   */
  async runTaskNow(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }

    this.emit('taskStart', task);
    logger.info('Task executing', { id, name: task.name, prompt: task.prompt });

    try {
      // Actual agent execution happens at the CLI layer.
      // This service handles scheduling and lifecycle events.
      task.lastRun = Date.now();
      task.nextRun = calculateNextRun(task.cron);
      await this.saveTasks();

      this.emit('taskComplete', task);
      logger.info('Task completed', { id, name: task.name });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('taskError', task, error);
      logger.error('Task failed', { id, name: task.name, error: error.message });
    }
  }

  /**
   * Schedule a single task's cron job.
   */
  private scheduleTask(task: ScheduledTask): void {
    // Stop existing job for this task if any
    this.stopTask(task.id);

    if (!cron.validate(task.cron)) {
      logger.warn('Skipping task with invalid cron', { id: task.id, cron: task.cron });
      return;
    }

    const job = cron.schedule(task.cron, () => {
      this.runTaskNow(task.id).catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.emit('taskError', task, error);
      });
    });

    this.cronJobs.set(task.id, job);
    logger.debug('Scheduled cron job', { id: task.id, cron: task.cron });
  }

  /**
   * Stop a single task's cron job.
   */
  private stopTask(id: string): void {
    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }
  }
}
