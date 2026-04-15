# State Machine: Security Pipeline
Date: 2026-04-15
Source: `src/security/api-key-manager.ts`, `src/security/permission-system.ts`, `src/security/rate-limiter.ts`, `src/security/sanitizer.ts`, `src/security/audit-logger.ts`, `src/security/types.ts`, `src/security/errors.ts`

## Diagram

```
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │                        Incoming Request                                          │
  │  { provider, toolName, sandboxLevel, clientId, payload }                         │
  └────────────────────────────────┬────────────────────────────────────────────────┘
                                   │
                                   ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE 1: AUTHENTICATE                                                          │
  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
  │  │  ApiKeyManager                                                          │    │
  │  │                                                                          │    │
  │  │  resolveApiKey(provider)                                                 │    │
  │  │  ├─ check TOLU_<PROVIDER>_API_KEY env var                               │    │
  │  │  ├─ check PROVIDER_ENV_MAP[provider] env var                            │    │
  │  │  └─ lookup encrypted keys.json → decrypt with AES-256-GCM               │    │
  │  │         master key from TOLU_ENCRYPTION_KEY or ~/.tolu/master.key        │    │
  │  │                                                                          │    │
  │  │  storeKey(provider, apiKey)  → encrypt → persist to keys.json            │    │
  │  │  retrieveKey(id)            → decrypt → return plaintext                 │    │
  │  │  rotateKey(id, newKey)      → encrypt new → update entry → persist       │    │
  │  └──────────────────────────────┬──────────────────────────────────────────┘    │
  │                                 │                                              │
  │                    ┌────────────┴────────────┐                                  │
  │                  valid                   not found                               │
  │                    │                    ┌──────┴──────┐                           │
  │                    │                    │ REJECTED    │                           │
  │                    │                    │ ApiKeyNot   │                           │
  │                    │                    │ FoundError  │                           │
  │                    │                    └─────────────┘                           │
  └────────────────────┼────────────────────────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE 2: AUTHORIZE                                                             │
  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
  │  │  PermissionSystem (singleton)                                           │    │
  │  │                                                                          │    │
  │  │  load() → ~/.tolu/permissions.json → merge with DEFAULT_PERMISSIONS      │    │
  │  │                                                                          │    │
  │  │  checkPermission(toolName, sandboxLevel)                                 │    │
  │  │                                                                          │    │
  │  │  Default least-privilege matrix:                                         │    │
  │  │  ┌──────────────────────────────────────────────────────┐                │    │
  │  │  │ Tool         │ none │ path-only │ docker              │                │    │
  │  │  ├──────────────────────────────────────────────────────┤                │    │
  │  │  │ bash         │  ✗  │    ✓      │   ✓                  │                │    │
  │  │  │ write/edit   │  ✗  │    ✓      │   ✓                  │                │    │
  │  │  │ delete/exec  │  ✗  │    ✓      │   ✓                  │                │    │
  │  │  │ read/ls/find │  ✓  │    ✓      │   ✓                  │                │    │
  │  │  │ curl/wget    │  ✗  │    ✗      │   ✓                  │                │    │
  │  │  │ config       │  ✗  │    ✓      │   ✓                  │                │    │
  │  │  │ unknown      │  ✗  │    ✗      │   ✗                  │                │    │
  │  │  └──────────────────────────────────────────────────────┘                │    │
  │  └──────────────────────────────┬──────────────────────────────────────────┘    │
  │                                 │                                              │
  │                    ┌────────────┴────────────┐                                  │
  │                permitted                 denied                               │
  │                    │                    ┌──────┴──────┐                           │
  │                    │                    │ REJECTED    │                           │
  │                    │                    │ Permission  │                           │
  │                    │                    │ DeniedError │                           │
  │                    │                    └─────────────┘                           │
  └────────────────────┼────────────────────────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE 3: RATE_LIMIT                                                            │
  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
  │  │  RateLimiter                                                            │    │
  │  │                                                                          │    │
  │  │  checkLimit(provider, clientId?)                                         │    │
  │  │                                                                          │    │
  │  │  Sliding window with burst allowance:                                    │    │
  │  │  ┌─────────────────────────────────────────────┐                         │    │
  │  │  │ Category  │ windowMs │ maxReqs │ burst      │                         │    │
  │  │  ├─────────────────────────────────────────────┤                         │    │
  │  │  │ llm       │  60000   │   60    │  +10       │                         │    │
  │  │  │ tool      │  60000   │  120    │  +20       │                         │    │
  │  │  │ internal  │  60000   │ 10000   │   -        │                         │    │
  │  │  └─────────────────────────────────────────────┘                         │    │
  │  │                                                                          │    │
  │  │  key = "provider:clientId"                                               │    │
  │  │  totalUsed = count + burstCount                                          │    │
  │  │  totalCapacity = maxRequests + burstAllowance                            │    │
  │  │                                                                          │    │
  │  │  totalUsed < maxRequests  → allowed (normal)                             │    │
  │  │  totalUsed < capacity     → allowed (burst)                              │    │
  │  │  totalUsed >= capacity    → REJECTED                                     │    │
  │  └──────────────────────────────┬──────────────────────────────────────────┘    │
  │                                 │                                              │
  │                    ┌────────────┴────────────┐                                  │
  │                  allowed               rate exceeded                           │
  │                    │                    ┌──────┴──────┐                           │
  │                    │                    │ REJECTED    │                           │
  │                    │                    │ RateLimit   │                           │
  │                    │                    │ Exceeded    │                           │
  │                    │                    │ Error       │                           │
  │                    │                    └─────────────┘                           │
  └────────────────────┼────────────────────────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE 4: SANITIZE                                                              │
  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
  │  │  RequestResponseSanitizer                                               │    │
  │  │                                                                          │    │
  │  │  sanitizeRequest(payload)  → deep recursive sanitization                │    │
  │  │  sanitizeResponse(result)  → strip leaked secrets                        │    │
  │  │                                                                          │    │
  │  │  Built-in regex rules (applied to all strings):                          │    │
  │  │  ┌────────────────────────────────────────────────────────────┐           │    │
  │  │  │ Pattern                          │ Replacement            │           │    │
  │  │  ├────────────────────────────────────────────────────────────┤           │    │
  │  │  │ sk-[a-zA-Z0-9]{20,}             │ [REDACTED]             │           │    │
  │  │  │ key-[a-zA-Z0-9]{20,}            │ [REDACTED]             │           │    │
  │  │  │ Bearer+[token]                 │ Bearer [REDACTED]      │           │    │
  │  │  │ 10.x.x.x / 127.x.x.x            │ [REDACTED]             │           │    │
  │  │  │ 172.16-31.x.x                   │ [REDACTED]             │           │    │
  │  │  │ 192.168.x.x                     │ [REDACTED]             │           │    │
  │  │  │ /home/...                        │ [REDACTED]             │           │    │
  │  │  │ /Users/...                       │ [REDACTED]             │           │    │
  │  │  └────────────────────────────────────────────────────────────┘           │    │
  │  │                                                                          │    │
  │  │  addRule(custom) → push to rules array                                  │    │
  │  │  Traverses: strings → apply all rules, arrays → map, objects → recurse  │    │
  │  └──────────────────────────────┬──────────────────────────────────────────┘    │
  │                                 │                                              │
  │                     sanitized payload                                           │
  │                                 │                                              │
  └─────────────────────────────────┼───────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE 5: AUDIT                                                                 │
  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
  │  │  AuditLogger                                                             │    │
  │  │                                                                          │    │
  │  │  log({ actor, action, resource, result, sandboxLevel, sourceIp,          │    │
  │  │        details? })                                                       │    │
  │  │                                                                          │    │
  │  │  1. Generate id (UUID) + timestamp                                       │    │
  │  │  2. Sanitize details via RequestResponseSanitizer                         │    │
  │  │  3. Serialize to JSON                                                    │    │
  │  │  4. Append as line to ~/.tolu/audit.log (JSONL)                           │    │
  │  │                                                                          │    │
  │  │  query(filters, limit)   → readAll → filter → sort newest-first          │    │
  │  │  export("json"|"csv")    → readAll → format                              │    │
  │  │  prune(maxAge)           → readAll → filter by cutoff → rewrite file     │    │
  │  └──────────────────────────────┬──────────────────────────────────────────┘    │
  │                                 │                                              │
  │                     entry persisted                                             │
  │                                 │                                              │
  └─────────────────────────────────┼───────────────────────────────────────────────┘
                                    │
                                    ▼
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  STAGE 6: EXECUTE                                                               │
  │  ┌─────────────────────────────────────────────────────────────────────────┐    │
  │  │  Request passes all gates → execute in sandbox                          │    │
  │  │                                                                          │    │
  │  │  After execution:                                                        │    │
  │  │  1. Sanitize response (strip any leaked secrets from output)             │    │
  │  │  2. Audit log the result (success/failure, duration, sandbox level)      │    │
  │  │  3. Return sanitized response to caller                                  │    │
  │  └─────────────────────────────────────────────────────────────────────────┘    │
  └─────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │  Error Flow Summary                                                              │
  │                                                                                   │
  │  AUTHENTICATE fail → ApiKeyNotFoundError      → 401 + audit DENY                  │
  │  AUTHORIZE fail    → PermissionDeniedError    → 403 + audit DENY                  │
  │  RATE_LIMIT fail   → RateLimitExceededError   → 429 + audit DENY                  │
  │  SANITIZE fail     → SanitizationError        → 500 + audit ERROR                  │
  │  All rejections:   AuditLogger.log(result: "denied"|"error")                      │
  └─────────────────────────────────────────────────────────────────────────────────┘
```

## States

| State | Description | Data Shape |
|---|---|---|
| AUTHENTICATE | Resolve and validate API key for the target provider. Decrypt from encrypted storage or resolve from environment | `{ provider: string, apiKey: string (plaintext), keyEntry?: ApiKeyEntry }` |
| AUTHORIZE | Check tool execution permission against sandbox isolation level using least-privilege matrix | `{ toolName: string, sandboxLevel: string, allowed: string[] }` |
| RATE_LIMIT | Sliding-window token bucket check with burst allowance per provider/client | `{ provider: string, clientId?: string, allowed: boolean, remaining: number, resetAt: number }` |
| SANITIZE | Deep recursive pattern replacement on request payload. Strips API keys, tokens, private IPs, home paths | `{ sanitized: Record<string, unknown>, rules: SanitizationRule[] }` |
| AUDIT | Persist security event to JSONL log with auto-sanitization of details | `{ entry: AuditLogEntry, logFile: string }` |
| EXECUTE | Request cleared all gates. Execute within sandbox, sanitize response, audit result | `{ result: ExecResult, sanitized: boolean }` |
| REJECTED | Request failed a gate. Specific error type thrown, audit entry logged with denial | `{ error: SecurityError subclass, stage: string }` |

## Transitions

| From | To | Trigger | Guard |
|---|---|---|---|
| (incoming) | AUTHENTICATE | Request received with provider identifier | — |
| AUTHENTICATE | AUTHORIZE | API key resolved successfully | Key found and decrypted |
| AUTHENTICATE | REJECTED | Key not found in env or encrypted store | `ApiKeyNotFoundError` |
| AUTHORIZE | RATE_LIMIT | `checkPermission(toolName, sandboxLevel) === true` | Tool permitted at level |
| AUTHORIZE | REJECTED | Tool not in permission set or level not allowed | `PermissionDeniedError` |
| RATE_LIMIT | SANITIZE | `checkLimit(provider, clientId).allowed === true` | Within window + burst |
| RATE_LIMIT | REJECTED | `totalUsed >= totalCapacity` | `RateLimitExceededError` |
| SANITIZE | AUDIT | Request payload sanitized without errors | All rules applied successfully |
| SANITIZE | REJECTED | Regex rule application fails | `SanitizationError` |
| AUDIT | EXECUTE | Audit entry persisted to JSONL | Write successful |
| EXECUTE | (response) | Execution complete, response sanitized and audited | — |
| REJECTED | (terminal) | Error thrown to caller after audit denial logged | — |
