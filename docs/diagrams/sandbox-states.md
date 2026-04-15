# State Machine: Sandbox
Date: 2026-04-15
Source: `src/sandbox/sandbox-manager.ts`, `src/sandbox/docker-sandbox.ts`, `src/sandbox/path-sandbox.ts`, `src/sandbox/host-executor.ts`, `src/sandbox/sandbox-instance.ts`, `src/sandbox/types.ts`

## Diagram

```
                              ┌───────────────────────────────────┐
                              │    SandboxManager.createSandbox   │
                              └───────────────┬───────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────┐
                              │      VALIDATE_CONFIG       │
                              │  SandboxConfigSchema.parse │
                              │  level-specific checks     │
                              └──────┬──────────┬─────────┘
                                     │          │
                                valid          invalid
                                     │          │
                                     │          ▼
                                     │   ┌───────────────┐
                                     │   │ CREATE_FAILED │
                                     │   │ throw         │
                                     │   │ SandboxCreation│
                                     │   │ Error         │
                                     │   └───────────────┘
                                     │
                          ┌──────────┼──────────────────────────────────┐
                          │          │                                  │
                     level=none  level=path-only                   level=docker
                          │          │                                  │
                          ▼          ▼                                  ▼
                 ┌────────────┐ ┌──────────────┐              ┌──────────────────┐
                 │ HOST_CREATE│ │ PATH_CREATE  │              │  DOCKER_CREATE   │
                 │ new        │ │ new          │              │  new             │
                 │ HostSandbox│ │ PathSandbox  │              │  DockerSandbox   │
                 │            │ │ set allowed  │              │  check docker    │
                 │            │ │  roots       │              │  --version       │
                 │            │ │ set denied   │              │  docker create   │
                 │            │ │  paths       │              │  (image, mounts, │
                 │            │ │              │              │   limits, env)   │
                 │            │ │              │              │  docker start    │
                 └─────┬──────┘ └──────┬───────┘              └────────┬─────────┘
                       │               │                               │
                       │               │        init fails?            │
                       │               │          ┌────────────────────┘
                       │               │          │
                       │               │          ▼
                       │               │   ┌───────────────┐
                       │               │   │ CREATE_FAILED │
                       │               │   │ throw         │
                       │               │   │ SandboxCreation│
                       │               │   │ Error         │
                       │               │   └───────────────┘
                       │               │
                       └───────┬───────┘
                               │  sandboxes.set(id, sandbox)
                               ▼
                     ┌─────────────────────┐
                     │      RUNNING         │
                     │  status = "running"  │
                     │  sandbox registered  │
                     └──────────┬──────────┘
                                │
              ┌─────────────────┼─────────────────────┐
              │                 │                     │
    HostSandbox.execute   PathSandbox.execute   DockerSandbox.execute
              │                 │                     │
              │                 ▼                     │
              │    ┌────────────────────┐             │
              │    │  VALIDATE_PATH      │             │
              │    │  check denied paths │             │
              │    │  check allowed roots│             │
              │    └────────┬───────────┘             │
              │             │                         │
              │     denied? │ allowed?                │
              │     ┌───┴───┴───┐                     │
              │     │           │                     │
              │     ▼           ▼                     │
              │  ┌────────┐  ┌───────────────┐       │
              │  │DENIED  │  │ hostSandbox   │       │
              │  │ throw  │  │ .execute()    │       │
              │  │PathAcc │  │               │       │
              │  │Denied  │  └───────┬───────┘       │
              │  │Error   │          │               │
              │  └────────┘          │               │
              │                      │               ▼
              │                      │   ┌───────────────────────┐
              │                      │   │ docker exec <container>│
              │                      │   │ sh -c '<command>'     │
              │                      │   │ via hostSandbox        │
              │                      │   └───────────┬───────────┘
              │                      │               │
              └──────────────────────┴───────────────┘
                                │
                                ▼  (per execution)
                     ┌─────────────────────┐
                     │    EXEC_RESULT       │
                     │  { stdout, stderr,   │
                     │    exitCode,         │
                     │    duration, timedOut}
                     └──────────┬──────────┘
                                │
                                │  destroySandbox(id) called
                                ▼
          ┌─────────────────────────────────────────────────────┐
          │                   DESTROY                            │
          │  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
          │  │ HostSandbox │ │ PathSandbox  │ │DockerSandbox │  │
          │  │ (no-op)     │ │ status=      │ │ docker stop  │  │
          │  │             │ │  "stopped"   │ │ docker rm -f │  │
          │  │             │ │              │ │ ownsContainer│  │
          │  │             │ │              │ │  = false     │  │
          │  │             │ │              │ │ status=      │  │
          │  │             │ │              │ │  "stopped"   │  │
          │  └─────────────┘ └──────────────┘ └──────────────┘  │
          └─────────────────────────┬───────────────────────────┘
                                    │  sandboxes.delete(id)
                                    ▼
                         ┌─────────────────────┐
                         │      STOPPED         │
                         │  removed from registry│
                         │  instance unusable   │
                         └─────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  Isolation Level Comparison                                         │
  │                                                                     │
  │  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
  │  │  Level: None│  │ Level: PathOnly │  │   Level: Docker          │ │
  │  │             │  │                 │  │                          │ │
  │  │ Host exec   │  │ Host exec +     │  │ Container exec           │ │
  │  │ No path     │  │ path whitelist  │  │ docker exec via host     │ │
  │  │  restrict   │  │ denied paths    │  │ Full FS isolation        │ │
  │  │ All paths   │  │ blocklist       │  │ Resource limits (CPU,    │ │
  │  │ accessible  │  │                 │  │  mem, pids)              │ │
  │  │             │  │                 │  │ Volume mounts            │ │
  │  │ Fastest     │  │ Moderate        │  │ Network opt (none/host)  │ │
  │  │ No setup    │  │ setup           │  │ Strongest isolation      │ │
  │  └─────────────┘  └─────────────────┘  │ Requires Docker daemon   │ │
  │                                         └──────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────┘
```

## States

| State | Description | Data Shape |
|---|---|---|
| VALIDATE_CONFIG | Zod schema validation + level-specific config checks | `{ config: SandboxConfig, parsed: SafeParseReturnType }` |
| CREATE_FAILED | Validation or initialization error. SandboxCreationError thrown | `{ error: SandboxCreationError, id?: string }` |
| HOST_CREATE | HostSandbox instantiated (level=none). No isolation, direct host execution | `{ id: string, config: SandboxConfig, status: "running" }` |
| PATH_CREATE | PathSandbox instantiated (level=path-only). Sets `allowedRoots` + `deniedPaths` | `{ id: string, allowedRoots: string[], deniedPaths: string[] }` |
| DOCKER_CREATE | DockerSandbox instantiated + container initialized (level=docker). `docker create` → `docker start` | `{ id: string, image: string, containerName: string, workspaceMount: string, ownsContainer: true }` |
| RUNNING | Sandbox registered in manager map. Ready for `execute()` calls | `{ sandbox: SandboxInstance, info: SandboxInfo }` |
| VALIDATE_PATH | PathSandbox-specific: check target against denied list then allowed roots | `{ targetPath: string, mode: "read"\|"write"\|"execute" }` |
| DENIED | Path access denied. PathAccessDeniedError thrown | `{ resolved: string, mode: string, sandboxId: string }` |
| EXEC_RESULT | Command execution completed. Contains stdout, stderr, exit code, timing | `{ stdout: string, stderr: string, exitCode: number, duration: number, timedOut: boolean }` |
| DESTROY | Teardown in progress. Level-specific cleanup (no-op, status set, or container removed) | `{ ownsContainer: boolean }` |
| STOPPED | Sandbox destroyed and removed from registry. Instance must not be reused | `{ status: "stopped" }` |

## Transitions

| From | To | Trigger | Guard |
|---|---|---|---|
| (caller) | VALIDATE_CONFIG | `createSandbox(config)` called | — |
| VALIDATE_CONFIG | HOST_CREATE | `level === SandboxLevel.None` | Config valid |
| VALIDATE_CONFIG | PATH_CREATE | `level === SandboxLevel.PathOnly && config.pathSandbox` exists | Config valid |
| VALIDATE_CONFIG | DOCKER_CREATE | `level === SandboxLevel.Docker && config.docker` exists | Config valid |
| VALIDATE_CONFIG | CREATE_FAILED | Schema parse fails or level-specific block missing | — |
| DOCKER_CREATE | CREATE_FAILED | Docker unavailable or container create/start fails | — |
| HOST_CREATE | RUNNING | `sandboxes.set(id, sandbox)` | — |
| PATH_CREATE | RUNNING | `sandboxes.set(id, sandbox)` | — |
| DOCKER_CREATE | RUNNING | Container started, `sandboxes.set(id, sandbox)` | — |
| RUNNING | VALIDATE_PATH | `PathSandbox.execute()` called with `options.cwd` | Level is PathOnly |
| RUNNING | EXEC_RESULT | `HostSandbox.execute()` completes | Level is None |
| RUNNING | EXEC_RESULT | `DockerSandbox.execute()` → `docker exec` completes | Level is Docker |
| VALIDATE_PATH | DENIED | Path in denied list or outside allowed roots | — |
| VALIDATE_PATH | EXEC_RESULT | Path allowed, `hostSandbox.execute()` completes | Path within allowed roots |
| RUNNING | DESTROY | `destroySandbox(id)` called | — |
| DESTROY | STOPPED | Cleanup complete, `sandboxes.delete(id)` | — |
