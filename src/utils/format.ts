/**
 * @tolu/cowork-core — Output formatting utilities for terminal display
 */

import chalk from 'chalk';
import type { ToluContent, ToluAssistantMessage, ToluUsage } from '../types/index.js';
import type { ToolExecutionResult } from '../tools/tool-interface.js';

/**
 * Format an array of ToluContent blocks into a terminal-friendly string.
 *
 * Handles all content variants: text, thinking, image, and tool calls.
 * Each block type is visually distinguished with color coding.
 */
export function formatContent(content: ToluContent[]): string {
  const parts: string[] = [];

  for (const block of content) {
    switch (block.type) {
      case 'text': {
        parts.push(block.text);
        break;
      }
      case 'thinking': {
        const label = block.redacted ? 'Thinking (redacted)' : 'Thinking';
        parts.push(chalk.dim.gray(`[${label}] ${block.thinking}`));
        break;
      }
      case 'image': {
        const byteSize = Buffer.byteLength(block.data, 'base64');
        parts.push(chalk.gray(`[Image: ${block.mimeType}, ${byteSize} bytes]`));
        break;
      }
      case 'toolCall': {
        const argsStr = JSON.stringify(block.arguments);
        const truncatedArgs = truncate(argsStr, 200);
        parts.push(chalk.cyan(`[Tool: ${block.name}]`) + ' ' + chalk.gray(truncatedArgs));
        break;
      }
    }
  }

  return parts.join('\n');
}

/**
 * Format a ToluAssistantMessage for terminal display.
 *
 * Includes model info, content blocks, stop reason, and optional error.
 */
export function formatAssistantMessage(msg: ToluAssistantMessage): string {
  const lines: string[] = [];

  lines.push(chalk.bold(`Assistant (${msg.model})`));
  lines.push(formatContent(msg.content));

  if (msg.errorMessage) {
    lines.push(chalk.red(`Error: ${msg.errorMessage}`));
  }

  lines.push(chalk.gray(`Stop: ${msg.stopReason}`));

  if (msg.usage) {
    lines.push(chalk.gray(formatUsage(msg.usage)));
  }

  return lines.join('\n');
}

/**
 * Format a tool execution result for display.
 *
 * Shows tool name, duration, and content. Errors are highlighted in red.
 */
export function formatToolResult(result: ToolExecutionResult): string {
  const lines: string[] = [];
  const tag = result.isError
    ? chalk.red(`[Tool Error: ${result.toolName}]`)
    : chalk.cyan(`[Tool: ${result.toolName}]`);

  lines.push(`${tag} (${result.duration}ms)`);
  lines.push(formatContent(result.content));

  return lines.join('\n');
}

/**
 * Format usage and cost information for display.
 *
 * Shows token counts and dollar costs when available.
 */
export function formatUsage(usage: ToluUsage): string {
  const parts: string[] = [];

  parts.push(`Tokens: ${usage.totalTokens} (in: ${usage.input}, out: ${usage.output}`);
  if (usage.cacheRead > 0) parts.push(`cache_read: ${usage.cacheRead}`);
  if (usage.cacheWrite > 0) parts.push(`cache_write: ${usage.cacheWrite}`);
  parts.push(')');

  if (usage.cost) {
    parts.push(` Cost: $${usage.cost.total.toFixed(6)}`);
    const costDetails: string[] = [];
    if (usage.cost.input > 0) costDetails.push(`in: $${usage.cost.input.toFixed(6)}`);
    if (usage.cost.output > 0) costDetails.push(`out: $${usage.cost.output.toFixed(6)}`);
    if (usage.cost.cacheRead > 0) costDetails.push(`cache_read: $${usage.cost.cacheRead.toFixed(6)}`);
    if (usage.cost.cacheWrite > 0) costDetails.push(`cache_write: $${usage.cost.cacheWrite.toFixed(6)}`);
    if (costDetails.length > 0) {
      parts.push(` (${costDetails.join(', ')})`);
    }
  }

  return parts.join('');
}

/**
 * Truncate a string to a maximum length, appending an ellipsis if truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Indent every line of a multiline string by the given number of spaces.
 */
export function indent(str: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return str
    .split('\n')
    .map((line) => prefix + line)
    .join('\n');
}
