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

## BrowserPod Live Verification

BrowserPod is an **optional** live verification layer. When enabled, users can watch their AI-generated code run in a real browser sandbox with live dev server preview.

### How It Works

1. AI agent generates code and calls the `browserpod_verify` tool
2. Core creates a verification session and returns a session ID
3. Web UI picks up the session, loads BrowserPod SDK in-browser
4. Files are written to BrowserPod's virtual filesystem
5. Dev server runs inside the browser sandbox (WebAssembly)
6. Portal URL provides live preview of the running app

### Configuration

Add to `tolu.config.json`:

```json
{
  "browserpod": {
    "enabled": true,
    "apiKey": "your-browserpod-api-key",
    "nodeVersion": "22",
    "defaultTimeout": 60000,
    "frameworks": ["nextjs", "express", "react", "static", "node"]
  }
}
```

Get an API key from [console.browserpod.io](https://console.browserpod.io). Free for open-source projects (apply for OSS grant).

### Supported Frameworks

| Framework | Command | Default Port |
|-----------|---------|-------------|
| Next.js | `npm run dev` | 3000 |
| Express | `node server.js` | 3000 |
| React | `npm start` | 3000 |
| Static | `npx http-server .` | 8080 |
| Node.js | `node index.js` | 3000 |

### Demo

```bash
npx tsx src/demo/demo-verifier.ts
```

### Architecture

- **Core** (`src/services/browserpod-service.ts`): Manages verification sessions, state, output streaming
- **Tool** (`src/tools/browserpod-tool.ts`): Agent-facing `browserpod_verify` tool
- **Types** (`src/types/verification-types.ts`): Session, result, framework interfaces
- **Web UI** (`tolu-cowork-web/`): Lit components for browser-side BrowserPod interaction

BrowserPod is **optional** — the Docker sandbox is the default execution environment. No BrowserPod dependency is required for core functionality.

## Stats

- **67 TypeScript files** (core) + **4 TypeScript files** (web components)
- **~11,000 lines production code**
- **~3,000 lines tests** (31 BrowserPod tests)
- **0 compilation errors**
- **MIT licensed** (all three source repos)

## License

MIT
