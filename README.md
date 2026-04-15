# Tolu Cowork Core

Open-source Claude Cowork alternative — works with **any OpenAI-compatible API**.

Built by reverse-engineering and combining three complementary repos:
- **[pi-mono](https://github.com/badlogic/pi-mono)** → LLM abstraction (23+ providers, unified streaming)
- **[openclaude](https://github.com/Gitlawb/openclaude)** → Tool ecosystem (47+ tools, gRPC, MCP, skills)
- **[lunel](https://github.com/lunel-dev/lunel)** → UI + remote access (React Native, Rust PTY, E2E relay)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Tolu Cowork                     │
│                                                  │
│  lunel/app ──→ lunel/proxy ──→ Tolu Core        │
│  (UI)          (E2E Relay)     │                 │
│                                 ├── pi-ai        │
│                                 │   (LLM Layer)  │
│                                 ├── openclaude   │
│                                 │   (Tools+MCP)  │
│                                 └── Services     │
│                                     (Skills,     │
│                                      Projects,   │
│                                      Schedule,   │
│                                      Sub-Agents) │
│                                        │         │
│                                 lunel/pty        │
│                                 (Execution)      │
└─────────────────────────────────────────────────┘
```

## Module Breakdown

| Module | Directory | Purpose |
|--------|-----------|---------|
| **Provider** | `src/provider/` | OpenAI-compatible LLM client with streaming, tool calls, multi-model |
| **Agent** | `src/agent/` | Agentic loop (think→act→observe), parallel tool execution, sessions |
| **Tools** | `src/tools/` | File ops, bash, search, web, MCP connectors, dynamic loading |
| **Services** | `src/services/` | Skills, projects, scheduled tasks, sub-agents |
| **Sandbox** | `src/sandbox/` | Docker isolation, path sandboxing, host execution modes |
| **Security** | `src/security/` | API key management, rate limiting, audit logging, permissions |
| **Network** | `src/network/` | E2E encryption (NaCl), TLS/mTLS, WebSocket security |
| **Remote** | `src/remote/` | QR pairing, session management, device trust |
| **Config** | `src/config/` | Zod-validated config schema, env var loading |
| **CLI** | `src/cli/` | Commander-based CLI with 6 commands |

## Quick Start

```bash
# Install dependencies
npm install

# Configure your LLM provider
cp .env.example .env
# Edit .env with your API key and endpoint

# Run interactive session
npm start

# Or use CLI directly
npx tolu start                    # Interactive REPL
npx tolu run "Organize my files"  # Single task
npx tolu serve                    # Start gRPC server
npx tolu project list             # Manage projects
npx tolu skills list              # List available skills
npx tolu config --init            # Initialize configuration
```

## Configuration

Create `tolu.config.json` or use environment variables:

```json
{
  "provider": {
    "endpoint": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o",
    "reasoningLevel": "medium"
  },
  "workspace": "./workspace",
  "sandbox": {
    "level": "path-only",
    "allowedPaths": ["./workspace"]
  },
  "skills": [],
  "connectors": [],
  "schedule": []
}
```

## Claude Cowork Feature Coverage

| Feature | Status | Source |
|---------|--------|--------|
| Multi-provider LLM | ✅ | pi-ai (23+ providers) |
| File operations | ✅ | openclaude tools |
| Bash execution | ✅ | openclaude BashTool |
| Skills system | ✅ | openclaude SkillTool |
| MCP connectors | ✅ | openclaude MCP |
| Sub-agents | ✅ | openclaude AgentTool |
| Scheduled tasks | ✅ | openclaude ScheduleCronTool |
| Sandboxed execution | ✅ | pi-mom Docker + path sandbox |
| E2E encrypted relay | ✅ | lunel NaCl proxy |
| Remote dispatch | ✅ | lunel QR pairing |
| Desktop/mobile UI | 🔧 | lunel Expo app (integration pending) |
| Persistent projects | 🔧 | Services built, persistence layer pending |

## Security

- **AES-256-GCM** encrypted API keys at rest
- **NaCl E2E** encrypted communications
- **TLS 1.3 + mTLS** for enterprise
- **Ed25519** device authentication
- **3 sandbox levels**: none / path-only / docker
- **Command blocking** for dangerous operations
- **Audit logging** to JSONL

See [SECURITY.md](../SECURITY.md) for full architecture.

## Docker Deployment

```bash
docker-compose up -d
```

Includes: Tolu Core + Redis (sessions) + PostgreSQL (persistence) + sandbox container.

## Stats

- **67 TypeScript files**
- **~10,500 lines production code**
- **~2,600 lines tests**
- **0 compilation errors**
- **MIT licensed** (all three source repos)

## License

MIT
