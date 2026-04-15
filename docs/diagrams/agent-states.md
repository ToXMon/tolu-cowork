# State Machine: Agent Runtime
Date: 2026-04-15
Source: `src/agent/tolu-agent.ts`, `src/agent/agent-session.ts`, `src/agent/tool-executor.ts`

## Diagram

```
                              ┌─────────────────────────────────────────────────────────────┐
                              │                    ToluAgent.run(prompt)                     │
                              └─────────────┬───────────────────────────────────────────────┘
                                            │
                                            ▼
                                ┌───────────────────────┐
                                │        IDLE           │
                                │  (no active session)  │
                                └───────────┬───────────┘
                                            │  run() called
                                            │  emit: agent_start
                                            ▼
                                ┌───────────────────────┐
                                │      INITIALIZING     │
                                │  create/reuse session │
                                │  add user message     │
                                │  setup AbortController│
                                └───────────┬───────────┘
                                            │  turns < maxTurns
                                            │  emit: turn_start
                                            ▼
                     ┌──────────────────────────────────────────────────┐
                     │              TURN_LOOP (while)                    │
                     │  ┌─────────────────────────────────────────┐     │
                     │  │  buildContext(session)                   │     │
                     │  │  → systemPrompt + messages + tools       │     │
                     │  └────────────────┬────────────────────────┘     │
                     │                   │                              │
                     │                   ▼                              │
                     │  ┌─────────────────────────────────────────┐     │
                     │  │         STREAMING                        │     │
                     │  │  provider.stream(context)                │     │
                     │  │  emit: message_start                     │     │
                     │  │  accumulate:                             │     │
                     │  │    text_delta → text content             │     │
                     │  │    thinking_delta → thinking content     │     │
                     │  │  emit: message_update per delta          │     │
                     │  │  on provider done:                       │     │
                     │  │    emit: message_end                     │     │
                     │  └────────────────┬────────────────────────┘     │
                     │                   │                              │
                     │                   ▼                              │
                     │  ┌─────────────────────────────────────────┐     │
                     │  │         CHECK_TOOL_CALLS                 │     │
                     │  │  filter content for type === "toolCall"   │     │
                     │  └──────┬──────────────────┬───────────────┘     │
                     │         │                  │                     │
                     │    no calls           has calls                  │
                     │         │                  │                     │
                     │         │                  ▼                     │
                     │         │    ┌─────────────────────────┐         │
                     │         │    │     TOOL_EXECUTION       │         │
                     │         │    │  slice(maxToolCallsPer   │         │
                     │         │    │    Turn)                 │         │
                     │         │    │  executor.executeTools() │         │
                     │         │    │  mode: parallel|seq      │         │
                     │         │    │  emit: tool_execution_end│         │
                     │         │    │  add toolResult messages │         │
                     │         │    │  emit: turn_end           │         │
                     │         │    └────────────┬────────────┘         │
                     │         │                 │                      │
                     │         │                 │ loop back            │
                     │         │                 └──────────► turns++   │
                     │         │                          (top of while) │
                     └─────────┼─────────────────────────────────────────┘
                               │
                               ▼
                    ┌───────────────────────┐
                    │       COMPLETE        │
                    │  findLastAssistant()  │
                    │  emit: agent_end      │
                    │  return final message │
                    └───────────────────────┘

          ┌───────────────────────┐              ┌───────────────────────┐
          │        ABORTED        │              │         ERROR         │
          │  signal.aborted=true  │              │  catch block fires    │
          │  stopReason="aborted" │              │  emit: error          │
          │  return "(no response)"│              │  return error message │
          └───────────────────────┘              └───────────────────────┘
```

## States

| State | Description | Data Shape |
|---|---|---|
| IDLE | No active session. Agent constructed, tools registered, awaiting `run()` | `{ registeredTools: Map<string, ToluToolDefinition>, config: AgentConfig }` |
| INITIALIZING | Session created/reused, user message added, abort controller set up | `{ session: AgentSession, turns: 0, signal: AbortSignal }` |
| TURN_LOOP | Main agentic loop iteration. Builds context from session history, invokes provider | `{ turns: number, maxTurns: 20 }` |
| STREAMING | Provider streaming in progress. Accumulating text, thinking, and tool call content | `{ assistantMessage: ToluAssistantMessage, toolCalls: Map<number, ToolCallAccumulator> }` |
| CHECK_TOOL_CALLS | Decision point: filter assistant message content for tool call entries | `{ toolCalls: ToluToolCallContent[] }` |
| TOOL_EXECUTION | Executing tool calls via ToolExecutor (parallel or sequential). Results added to session | `{ limitedCalls: ToluToolCallContent[], toolContext: { sandboxId, sandboxManager, workingDirectory } }` |
| COMPLETE | Final assistant message found and returned. Session usage aggregated | `{ finalMessage: ToluAssistantMessage, totalTurns: number }` |
| ERROR | Unhandled exception in the loop. Error message returned as assistant response | `{ error: Error, stopReason: "error" }` |
| ABORTED | Signal aborted externally or via `agent.abort()`. Loop breaks immediately | `{ stopReason: "aborted" }` |

## Transitions

| From | To | Trigger | Guard |
|---|---|---|---|
| IDLE | INITIALIZING | `run(prompt)` called | — |
| INITIALIZING | TURN_LOOP | Session ready, user message added | `turns < maxTurns` |
| TURN_LOOP | STREAMING | `buildContext()` returns `ToluContext` | `signal.aborted === false` |
| STREAMING | CHECK_TOOL_CALLS | Provider stream yields `done` event | — |
| CHECK_TOOL_CALLS | TOOL_EXECUTION | `toolCalls.length > 0` | — |
| CHECK_TOOL_CALLS | COMPLETE | `toolCalls.length === 0` | — |
| TOOL_EXECUTION | TURN_LOOP | Tools executed, results added to session | `turns < maxTurns` |
| TOOL_EXECUTION | COMPLETE | Tools executed but `turns >= maxTurns` | `turns >= maxTurns` |
| TURN_LOOP | ABORTED | `signal.aborted === true` | — |
| STREAMING | ABORTED | `signal.aborted === true` | — |
| Any | ERROR | Unhandled exception thrown | — |
| COMPLETE | IDLE | `finally` block clears `currentAbortController` | — |
| ERROR | IDLE | `finally` block clears `currentAbortController` | — |
