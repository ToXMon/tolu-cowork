/**
 * @tolu/cowork-core — Structured logger with colored output
 */

 import chalk from 'chalk';

 export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

 export interface LogEntry {
   level: LogLevel;
   message: string;
   timestamp: string;
   module?: string;
   data?: Record<string, unknown>;
 }

 const LEVEL_PRIORITY: Record<LogLevel, number> = {
   debug: 0,
   info: 1,
   warn: 2,
   error: 3,
   silent: 4,
 };

 const chalkColor: Record<Exclude<LogLevel, 'silent'>, (text: string) => string> = {
   debug: chalk.gray,
   info: chalk.white,
   warn: chalk.yellow,
   error: chalk.red,
 };

 function resolveLevel(env?: string): LogLevel {
   const normalized = (env ?? '').toLowerCase().trim();
   if (normalized in LEVEL_PRIORITY) return normalized as LogLevel;
   return 'info';
 }

 /**
  * Structured logger with colored output to stderr.
  *
  * ```typescript
  * const log = new Logger('my-module');
  * log.info('started');
  * log.debug('details', { key: 'value' });
  * const sub = log.child('sub'); // module = "my-module/sub"
  * ```
  */
 export class Logger {
   private level: LogLevel;
   private module: string;

   constructor(module: string, level?: LogLevel) {
     this.module = module;
     this.level = level ?? resolveLevel(process.env.TOLU_LOG_LEVEL);
   }

   /** Change the active log level at runtime. */
   setLevel(level: LogLevel): void {
     this.level = level;
   }

   /** Create a sub-logger with module path `parent.module/child`. */
   child(module: string): Logger {
     const childLogger = new Logger(`${this.module}/${module}`, this.level);
     return childLogger;
   }

   debug(message: string, data?: Record<string, unknown>): void {
     this.emit('debug', message, data);
   }

   info(message: string, data?: Record<string, unknown>): void {
     this.emit('info', message, data);
   }

   warn(message: string, data?: Record<string, unknown>): void {
     this.emit('warn', message, data);
   }

   error(message: string, data?: Record<string, unknown>): void {
     this.emit('error', message, data);
   }

   private emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
     if (level === 'silent' || this.level === 'silent') return;
     if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) return;

     const timestamp = new Date().toISOString();
     const colorize = chalkColor[level];
     const levelTag = level.toUpperCase().padEnd(5);
     const moduleTag = this.module;

     let line = `[${timestamp}] ${colorize(`[${levelTag}]`)} [${moduleTag}] ${colorize(message)}`;

     if (data && Object.keys(data).length > 0) {
       line += ' ' + JSON.stringify(data);
     }

     process.stderr.write(line + '\n');
   }
 }
