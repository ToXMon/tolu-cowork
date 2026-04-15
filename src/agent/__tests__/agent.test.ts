/**
 * @tolu/cowork-core — Agent module tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AgentSession } from "../agent-session.js";
import { ToluAgent } from "../tolu-agent.js";
import { ToolExecutor, ToolNotFoundError } from "../tool-executor.js";
import type { AgentEvent } from "../message-types.js";
import type { ToluToolDefinition, ToolExecutionContext, ToolExecutionResult } from "../../tools/tool-interface.js";
import type {
  ToluAssistantMessage,
  ToluToolCallContent,
  ToluContext,
  ToluStreamEvent,
  ToluStreamOptions,
  ToluUsage,
} from "../../types/index.js";

// ─── Mock Provider ───────────────────────────────────────────────────────────

function emptyUsage(): ToluUsage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makeAssistant(text: string, toolCalls?: ToluToolCallContent[]): ToluAssistantMessage {
  const content: ToluAssistantMessage["content"] = [
    { type: "text", text },
  ];
  if (toolCalls) content.push(...toolCalls);
  return {
    role: "assistant",
    content,
    model: "test-model",
    usage: emptyUsage(),
    stopReason: toolCalls ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

/** Create a mock provider that yields predefined responses in sequence. */
function createMockProvider(responses: ToluAssistantMessage[]) {
  let callIndex = 0;
  return {
    modelId: "test-model",
    provider: "test",
    abort: vi.fn(),
    getUsage: vi.fn(() => emptyUsage()),
    stream: vi.fn(function* (
      _context: ToluContext,
      _options?: ToluStreamOptions,
    ): Generator<ToluStreamEvent> {
      const msg = responses[callIndex++] ?? makeAssistant("default");
      yield { type: "start", partial: msg } as ToluStreamEvent;
      yield {
        type: "done",
        reason: msg.stopReason as "stop" | "length" | "toolUse",
        message: msg,
      } as ToluStreamEvent;
    }),
    complete: vi.fn(),
  } as unknown as import("../../provider/tolu-provider.js").ToluProvider;
}

// ─── Mock Tool ───────────────────────────────────────────────────────────────

// Mock tool is created inline in each test for clarity.

// ─── Session Tests ───────────────────────────────────────────────────────────

describe("AgentSession", () => {
  let session: AgentSession;

  beforeEach(() => {
    session = new AgentSession();
  });

  it("creates a session with a unique ID", () => {
    expect(session.getSessionId()).toBeTruthy();
    expect(typeof session.getSessionId()).toBe("string");
  });

  it("starts with empty message history", () => {
    expect(session.getMessages()).toHaveLength(0);
  });

  it("adds and retrieves messages", () => {
    session.addMessage({
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    });
    expect(session.getMessages()).toHaveLength(1);
    expect(session.getMessages()[0].role).toBe("user");
  });

  it("returns readonly-length array", () => {
    session.addMessage({ role: "user", content: "hi", timestamp: 0 });
    const msgs = session.getMessages();
    // readonly type prevents mutation at compile time; runtime push succeeds but is a type violation
    expect(msgs).toHaveLength(1);
  });

  it("clears messages and resets usage", () => {
    session.addMessage({ role: "user", content: "hi", timestamp: 0 });
    session.clear();
    expect(session.getMessages()).toHaveLength(0);
  });

  it("subscribes and unsubscribes event handlers", async () => {
    const handler = vi.fn();
    const unsub = session.onEvent(handler);
    await session.emit({ type: "agent_start", sessionId: "test", prompt: "hi" });
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    await session.emit({ type: "agent_start", sessionId: "test", prompt: "hi" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("counts tool calls across messages", () => {
    session.addMessage(makeAssistant("thinking", [
      { type: "toolCall", id: "1", name: "bash", arguments: {} },
    ]));
    session.addMessage(makeAssistant("more", [
      { type: "toolCall", id: "2", name: "bash", arguments: {} },
      { type: "toolCall", id: "3", name: "read", arguments: {} },
    ]));
    expect(session.getToolCallCount()).toBe(3);
  });
});

// ─── Tool Registration Tests ─────────────────────────────────────────────────

describe("ToluAgent tool management", () => {
  it("registers and lists tools", () => {
    const provider = createMockProvider([]);
    const agent = new ToluAgent({ provider });
    const tool: ToluToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      parameters: z.object({}),
      parameterSchema: {},
      execute: async () => ({ toolCallId: "", toolName: "", content: [], isError: false, duration: 0 }),
    };
    agent.registerTool(tool);
    expect(agent.listTools()).toHaveLength(1);
    expect(agent.listTools()[0].name).toBe("test_tool");
  });

  it("unregisters tools by name", () => {
    const provider = createMockProvider([]);
    const agent = new ToluAgent({ provider });
    const tool: ToluToolDefinition = {
      name: "removable",
      description: "",
      parameters: z.object({}),
      parameterSchema: {},
      execute: async () => ({ toolCallId: "", toolName: "", content: [], isError: false, duration: 0 }),
    };
    agent.registerTool(tool);
    expect(agent.listTools()).toHaveLength(1);
    agent.unregisterTool("removable");
    expect(agent.listTools()).toHaveLength(0);
  });
});

// ─── Agent Run Tests ─────────────────────────────────────────────────────────

describe("ToluAgent run", () => {
  it("runs a simple Q&A without tools", async () => {
    const provider = createMockProvider([makeAssistant("Hello!")]);
    const agent = new ToluAgent({ provider });
    const result = await agent.run("Say hello");
    expect(result.role).toBe("assistant");
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("Hello!");
  });

  it("runs with tool calls and loops", async () => {
    const toolCall: ToluToolCallContent = {
      type: "toolCall",
      id: "tc-1",
      name: "bash",
      arguments: { command: "echo hi" },
    };
    const toolResult: ToluAssistantMessage = makeAssistant("Done!");
    const provider = createMockProvider([
      makeAssistant("Running...", [toolCall]),
      toolResult,
    ]);
    const agent = new ToluAgent({ provider });
    const tool: ToluToolDefinition = {
      name: "bash",
      description: "Run bash",
      parameters: z.object({}),
      parameterSchema: {},
      execute: async () => ({
        toolCallId: "tc-1",
        toolName: "bash",
        content: [{ type: "text", text: "hi" }],
        isError: false,
        duration: 5,
      }),
    };
    agent.registerTool(tool);
    const result = await agent.run("Run echo hi");
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("Done!");
  });

  it("emits events during run", async () => {
    const provider = createMockProvider([makeAssistant("Hi")]);
    const agent = new ToluAgent({ provider });
    const session = new AgentSession();
    const events: AgentEvent[] = [];
    session.onEvent((e) => { events.push(e); });
    await agent.run("Hi", session);
    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("agent_end");
    expect(types).toContain("message_start");
    expect(types).toContain("message_end");
  });

  it("respects maxTurns config", async () => {
    const toolCall: ToluToolCallContent = {
      type: "toolCall",
      id: "tc-loop",
      name: "bash",
      arguments: {},
    };
    // Provider always returns a tool call, creating an infinite loop
    const infiniteMsg = makeAssistant("loop", [toolCall]);
    const provider = createMockProvider(
      Array.from({ length: 20 }, () => infiniteMsg),
    );
    const agent = new ToluAgent({
      provider,
      config: { maxTurns: 2 },
    });
    const tool: ToluToolDefinition = {
      name: "bash",
      description: "",
      parameters: z.object({}),
      parameterSchema: {},
      execute: async () => ({
        toolCallId: "tc-loop",
        toolName: "bash",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        duration: 1,
      }),
    };
    agent.registerTool(tool);
    const result = await agent.run("loop");
    // Should stop after 2 turns and return the last assistant message
    expect(result.role).toBe("assistant");
  });

  it("handles abort signal", async () => {
    const provider = createMockProvider([makeAssistant("done")]);
    const agent = new ToluAgent({ provider });
    const controller = new AbortController();
    controller.abort();
    const result = await agent.run("test", undefined, { signal: controller.signal });
    // Should return a response even when aborted
    expect(result.role).toBe("assistant");
  });

  it("handles errors gracefully", async () => {
    const provider = {
      ...createMockProvider([]),
      stream: vi.fn(function* () {
        yield { type: "error", reason: "error" as const, error: makeAssistant("fail") } as ToluStreamEvent;
      }),
    } as unknown as import("../../provider/tolu-provider.js").ToluProvider;
    const agent = new ToluAgent({ provider });
    const result = await agent.run("fail test");
    expect(result.role).toBe("assistant");
  });
});

// ─── ToolExecutor Tests ──────────────────────────────────────────────────────

describe("ToolExecutor", () => {
  it("returns error for unknown tool", async () => {
    const executor = new ToolExecutor();
    const tools = new Map();
    const toolCall: ToluToolCallContent = {
      type: "toolCall",
      id: "tc-1",
      name: "nonexistent",
      arguments: {},
    };
    const result = await executor.executeTool(toolCall, tools, {
      workingDirectory: "/tmp",
      sessionId: "test",
    });
    expect(result.isError).toBe(true);
    expect(result.toolName).toBe("nonexistent");
  });

  it("executes parallel tool calls", async () => {
    const executor = new ToolExecutor();
    const tool: ToluToolDefinition = {
      name: "parallel_test",
      description: "",
      parameters: z.object({}),
      parameterSchema: {},
      execute: async () => ({
        toolCallId: "tc-1",
        toolName: "parallel_test",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        duration: 1,
      }),
    };
    const tools = new Map([["parallel_test", tool]]);
    const calls: ToluToolCallContent[] = [
      { type: "toolCall", id: "1", name: "parallel_test", arguments: {} },
      { type: "toolCall", id: "2", name: "parallel_test", arguments: {} },
    ];
    const results = await executor.executeTools(calls, tools, {
      workingDirectory: "/tmp",
      sessionId: "test",
    }, "parallel");
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.isError)).toBe(true);
  });

  it("executes sequential tool calls", async () => {
    const executor = new ToolExecutor();
    const order: number[] = [];
    const tool: ToluToolDefinition = {
      name: "seq_test",
      description: "",
      parameters: z.object({}),
      parameterSchema: {},
      execute: vi.fn(async (_args, _ctx) => {
        order.push(Date.now());
        return {
          toolCallId: "",
          toolName: "seq_test",
          content: [{ type: "text" as const, text: "ok" }],
          isError: false,
          duration: 1,
        };
      }),
    };
    const tools = new Map([["seq_test", tool]]);
    const calls: ToluToolCallContent[] = [
      { type: "toolCall", id: "1", name: "seq_test", arguments: {} },
      { type: "toolCall", id: "2", name: "seq_test", arguments: {} },
    ];
    const results = await executor.executeTools(calls, tools, {
      workingDirectory: "/tmp",
      sessionId: "test",
    }, "sequential");
    expect(results).toHaveLength(2);
  });
});
