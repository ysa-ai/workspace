# Ysa Platform

## Project Overview
Turborepo monorepo with two editions of the same product — a sandboxed task runner that launches Claude CLI inside hardened Podman containers:

- **Core (CE)**: Standalone local tool. Task-based. CLI (`ysa`) + web UI. `packages/core/`
- **Dashboard (SaaS)**: Multi-issue workflow orchestrator with GitLab integration. 3 phases per issue: analyze → execute → finalize. `packages/dashboard/`

Both share `packages/shared/` for types, Zod schemas, log parsing, and resource polling.

## Quick Reference

| Action | Command |
|---|---|
| Build all | `bun run build` |
| Dev core | `bun run dev:core` (Vite :4001 + Hono :4000) |
| Dev dashboard | `bun run dev:dashboard` (Vite :5173 + Hono :3333) |
| Typecheck | `bun run typecheck` |
| Test | `bun run test` |
| DB migrations (dashboard) | `bun run --filter=@ysa-ai/dashboard db:migrate` |
| DB studio (dashboard) | `bun run --filter=@ysa-ai/dashboard db:studio` |

## Stack
- **Runtime**: Bun 1.2.4
- **Server**: Hono + tRPC 11 (end-to-end type safety)
- **Frontend**: React 19 + React Query + Tailwind CSS v4 (no tailwind.config — uses `@theme` in CSS)
- **Database**: SQLite (Bun native) + Drizzle ORM 0.44
- **Monorepo**: Turborepo + Bun workspaces
- **Containers**: Rootless Podman
- **Validation**: Zod 4
- **Config**: `.env` at monorepo root (see `.env.example`)

## Packages

### `packages/shared/`
Shared types and utilities. No build step — consumed directly as TypeScript.

| File | Contents |
|---|---|
| `src/types.ts` | Phase, Status, IssueStatus, TaskStatus |
| `src/protocol.ts` | WebSocket messages (DashboardCommand, AgentEvent, ResourceMetrics) |
| `src/schemas.ts` | Zod schemas for all protocol messages |
| `src/log-parser.ts` | Parses Claude CLI stream-json log entries |
| `src/resource-poller.ts` | Polls container + host resource metrics |

### `packages/core/`
Community Edition — standalone task runner with CLI + web UI.

```
src/
  api/           — tRPC routers
    tasks.ts       list, get, log, result, config
    task-actions.ts  run, stop, relaunch, continue, archive, delete, openTerminal
    system.ts      resource metrics
    config-store.ts  server config singleton
  cli/           — Commander CLI (bin: ysa)
    commands/      run, list, stop, logs, teardown
  db/            — Drizzle + SQLite
    schema.ts      tasks, containerPeaks tables
    migrations/    SQL migration files
  dashboard/     — React components (exported as library, props-based, no internal tRPC)
    CoreApp.tsx    main container — receives tasks/logEntries/callbacks as props
    TaskCard.tsx, TaskGrid.tsx, TaskDetail.tsx, RunPanel.tsx, StatusBadge.tsx, StatusFilter.tsx, ResourceBar.tsx
  runtime/       — sandbox orchestration
    runner.ts      runTask() — worktree → sandbox → parse output → update DB
    container.ts   spawnSandbox(), stopContainer(), teardownContainer()
    proxy.ts       proxy container lifecycle (startProxy, stopProxy, isProxyRunning)
    worktree.ts    git worktree create/remove/prepare
    auth.ts        OAuth token from macOS Keychain + refresh flow
    output.ts      parse Claude logs, detect max_turns/abort/errors
  server/        — Hono app (mounts tRPC + serves Vite assets)
container/       — security tooling (see Container section)
client/App.tsx   — React entry (wires tRPC queries to CoreApp props)
```

**Ports**: server on :4000, Vite dev on :4001 (proxies `/trpc` to :4000)

### `packages/dashboard/`
SaaS edition — issue-based workflow with WebSocket agent connection.

```
server/
  index.ts       — Hono app: tRPC + WebSocket upgrade + agent write API
  config.ts      — loads .env, validates required vars
  trpc/          — issues.ts, actions.ts, system.ts
  db/            — schema (issues, plans, results, qaCriteria, phasePrompts, containerPeaks)
  ws/            — WebSocket handler + dispatch
  lib/           — status (file-based), resources, utils
  logger.ts      — consola
client/
  App.tsx        — main dashboard (directly uses tRPC, not props-based like core)
  components/    — IssueCard, DetailPanel, LogViewer, PlanTab, ResultTab, etc.
```

**Ports**: server on :3333, Vite dev on :5173 (proxies `/trpc` to :3333)

**Extra HTTP endpoints** (non-tRPC, used by agent/container):
- `POST/GET /api/issues/:id/{plan,result,qa-criteria,prompt,status}`
- `POST/GET /api/prompt/:id` (core)
- `WS /ws/agent` (dashboard only)

### `packages/agent/`
Agent CLI daemon — uses core package for runtime. Minimal implementation.

- `src/lib/orchestrator.ts` — phase orchestration, prompt composition, tool whitelists
- `prompts/workflow/` — phase prompt templates (phase1-analyze.md, phase2-execute.md, phase3-finalize.md)
- Phase-based tool restrictions: analyze = read-only, execute = full, finalize = cleanup

## Container Security (`packages/core/container/`)

Each task runs in a rootless Podman container with defense-in-depth.

| File | Purpose |
|---|---|
| `Containerfile` | Hardened image: `oven/bun:1.2-alpine` (pinned digest), setuid removal, git hardening, dangerous utility removal, non-root user (UID 1001), baked-in CA cert for MITM proxy |
| `seccomp.json` | Whitelist-only (~190 syscalls). clone3→ENOSYS, clone flag-filtered, memfd_create blocked |
| `sandbox-run.sh` | Production launcher: mode-based access, worktree mounts, Claude settings init, prompt fetch, max-turns monitor, log capture, audit logging, network policy env vars |
| `git-safe-wrapper.sh` | Shadows `/usr/bin/git`, strips 38+ dangerous config keys (filters, hooks, pager, editor, SSH, proxy, credentials, aliases, includes) |
| `git-push-guard.sh` | Pre-push hook: blocks push to any branch except `$ALLOWED_BRANCH` |
| `container-sandbox-guard.sh` | Claude security hook: blocks destructive bash, .env reads, out-of-scope writes |
| `network-proxy.ts` | Bun MITM proxy (port 3128): inspects HTTP/HTTPS, enforces strict policy (GET-only, no body, no query params, entropy detection, rate limits) |
| `generate-ca.sh` | Generates self-signed CA cert + key for MITM proxy, installs in container trust store |
| `oci-network-hook.sh` | OCI hook: applies iptables rules in sandbox netns to force all traffic through proxy |
| `oci-hooks.d/network-policy.json` | OCI hook config: triggers on `network_policy=strict` annotation |
| `setup-network-hooks.sh` | One-time installer: copies OCI hook + config into Podman VM |
| `network-proxy-test.sh` | 60-test security validation for proxy + OCI hook (L7 + L3/L4) |
| `attack-test.sh` | 155-test security validation across 38 categories |
| `benchmark.sh` | Resource benchmarking for N parallel containers |
| `monitor.sh` | Live resource monitor (CPU/RAM/PIDs/disk) for running containers |
| `preflight-check.sh` | Host validation: Podman version, crun, rootless mode, image existence |

**Container flags**: `--cap-drop ALL`, `--read-only`, `--security-opt no-new-privileges`, `--security-opt seccomp=...`, `--tmpfs /tmp:rw,noexec,nosuid`, `--memory 4g`, `--cpus 2`, `--pids-limit 512`, `--timeout 3600`
- Network `none`: `--network slirp4netns` (full internet, no proxy)
- Network `strict`: `--network slirp4netns` + `--annotation network_policy=strict` + `HTTP_PROXY`/`HTTPS_PROXY` env vars pointing to proxy

**Invocation flow**: tRPC `taskActions.run()` → `runTask()` (runner.ts) → `spawnSandbox()` (container.ts) → `Bun.spawn(["bash", "sandbox-run.sh", ...])` → `podman run ...` → Claude CLI inside container

## Network Policy

Two enforcement layers protect against prompt injection data exfiltration:

**L7 — MITM Proxy** (`network-proxy.ts`, runs in `ysa-proxy` container on port 3128):
- HTTP: inspects method + URL, allow/deny per policy
- HTTPS CONNECT: terminates TLS with dynamic certs signed by baked-in CA, inspects decrypted request
- Strict policy: GET-only, no body, no query params, URL length cap (200), Shannon entropy detection on path segments (catches base64/hex encoding), rate limits (30 req/min, burst 10/5s), outbound byte budget (50KB/min), non-standard header stripping
- Bypass hosts: `host.containers.internal` (prompt/API), `api.anthropic.com` (Claude API), `statsig.anthropic.com` (feature flags)
- Telemetry (sentry.io, datadoghq.com) is intentionally NOT bypassed — blocked silently, hidden from UI via `HIDDEN_LOG_HOSTS`
- Lifecycle managed by `runtime/proxy.ts` — lazy start on first strict task, cleanup on server shutdown

**L3/L4 — OCI Hook** (`oci-network-hook.sh`, runs at `createRuntime` stage):
- iptables in sandbox netns: DROP all OUTPUT, ALLOW loopback + established + proxy port + server port
- ip6tables: DROP ALL, IPv6 disabled via sysctl
- Resolves `host.containers.internal` IP from OCI bundle hosts file (not gateway — they differ in slirp4netns)
- DNS allowed to gateway for slirp4netns DNS forwarder
- One-time install via `setup-network-hooks.sh` (re-run after `podman machine reset`)

**UI**: Network policy selector (default: Restricted, persisted to localStorage). Task detail shows separate Network section below Logs with ALLOW/BLOCK entries from proxy.

| Policy | Proxy | OCI Hook | UI Label |
|--------|-------|----------|----------|
| `none` | No | No | Full internet |
| `strict` | MITM, hardcoded rules | iptables enforcement | Restricted |

## Key Architecture Details

- **Worktrees**: each task/issue gets a git worktree. Container mounts worktree at `/workspace` + `.git` at `/repo.git`
- **Prompt delivery**: stored via `POST /api/prompt/:id`, container fetches via `PROMPT_URL` (curl from `host.containers.internal`)
- **RESULT.md**: tasks are instructed to write `/workspace/RESULT.md` — the UI reads it from the worktree and shows it in a Result tab
- **Log parsing**: Claude CLI outputs stream-json. Parser extracts session_id, max_turns, abort signals. Used for continue/relaunch logic
- **OAuth**: macOS Keychain integration for automatic token refresh (see `runtime/auth.ts`)
- **Polling**: React Query — 5s for task list/resources, 3s for logs when a task is running
- **iTerm2**: `openTerminal` action spawns an iTerm2 window for manual intervention on a worktree

## Agent Release (`@ysa-ai/agent`)

Triggered by `git tag agent-vX.Y.Z && git push --tags` — GHA builds 4 binaries and publishes to npm automatically.

**Distribution channels:**
- Homebrew: `brew install ysa-ai/tap/ysa-agent`
- curl: `curl -fsSL https://raw.githubusercontent.com/ysa-ai/agent/main/install.sh | sh`
- npm: `bun install -g @ysa-ai/agent`

The homebrew tap is updated automatically by CI after each release.

**Secrets required** (platform repo → Settings → Secrets → Actions):
- `NPM_TOKEN` — fine-grained token with publish rights to `@ysa-ai/*`
- `AGENT_RELEASE_PAT` — fine-grained PAT, `contents: write` on `ysa-ai/agent`

## Plan Progress
- CE Extraction Phase 5 — Separate Repo + Publish 🔲 (`plans/ce-extraction-phase5.md`)

## Rules

### NEVER commit without user confirmation
- **Always ask** before committing — confirm the user has tested the changes
- No exceptions: not for "small" changes, not for chores, not for fixes

### NEVER mention Claude, AI, or any AI tool
- **Commits**: No "Co-Authored-By: Claude", no "Generated with Claude", no AI attribution of any kind
- **Pull requests**: No mention of AI assistance in PR descriptions
- **Code comments**: No "generated by", "assisted by", or similar
- **Commit messages**: Write them as if a human developer wrote the code

### Code style
- Keep it simple, no over-engineering
- Prefer editing existing files over creating new ones
- No unnecessary comments, docstrings, or type annotations on unchanged code
- No inline comments explaining what the code does — code should be self-explanatory
- Files should not exceed ~300 lines in most cases — split into smaller modules when approaching that limit

### Shell scripts
- Target bash 3.2 (macOS default) — no `declare -A` (associative arrays), no bash 4+ features
- `/tmp` is symlinked to `/private/tmp` on macOS — Podman VM can't resolve it. Use `$HOME/.cache/` for bind mounts
- Never embed shell operators (`>`, `|`) inside string variables intended to be expanded as commands — pass them at the call site
