/**
 * @tolu/cowork-core — Main barrel export
 *
 * Open-source Claude Cowork alternative.
 * Works with any OpenAI-compatible API endpoint.
 */

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  ToluStopReason,
  ToluTextContent,
  ToluThinkingContent,
  ToluImageContent,
  ToluToolCallContent,
  ToluContent,
  ToluToolParameter,
  ToluTool,
  ToluToolCall,
  ToluUserMessage,
  ToluAssistantMessage,
  ToluToolResultMessage,
  ToluMessage,
  ToluCost,
  ToluUsage,
  ToluThinkingLevel,
  ToluModelCostRates,
  ToluModel,
  ToluContext,
  ToluStreamStart,
  ToluStreamTextDelta,
  ToluStreamThinkingDelta,
  ToluStreamToolCallStart,
  ToluStreamToolCallDelta,
  ToluStreamToolCallEnd,
  ToluStreamDone,
  ToluStreamError,
  ToluStreamEvent,
  ToluProviderConfig,
  ToluStreamOptions,
  ToluCompatSettings,
} from "./types/index.js";

// ─── Provider ────────────────────────────────────────────────────────────────
export { ToluProvider } from "./provider/tolu-provider.js";
export { OpenAIClient, OpenAIClientError, detectCompatSettings } from "./provider/openai-client.js";

// ─── Agent ───────────────────────────────────────────────────────────────────
export { ToluAgent } from "./agent/tolu-agent.js";
export { AgentSession } from "./agent/agent-session.js";
export { ToolExecutor, ToolNotFoundError, ToolArgumentError } from "./agent/tool-executor.js";

// ─── Agent types ─────────────────────────────────────────────────────────────
export type {
  AgentConfig,
  AgentEventType,
  AgentEvent,
  AgentEventHandler,
  AgentStartEvent,
  AgentEndEvent,
  TurnStartEvent,
  TurnEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  MessageEndEvent,
  ToolExecutionStartEvent,
  ToolExecutionUpdateEvent,
  ToolExecutionEndEvent,
  AgentErrorEvent,
} from "./agent/message-types.js";

// ─── Tools ───────────────────────────────────────────────────────────────────
export {
  toToluTool,
  ReadTool,
  WriteTool,
  EditTool,
  ListTool,
  BashTool,
  GrepTool,
  FindTool,
  GlobTool,
  WebSearchTool,
  WebFetchTool,
  createMCPTool,
  ToolLoader,
} from "./tools/index.js";

export type {
  ToluToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./tools/index.js";

export type { MCPServerConfig } from "./tools/mcp-tool.js";

// ─── Sandbox ─────────────────────────────────────────────────────────────────
export {
  SandboxLevel,
  SandboxManager,
  SandboxInstance,
  HostSandbox,
  PathSandbox,
  DockerSandbox,
  SandboxError,
  SandboxCreationError,
  SandboxExecutionError,
  SandboxTimeoutError,
  PathAccessDeniedError,
  killProcessTree,
  shellEscape,
} from "./sandbox/index.js";

export type {
  ResourceLimits,
  DockerConfig,
  PathSandboxConfig,
  SandboxConfig,
  ExecResult,
  ExecOptions,
  FileAccessPolicy,
  SandboxInfo,
  SandboxFileSystem,
} from "./sandbox/index.js";

// ─── Security ────────────────────────────────────────────────────────────────
export {
  ApiKeyManager,
  RateLimiter,
  AuditLogger,
  PermissionSystem,
  RequestResponseSanitizer,
  SecurityError,
  ApiKeyNotFoundError,
  ApiKeyRotationError,
  EncryptionError,
  RateLimitExceededError,
  PermissionDeniedError,
  SanitizationError,
} from "./security/index.js";

export type {
  RotationPolicy,
  ApiKeyEntry,
  RateLimitPolicy,
  RateLimitEntry,
  AuditResult,
  AuditLogEntry,
  PermissionSet,
  SanitizationRule,
  RateLimitResult,
} from "./security/index.js";

// ─── Config ──────────────────────────────────────────────────────────────────
export { ToluConfigSchema, ConfigLoader, ConfigError } from "./config/index.js";
export type { ToluConfig } from "./config/config-schema.js";

// ─── Services ────────────────────────────────────────────────────────────────
export {
  SkillsService,
  ProjectsService,
  SchedulerService,
  SubAgentsService,
} from "./services/index.js";

export type {
  Skill,
  Project,
  ScheduledTask,
  SubAgent,
} from "./services/index.js";

// ─── Utils ───────────────────────────────────────────────────────────────────
export { Logger } from "./utils/logger.js";
export type { LogLevel, LogEntry } from "./utils/logger.js";

export {
  toJsonLines,
  collectStream,
  toReadableStream,
  pipeToWritable,
} from "./utils/stream.js";

export {
  formatContent,
  formatAssistantMessage,
  formatToolResult,
  formatUsage,
  truncate,
  indent,
} from "./utils/format.js";

// ─── Network ─────────────────────────────────────────────────────────────────
export {
  NetworkError,
  E2EEncryptionError,
  TLSConfigError,
  WebSocketSecurityError,
  CertificatePinError,
  E2EEncryption,
  TLSConfigurator,
  WebSocketSecurity,
  CertificatePinning,
} from "./network/index.js";

export type {
  TlsConfig,
  MtlsConfig,
  E2ESession,
  E2EMessage,
  WebSocketSecurityConfig,
  CertPinConfig,
  CertValidationResult,
} from "./network/index.js";

// ─── Remote ──────────────────────────────────────────────────────────────────
export {
  RemoteAccessError,
  PairingError,
  SessionError,
  DeviceTrustError,
  CredentialStoreError,
  QRPairingManager,
  SessionManager,
  DeviceTrustManager,
  SecureCredentialStore,
} from "./remote/index.js";

export type {
  PairingCode,
  SessionToken,
  DeviceInfo,
  TrustChallenge,
  CredentialEntry,
} from "./remote/index.js";
