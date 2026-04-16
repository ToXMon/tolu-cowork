/**
 * @tolu/cowork-core — BrowserPod verification tool
 *
 * Tool the Tolu Agent can use to verify its own output
 * in a live browser sandbox. Creates a verification session
 * and returns the Portal URL for live preview.
 */

import { z } from 'zod';
import type { ToluContent } from '../types/index.js';
import type {
  ToluToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './tool-interface.js';
import { BrowserPodVerificationService } from '../services/browserpod-service.js';
import type { VerificationFramework } from '../types/verification-types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function textContent(text: string): ToluContent {
  return { type: 'text', text };
}

function errorContent(message: string): ToluContent {
  return { type: 'text', text: `Error: ${message}` };
}

const VALID_FRAMEWORKS: VerificationFramework[] = [
  'nextjs', 'express', 'react', 'static', 'node', 'auto',
];

// ─── Parameter Schema ────────────────────────────────────────────────────────

const BrowserPodParamsSchema = z.object({
  files: z.record(z.string(), z.string()).describe(
    'Map of filename to file content',
  ),
  command: z.string().min(1).describe(
    'Command to run (e.g. "npm run dev")',
  ),
  framework: z.enum(['nextjs', 'express', 'react', 'static', 'node', 'auto'])
    .default('auto')
    .describe('Framework hint for optimization'),
  task: z.string().optional().describe(
    'Human-readable task description',
  ),
  timeout: z.number().int().min(5000).max(300_000).optional().describe(
    'Verification timeout in ms (default 60000)',
  ),
});

// ─── Tool Factory ─────────────────────────────────────────────────────────────

/**
 * Create a BrowserPod verification tool bound to a service instance.
 *
 * @param service - The verification service managing sessions.
 * @returns Tool definition for registration with the agent.
 */
export function createBrowserPodTool(
  service: BrowserPodVerificationService,
): ToluToolDefinition {
  return {
    name: 'browserpod_verify',
    description:
      'Verify code output in a live browser sandbox. ' +
      'Creates a verification session, writes files, runs the command, ' +
      'and returns a Portal URL for live preview. ' +
      'Requires BrowserPod to be enabled in configuration.',
    parameters: BrowserPodParamsSchema,
    parameterSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'object',
          description: 'Map of filename to file content',
          additionalProperties: { type: 'string' },
        },
        command: {
          type: 'string',
          description: 'Command to run (e.g. "npm run dev")',
        },
        framework: {
          type: 'string',
          enum: VALID_FRAMEWORKS,
          description: 'Framework hint (default: auto)',
        },
        task: {
          type: 'string',
          description: 'Human-readable task description',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in ms (5000-300000, default 60000)',
        },
      },
      required: ['files', 'command'],
    },
    async execute(
      args: Record<string, unknown>,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      const start = Date.now();
      const parsed = BrowserPodParamsSchema.safeParse(args);
      if (!parsed.success) {
        return {
          toolCallId: '',
          toolName: 'browserpod_verify',
          content: [errorContent(
            `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
          )],
          isError: true,
          duration: Date.now() - start,
        };
      }

      const { files, command, framework, task, timeout } = parsed.data;

      if (!service.isActive()) {
        return {
          toolCallId: '',
          toolName: 'browserpod_verify',
          content: [errorContent(
            'BrowserPod verification is not enabled. ' +
            'Set browserpod.enabled=true in config and provide an API key.',
          )],
          isError: true,
          duration: Date.now() - start,
        };
      }

      try {
        const session = service.createSession({
          task: task ?? `Verify: ${command}`,
          files,
          command,
          framework,
          timeout: timeout ?? 60_000,
        });

        // Session created — the web UI will pick it up and run
        // BrowserPod SDK to execute the command.
        // Return the session ID so the UI can connect.
        const result = service.getSession(session.id);

        return {
          toolCallId: '',
          toolName: 'browserpod_verify',
          content: [textContent(
            JSON.stringify({
              sessionId: session.id,
              status: result.buildStatus,
              message: 'Verification session created. ' +
                'The web UI will execute the command in BrowserPod.',
              filesWritten: Object.keys(files).length,
              command,
              framework,
            }, null, 2),
          )],
          isError: false,
          duration: Date.now() - start,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          toolCallId: '',
          toolName: 'browserpod_verify',
          content: [errorContent(message)],
          isError: true,
          duration: Date.now() - start,
        };
      }
    },
  };
}
