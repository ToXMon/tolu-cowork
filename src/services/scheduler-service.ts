/**
 * @tolu/cowork-core — SchedulerService
 * Cron-based task scheduler for automated agent prompts.
 */

import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import cron from 'node-cron';
import { Logger } from '../utils/logger.js';
import { calculateNextRun } from './scheduler-cron.js';
import type { ScheduledTask, SchedulerEvents } from './scheduler-task.js';
import { TaskNotFoundError, InvalidCronError } from './scheduler-task.js';

// Re-export types and error classes for backward compatibility
export type { ScheduledTask, SchedulerEvents } from './scheduler-task.js';
export { TaskNotFoundError, InvalidCronError } from './scheduler-task.js';

const logger = new Logger('scheduler-service');

/** Default path for persistent task storage. */
function defaultTasksFile(): string {
  return resolve(join(homedir(), '.tolu', 'scheduler', 'tasks.json'));
}

/** Cron-based task scheduler. Stores tasks in ~/.tolu/scheduler/tasks.json. */
export class SchedulerService extends EventEmitter {
  private readonly tasksFile: string;
  private tasks: Map<string, ScheduledTask> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private running = false;

  constructor(tasksFile?: string) {
    super();
    this.tasksFile = resolve(tasksFile ?? defaultTasksFile());
  }

  /** Load tasks from persistent storage. */
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

  /** Persist current tasks to storage. */
  private async saveTasks(): Promise<void> {
    const dir = dirname(this.tasksFile);
    await fs.mkdir(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.tasks.values()), null, 2) + '\n';
    await fs.writeFile(this.tasksFile, data, 'utf-8');
  }

  /** Add a new scheduled task. @throws InvalidCronError */
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
    if (this.running && newTask.enabled) {
      this.scheduleTask(newTask);
    }
    logger.info('Task added', { id: newTask.id, name: newTask.name, cron: newTask.cron });
    return newTask;
  }

  /** Remove a scheduled task by ID. @throws TaskNotFoundError */
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

  /** Enable a disabled task. @throws TaskNotFoundError */
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

  /** Disable an enabled task. @throws TaskNotFoundError */
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

  /** List all scheduled tasks. */
  listTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /** Get a task by ID. */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /** Start the scheduler. Loads tasks and schedules all enabled ones. */
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

  /** Stop the scheduler and all running cron jobs. */
  stop(): void {
    for (const [id, job] of this.cronJobs) {
      job.stop();
      logger.debug('Stopped cron job', { id });
    }
    this.cronJobs.clear();
    this.running = false;
    logger.info('Scheduler stopped');
  }

  /** Trigger immediate execution of a task. @throws TaskNotFoundError */
  async runTaskNow(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    this.emit('taskStart', task);
    logger.info('Task executing', { id, name: task.name, prompt: task.prompt });
    try {
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

  /** Schedule a single task's cron job. */
  private scheduleTask(task: ScheduledTask): void {
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

  /** Stop a single task's cron job. */
  private stopTask(id: string): void {
    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }
  }
}
