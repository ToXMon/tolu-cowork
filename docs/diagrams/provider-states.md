# State Machine: Provider
Date: 2026-04-15
Source: `src/provider/tolu-provider.ts`, `src/provider/openai-client.ts`

## Diagram

```
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │                         ToluProvider Constructor                                │
  │  detectProvider(baseUrl) → normalize URL → create OpenAIClient                  │
  └──────────────────────────────┬──────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
              stream() path              complete() path
                    │                         │
                    ▼                         ▼
         ┌─────────────────┐      ┌──────────────────────┐
         │     CREATED     │      │      CREATED         │
         │ new AbortCtrl   │      │  new AbortController │
         │ build request   │      │  build request       │
         └────────┬────────┘      │  stream = false      │
                  │               └──────────┬───────────┘
                  │ yield: start             │
                  ▼                          │
    ┌─────────────────────────┐              │
    │       STREAMING          │              │
    │  client.streamChat()     │              │
    │  for await chunk of      │              │
    │  stream:                 │              │
    │                          │              │
    │  ┌─ delta.content? ──┐   │              │
    │  │  TEXT_ACCUMULATE   │   │              │
    │  │  push text block   │   │              │
    │  │  yield text_delta  │   │              │
    │  └───────────────────┘   │              │
    │                          │              │
    │  ┌─ reasoning/thinking?─┐ │              │
    │  │  THINK_ACCUMULATE    │ │              │
    │  │  push thinking block │ │              │
    │  │  yield thinking_delta│ │              │
    │  └─────────────────────┘ │              │
    │                          │              │
    │  ┌─ delta.tool_calls? ──┐ │              │
    │  │  TOOL_ACCUMULATE     │ │              │
    │  │                      │ │              │
    │  │  tc.id present?      │ │              │
    │  │  ├─ YES: new toolcall │ │              │
    │  │  │  create acc       │ │              │
    │  │  │  push placeholder │ │              │
    │  │  │  yield toolcall_   │ │              │
    │  │  │         start     │ │              │
    │  │  └─ NO: accumulate   │ │              │
    │  │     args delta       │ │              │
    │  │     yield toolcall_  │ │              │
    │  │            delta     │ │              │
    │  └──────────────────────┘ │              │
    │                          │              │
    │  ┌─ finish_reason? ────┐  │              │
    │  │  capture stopReason │  │              │
    │  │  stop|length|toolUse│  │              │
    │  └─────────────────────┘  │              │
    └────────────┬──────────────┘              │
                 │                             │
                 ▼                             │
    ┌─────────────────────────┐                │
    │    FINALIZE_TOOLCALLS    │                │
    │  for each accumulated:  │                │
    │    parseToolCallArgs()   │                │
    │    fix truncated JSON    │                │
    │    yield toolcall_end    │                │
    └────────────┬────────────┘                │
                 │                             │
                 ├──────────┬──────────┐       │
                 │          │          │       │
            stop/length  aborted    error     │
                 │          │          │       │
                 ▼          ▼          ▼       │
    ┌────────┐  ┌────────┐  ┌────────┐  │       │
    │  DONE  │  │ABORTED │  │ ERROR  │  │       │
    │ yield  │  │ yield  │  │ yield  │  │       │
    │ done   │  │ error  │  │ error  │  │       │
    │ merge  │  │        │  │        │  │       │
    │ usage  │  │        │  │        │  │       │
    └────────┘  └────────┘  └────────┘  │       │
                                         │       │
                                         ▼       │
                                   ┌─────────┐  │
                                   │COMPLETE │  │
                                   │(non-str)│  │
                                   │parse    │  │
                                   │response │  │
                                   │merge    │  │
                                   │usage    │  │
                                   └─────────┘  │
                                                │
                                    ┌───────────┴───────────┐
                                    │   finally:             │
                                    │   abortController=null │
                                    └───────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────┐
  │  OpenAIClient (transport layer)                                      │
  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
  │  │ buildRequest │  │ streamChat() │  │ completeChat()            │  │
  │  │ model,msgs,  │  │ fetch POST   │  │ fetch POST                │  │
  │  │ tools,system │  │ stream:true  │  │ stream:false              │  │
  │  │ → request obj│  │ → ReadableStm│  │ → ChatCompletionResponse │  │
  │  └──────────────┘  └──────────────┘  └───────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────────┘
```

## States

| State | Description | Data Shape |
|---|---|---|
| CREATED | AbortController created, request built from context | `{ request: ChatCompletionRequest, output: ToluAssistantMessage, toolCalls: Map<number, ToolCallAccumulator> }` |
| STREAMING | Processing SSE chunks from provider. Accumulating text, thinking, and tool call content | `{ currentTextIndex: number, currentThinkingIndex: number, activeToolCallIndex: number }` |
| TEXT_ACCUMULATE | Text delta received. Appending to current text block, yielding `text_delta` event | `{ delta: string, contentIndex: number }` |
| THINK_ACCUMULATE | Thinking/reasoning delta received. Appending to thinking block, yielding `thinking_delta` event | `{ delta: string, contentIndex: number }` |
| TOOL_ACCUMULATE | Tool call delta received. Either starting new tool call or accumulating arguments | `{ id: string, name: string, argumentsJson: string, contentIndex: number }` |
| FINALIZE_TOOLCALLS | Stream ended. Parse accumulated JSON arguments, fix truncation, yield `toolcall_end` events | `{ parsed: Record<string, unknown>, toolCallContent: ToluToolCallContent }` |
| DONE | Normal completion. Usage merged into cumulative stats. `done` event yielded | `{ reason: ToluStopReason, message: ToluAssistantMessage }` |
| ABORTED | Signal aborted. Error message set, `error` event yielded with reason "aborted" | `{ stopReason: "aborted", errorMessage: "Request aborted" }` |
| ERROR | Exception during streaming. Error captured, `error` event yielded | `{ stopReason: "error", errorMessage: string }` |
| COMPLETE | Non-streaming path. Single HTTP response parsed into assistant message | `{ response: ChatCompletionResponse, output: ToluAssistantMessage }` |

## Transitions

| From | To | Trigger | Guard |
|---|---|---|---|
| (constructor) | CREATED | `stream()` or `complete()` called | — |
| CREATED | STREAMING | `client.streamChat(request, signal)` returns | streaming path |
| CREATED | COMPLETE | `client.completeChat(request, signal)` resolves | non-streaming path |
| STREAMING | TEXT_ACCUMULATE | `delta.content != null && !== ""` | — |
| STREAMING | THINK_ACCUMULATE | `delta.reasoning_content ?? delta.thinking` present | — |
| STREAMING | TOOL_ACCUMULATE | `delta.tool_calls` array present | — |
| STREAMING | FINALIZE_TOOLCALLS | Stream iterator exhausted (no more chunks) | — |
| STREAMING | ABORTED | `signal.aborted === true` | — |
| STREAMING | ERROR | Exception thrown during chunk processing | — |
| FINALIZE_TOOLCALLS | DONE | `stopReason` is `stop`, `length`, or `toolUse` | — |
| DONE | (terminal) | Generator returns, `abortController = null` | — |
| ABORTED | (terminal) | Generator returns, `abortController = null` | — |
| ERROR | (terminal) | Generator returns, `abortController = null` | — |
| COMPLETE | (terminal) | Returns `ToluAssistantMessage`, `abortController = null` | — |
