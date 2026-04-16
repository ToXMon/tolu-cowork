import { z } from 'zod';

export const ToluConfigSchema = z.object({
  provider: z.object({
    baseUrl: z.string().url(),
    apiKey: z.string().optional(),
    model: z.string().default('gpt-4o'),
    provider: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().positive().optional(),
    reasoning: z
      .union([z.boolean(), z.enum(['minimal', 'low', 'medium', 'high'])])
      .optional(),
    costRates: z
      .object({
        inputPer1M: z.number(),
        outputPer1M: z.number(),
        cacheReadPer1M: z.number().optional(),
        cacheWritePer1M: z.number().optional(),
      })
      .optional(),
  }),
  workspace: z
    .object({
      root: z.string().default('.'),
      additionalRoots: z.array(z.string()).default([]),
    })
    .default({}),
  sandbox: z
    .object({
      level: z.enum(['none', 'path-only', 'docker']).default('path-only'),
      docker: z
        .object({
          image: z.string().default('ubuntu:22.04'),
          containerName: z.string().optional(),
        })
        .optional(),
      timeout: z.number().default(120),
    })
    .default({}),
  tools: z
    .object({
      enabled: z
        .array(z.string())
        .default([
          'read_file',
          'write_file',
          'edit_file',
          'list_directory',
          'bash',
          'grep',
          'find',
          'glob',
          'web_search',
          'web_fetch',
        ]),
      disabled: z.array(z.string()).default([]),
      custom: z.array(z.object({ module: z.string() })).default([]),
    })
    .default({}),
  skills: z
    .object({
      directories: z.array(z.string()).default(['./skills']),
    })
    .default({}),
  security: z
    .object({
      auditLogging: z.boolean().default(true),
      rateLimiting: z.boolean().default(true),
      encryptionKey: z.string().optional(),
    })
    .default({}),
  agent: z
    .object({
      systemPrompt: z.string().optional(),
      maxTurns: z.number().default(50),
      toolExecution: z
        .enum(['sequential', 'parallel'])
        .default('parallel'),
    })
    .default({}),
  browserpod: z
    .object({
      enabled: z.boolean().default(false),
      apiKey: z.string().optional(),
      nodeVersion: z.string().default('22'),
      storageKey: z.string().optional(),
      defaultTimeout: z.number().default(60_000),
      frameworks: z
        .array(z.enum(['nextjs', 'express', 'react', 'static', 'node', 'auto']))
        .default(['nextjs', 'express', 'react', 'static', 'node', 'auto']),
    })
    .default({}),
});

export type ToluConfig = z.infer<typeof ToluConfigSchema>;
