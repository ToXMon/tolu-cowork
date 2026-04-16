/**
 * @tolu/cowork-core — BrowserPod verification types
 *
 * Defines interfaces for the live verification layer.
 * The core manages sessions and state; the web UI
 * handles actual BrowserPod SDK interaction.
 */

// ─── Build Status ────────────────────────────────────────────────────────────

export type BuildStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout';

// ─── Test Result ─────────────────────────────────────────────────────────────

export interface TestResult {
  /** Test suite or file name. */
  name: string;
  /** pass | fail | skip */
  status: 'pass' | 'fail' | 'skip';
  /** Duration in milliseconds. */
  duration: number;
  /** Error message if status is 'fail'. */
  error?: string;
}

// ─── Portal Info ─────────────────────────────────────────────────────────────

export interface PortalInfo {
  /** Public URL for the running service (e.g. https://abc.portal.browserpod.io). */
  url: string;
  /** Port number inside the pod. */
  port: number;
  /** When this portal was discovered. */
  discoveredAt: number;
}

// ─── Verification Request ────────────────────────────────────────────────────

export interface VerificationRequest {
  /** Human-readable task description. */
  task: string;
  /** Map of filename to file content. */
  files: Record<string, string>;
  /** Command to run (e.g. 'npm run dev'). */
  command: string;
  /** Framework hint for optimization. */
  framework: VerificationFramework;
  /** Max verification time in milliseconds. */
  timeout: number;
}

// ─── Verification Framework ──────────────────────────────────────────────────

export type VerificationFramework =
  | 'nextjs'
  | 'express'
  | 'react'
  | 'static'
  | 'node'
  | 'auto';

// ─── Verification Result ─────────────────────────────────────────────────────

export interface VerificationResult {
  /** Session ID this result belongs to. */
  sessionId: string;
  /** Whether verification succeeded. */
  success: boolean;
  /** BrowserPod Portal URL for live preview. */
  portalUrl?: string;
  /** Captured terminal output. */
  terminalOutput: string;
  /** Individual test results, if tests were run. */
  testResults?: TestResult[];
  /** Current build status. */
  buildStatus: BuildStatus;
  /** Portal information for live preview. */
  portal?: PortalInfo;
  /** Error message if verification failed. */
  error?: string;
  /** Epoch ms when verification started. */
  startedAt: number;
  /** Epoch ms when verification completed. */
  completedAt: number;
}

// ─── Verification Session ────────────────────────────────────────────────────

export interface VerificationSession {
  /** Unique session identifier. */
  id: string;
  /** Original request that created this session. */
  request: VerificationRequest;
  /** Current result (updated during verification). */
  result: VerificationResult;
  /** Whether the session is currently active. */
  active: boolean;
  /** Number of output chunks received. */
  outputChunks: number;
}

// ─── Framework Config ────────────────────────────────────────────────────────

export interface FrameworkConfig {
  /** Framework name. */
  framework: VerificationFramework;
  /** Default command to run. */
  defaultCommand: string;
  /** Default port the dev server listens on. */
  defaultPort: number;
  /** Expected startup time in ms. */
  startupTimeout: number;
  /** File patterns to watch for changes. */
  watchPatterns: string[];
}

// ─── Framework Defaults ──────────────────────────────────────────────────────

export const FRAMEWORK_CONFIGS: Record<VerificationFramework, FrameworkConfig> = {
  nextjs: {
    framework: 'nextjs',
    defaultCommand: 'npm run dev',
    defaultPort: 3000,
    startupTimeout: 15_000,
    watchPatterns: ['**/*.{ts,tsx,js,jsx,json}'],
  },
  express: {
    framework: 'express',
    defaultCommand: 'node server.js',
    defaultPort: 3000,
    startupTimeout: 5_000,
    watchPatterns: ['**/*.{ts,js,json}'],
  },
  react: {
    framework: 'react',
    defaultCommand: 'npm start',
    defaultPort: 3000,
    startupTimeout: 10_000,
    watchPatterns: ['**/*.{ts,tsx,js,jsx,css}'],
  },
  static: {
    framework: 'static',
    defaultCommand: 'npx http-server . -p 8080',
    defaultPort: 8080,
    startupTimeout: 3_000,
    watchPatterns: ['**/*.{html,css,js}'],
  },
  node: {
    framework: 'node',
    defaultCommand: 'node index.js',
    defaultPort: 3000,
    startupTimeout: 5_000,
    watchPatterns: ['**/*.{ts,js,json}'],
  },
  auto: {
    framework: 'auto',
    defaultCommand: 'npm start',
    defaultPort: 3000,
    startupTimeout: 10_000,
    watchPatterns: ['**/*'],
  },
};
