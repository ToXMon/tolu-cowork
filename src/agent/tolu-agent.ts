/**
 * @tolu/cowork-core — ToluAgent
 *
 * The main agent class implementing the think→act→observe agentic loop.
 * Streams responses from ToluProvider, executes tool calls, and
 * manages conversation sessions.
 */

import type {
  ToluAssistantMessage,
  ToluToolCallContent,
  ToluUserMessage,
  ToluToolResultMessage,
} from "../types/index.js";
import type { ToluProvider } from "../provider/tolu-provider.js";
import type { SandboxManager } from "../sandbox/sandbox-manager.js";
import type { AgentConfig } from "./message-types.js";
import type { ToluToolDefinition } from "../tools/tool-interface.js";
import { AgentSession } from "./agent-session.js";
import { ToolExecutor } from "./tool-executor.js";
import { processStream, findLastAssistant, emptyUsage, buildContext } from "./agent-loop.js";

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 10;
const DEFAULT_TOOL_EXECUTION: "parallel" | "sequential" = "parallel";

// ─── ToluAgent ───────────────────────────────────────────────────────────────

/**
 * The main agent that runs the agentic loop.
 *
 * Think → Act → Observe:
 * 1. Send context (messages + tools) to the LLM provider
 * 2. Stream the response, collecting tool calls
 * 3. Execute tool calls (parallel or sequential)
 * 4. Add tool results to session and loop back
 * 5. Return final message when no more tool calls
 */
export class ToluAgent {
  private readonly provider: ToluProvider;
  private readonly sandboxManager?: SandboxManager;
  private readonly config: Required<AgentConfig>;
  private readonly registeredTools: Map<string, ToluToolDefinition> = new Map();
  private readonly executor: ToolExecutor;
  private currentAbortController: AbortController | null = null;

  /**
   * Create a new ToluAgent.
   *
   * @param params - Constructor parameters.
   * @param params.provider - The LLM provider for completions.
   * @param params.sandboxManager - Optional sandbox manager for tool isolation.
   * @param params.config - Optional agent configuration.
   */
  constructor(params: {
    provider: ToluProvider;
    sandboxManager?: SandboxManager;
    config?: AgentConfig;
  }) {
    this.provider = params.provider;
    this.sandboxManager = params.sandboxManager;
    this.config = {
      maxTurns: params.config?.maxTurns ?? DEFAULT_MAX_TURNS,
      maxToolCallsPerTurn:
        params.config?.maxToolCallsPerTurn ?? DEFAULT_MAX_TOOL_CALLS_PER_TURN,
      toolExecution:
        params.config?.toolExecution ?? DEFAULT_TOOL_EXECUTION,
      systemPrompt: params.config?.systemPrompt ?? "",
    };
    this.executor = new ToolExecutor();
  }

  /**
   * Register a tool definition for use by the agent.
   *
   * @param tool - The tool definition to register.
   */
  registerTool(tool: ToluToolDefinition): void {
    this.registeredTools.set(tool.name, tool);
  }

  /**
   * Unregister a tool by name.
   *
   * @param name - Name of the tool to remove.
   */
  unregisterTool(name: string): void {
    this.registeredTools.delete(name);
  }

  /**
   * List all currently registered tools.
   *
   * @returns Array of registered tool definitions.
   */
  listTools(): ToluToolDefinition[] {
    return Array.from(this.registeredTools.values());
  }

  /**
   * Abort the currently running agent loop.
   */
  abort(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    this.provider.abort();
  }

  /**
   * Run the agentic loop with a user prompt.
   *
   * Creates or reuses a session, streams the LLM response, executes
   * tool calls, and loops until a final text response or max turns.
   *
   * @param prompt - The user's input prompt.
   * @param session - Optional existing session to continue.
   * @param options - Optional run options (e.g. AbortSignal).
   * @returns The final assistant message.
   */
  async run(
    prompt: string,
    session?: AgentSession,
    options?: { signal?: AbortSignal },
  ): Promise<ToluAssistantMessage> {
    const activeSession = session ?? new AgentSession();
    const sessionId = activeSession.getSessionId();

    // Set up abort controller
    this.currentAbortController = new AbortController();
    const signal = options?.signal
      ? AbortSignal.any([this.currentAbortController.signal, options.signal])
      : this.currentAbortController.signal;

    // Add user message
    const userMessage: ToluUserMessage = {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    activeSession.addMessage(userMessage);

    await activeSession.emit({
      type: "agent_start",
      sessionId,
      prompt,
    });

    let turns = 0;
    const maxTurns = this.config.maxTurns;

    try {
      while (turns < maxTurns) {
        if (signal.aborted) break;

        turns++;
        await activeSession.emit({ type: "turn_start", sessionId, turn: turns });

        // Build context for the provider
        const context = buildContext(this.registeredTools, this.config.systemPrompt, activeSession);
        const streamOpts = { signal };

        // Stream the response
        const assistantMessage = await processStream(
          this.provider,
          context,
          streamOpts,
          activeSession,
          sessionId,
        );

        // Add assistant message to session
        activeSession.addMessage(assistantMessage);

        await activeSession.emit({
          type: "message_end",
          sessionId,
          message: assistantMessage,
        });

        // Extract tool calls
        const toolCalls = assistantMessage.content.filter(
          (c): c is ToluToolCallContent => c.type === "toolCall",
        );

        if (toolCalls.length === 0) {
          // No tool calls — we're done
          await activeSession.emit({
            type: "turn_end",
            sessionId,
            turn: turns,
            hadToolCalls: false,
          });
          break;
        }

        // Limit tool calls per turn
        const limitedCalls = toolCalls.slice(0, this.config.maxToolCallsPerTurn);

        // Execute tools
        const toolContext = {
          sandboxId: undefined as string | undefined,
          sandboxManager: this.sandboxManager,
          workingDirectory: process.cwd(),
          signal,
          sessionId,
        };

        const results = await this.executor.executeTools(
          limitedCalls,
          this.registeredTools,
          toolContext,
          this.config.toolExecution,
        );

        // Emit tool execution events and add results to session
        for (const result of results) {
          await activeSession.emit({
            type: "tool_execution_end",
            sessionId,
            result,
          });

          const toolResultMessage: ToluToolResultMessage = {
            role: "toolResult",
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            content: result.content,
            isError: result.isError,
            timestamp: Date.now(),
          };
          activeSession.addMessage(toolResultMessage);
        }

        await activeSession.emit({
          type: "turn_end",
          sessionId,
          turn: turns,
          hadToolCalls: true,
        });
      }

      // Get the last assistant message
      const messages = activeSession.getMessages();
      let finalMessage = findLastAssistant(messages);

      if (!finalMessage) {
        finalMessage = {
          role: "assistant",
          content: [{ type: "text", text: "(no response)" }],
          model: this.provider.modelId,
          usage: emptyUsage(),
          stopReason: "stop",
          timestamp: Date.now(),
        };
      }

      await activeSession.emit({
        type: "agent_end",
        sessionId,
        totalTurns: turns,
        usage: activeSession.getUsage(),
      });

      return finalMessage;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await activeSession.emit({
        type: "error",
        sessionId,
        error,
        fatal: true,
      });

      return {
        role: "assistant",
        content: [{ type: "text", text: `Agent error: ${error.message}` }],
        model: this.provider.modelId,
        usage: emptyUsage(),
        stopReason: "error",
        errorMessage: error.message,
        timestamp: Date.now(),
      };
    } finally {
      this.currentAbortController = null;
    }
  }
}
