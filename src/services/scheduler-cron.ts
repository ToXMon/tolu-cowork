/**
 * @tolu/cowork-core — Scheduler Cron Utilities
 *
 * Cron expression parsing and next-run calculation.
 */

import cron from 'node-cron';

/**
 * Calculate the next run time from a cron expression.
 *
 * Uses a simple iterative approach: check each minute for the next 366 days.
 *
 * @param expression - Cron expression.
 * @returns Epoch ms of the next scheduled run, or undefined if none found.
 */
export function calculateNextRun(expression: string): number | undefined {
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
export function cronTimeMatch(fields: string[], date: Date): boolean {
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
export function fieldMatches(field: string, value: number, min: number, max: number): boolean {
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
