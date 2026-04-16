# Ysa Platform

## Project Overview
Turborepo monorepo — a sandboxed task runner that launches an AI agent inside hardened containers.

- **Workspace**: Multi-issue workflow orchestrator with GitLab integration. `packages/dashboard/`
- **Agent**: CLI daemon that connects to Workspace and executes tasks in containers. `packages/agent/`

Both share `packages/shared/` for types, Zod schemas, log parsing, and resource polling.

## Quick Reference

| Action | Command |
|---|---|
| Build all | `bun run build` |
| Dev Workspace | `bun run dev:dashboard` (Vite :5173 + Hono :3333) |
| Typecheck | `bun run typecheck` |
| Test | `bun run test` |
| DB migrations | `bun run --filter=@ysa-ai/dashboard db:migrate` |
| DB studio | `bun run --filter=@ysa-ai/dashboard db:studio` |

## Stack
- **Runtime**: Bun 1.2.4
- **Server**: Hono + tRPC 11 (end-to-end type safety)
- **Frontend**: React 19 + React Query + Tailwind CSS v4 (no tailwind.config — uses `@theme` in CSS)
- **Database**: Postgres + Drizzle ORM 0.44
- **Monorepo**: Turborepo + Bun workspaces
- **Containers**: Rootless Podman
- **Validation**: Zod 4
- **Auth**: JWT (jose), bcrypt (Bun native), Google OAuth
- **Analytics**: PostHog
- **Config**: `.env` at monorepo root (see `.env.example`)

## Packages

### `packages/shared/`
Shared types and utilities. No build step — consumed directly as TypeScript.

| File | Contents |
|---|---|
| `src/types.ts` | Phase, Status, TaskStatus, WorkflowStep interfaces |
| `src/protocol.ts` | WebSocket messages (DashboardCommand, AgentEvent, ResourceMetrics) |
| `src/schemas.ts` | Zod schemas for all protocol messages |
| `src/log-parser.ts` | Parses agent stream-json log entries |
| `src/resource-poller.ts` | Polls container + host resource metrics |
| `src/providers/` | LLM provider abstraction (Claude, Mistral adapters) |

### `packages/dashboard/` — Workspace
Issue-based workflow orchestrator with WebSocket agent connection.

```
server/
  index.ts           — Hono app: tRPC + WebSocket upgrade + auth routes
  config.ts          — loads .env, validates required vars
  logger.ts          — consola
  db/
    schema.ts        — 20+ tables (see below)
    index.ts         — Drizzle DB instance
    migrate.ts       — migration runner
  trpc/
    router.ts        — combines all routers
    auth.ts          — login, register, orgs, invitations, device auth, Google OAuth
    tasks.ts         — task CRUD, status, logs
    projects.ts      — project CRUD, config, bootstrap
    actions.ts       — task actions: submit, refine, stop, workflow transitions
    workflows.ts     — workflow + tool preset CRUD
    system.ts        — system info
  routes/
    auth.ts          — HTTP auth endpoints (register, login, OAuth, device, refresh)
    container-api.ts — container write API (used by agent)
  ws/
    handler.ts       — WebSocket connection + message handling
    dispatch.ts      — send commands to agents
    agent-commands.ts
    status-update.ts
  lib/
    auth.ts / auth-helpers.ts / auth-guard.ts
    build-manager.ts — build lifecycle management
    blockers.ts      — task blocking logic
    crypto.ts        — encryption/decryption of sensitive DB values
    email.ts         — email sending
    gitlab.ts        — GitLab integration
    project-bootstrap.ts — auto-detect stack from repo
    rate-limit.ts
    resources.ts     — resource tracking
    status.ts        — task status management
    telemetry.ts     — event tracking

client/
  App.tsx            — main router, task list, project selector
  AuthProvider.tsx   — auth state management
  main.tsx           — tRPC + React Query setup
  trpc.ts            — tRPC client config
  pages/             — Login, Register, Google callback, Device auth, Password reset, Email verify
  components/
    IssueList/Row/Detail/Input — task list and detail views
    LogViewer.tsx    — live log display
    WorkflowBuilder.tsx — visual workflow editor
    ProjectCreationWizard/ — multi-step project setup (6 steps)
    ProjectSettingsPanel/ — project config (general, build, container, integrations, security, workflows)
    SidebarMenu.tsx  — main navigation
    OrgSwitcher.tsx  — organization switcher
    modules/         — workflow module UIs (ChangeReport, DeliverySection, ManualQA, UnitTests, IssueUpdate)
  lib/
    auth.ts          — JWT token management
    analytics.ts     — PostHog integration
```

**Ports**: server on :3333, Vite dev on :5173 (proxies `/trpc` to :3333)

**Database tables**: users, sessions, organizations, org_members, org_invitations, projects, user_project_settings, user_project_credential_preferences, tasks, step_prompts, task_workflow_states, workflows, workflow_steps, workflow_transitions, tool_presets, step_results, step_module_data, container_peaks, email_verification_tokens, password_reset_tokens, email_change_tokens, device_auth_codes, submit_tokens, app_settings

**HTTP endpoints** (non-tRPC):
- `GET /health`
- `POST /auth/{register,login,logout,refresh,forgot-password,resend-verification}`
- `POST /auth/device/{init,token,approve}`
- `POST /auth/google` + `POST /auth/google/callback`
- `GET /auth/me`
- `POST /api/container/*` (used by agent)
- `WS /ws/agent`

**Key env vars**:
- `DATABASE_URL` — Postgres connection string
- `MASTER_KEY` — encryption key for sensitive DB values
- `AUTH_SECRET` — JWT signing secret
- `ORIGIN` — CORS origin
- `APP_HOSTNAME` — hostname for generated URLs
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `SIGNUP_DISABLED` — disable new registrations
- `MIN_AGENT_VERSION` — minimum allowed agent version

### `packages/agent/`
Agent CLI daemon (`ysa-agent`) — connects to Workspace, executes tasks in containers.

```
src/
  commands/
    start.ts         — connect to dashboard, handle tasks
    init.ts          — initialize agent
    auth.ts          — login flow, OAuth
    credential.ts    — manage credentials
    service.ts       — install/uninstall as system service
    refine.ts        — refine tasks
  lib/
    executor.ts      — execute task phases
    phase-runner.ts  — run build/test phases
    prompt.ts        — build LLM prompts
    modules.ts       — load workflow modules
    monitor.ts       — monitor container execution
    recover.ts       — recover stuck tasks
    token-refresh.ts — refresh auth tokens
    tools.ts         — LLM tool definitions
    keystore.ts      — manage API keys
    credentials.ts   — store/load auth tokens
    config.ts / config-store.ts
    container-init.ts
  ws/
    client.ts        — WebSocket connection to dashboard
    send.ts          — send messages to dashboard
    parse-build-line.ts
```

**Commands**: `ysa-agent start`, `ysa-agent init`, `ysa-agent auth login|logout|device`, `ysa-agent credential add|remove|list`, `ysa-agent service install|uninstall`

## Key Architecture Details

- **Worktrees**: each task gets a git worktree. Container mounts worktree at `/workspace`
- **Prompt delivery**: stored server-side, agent fetches via `PROMPT_URL`
- **WebSocket protocol**: agent → dashboard (status updates, log chunks, errors) / dashboard → agent (execute, continue, refine, stop, cleanup). Auto-reconnect with backoff, 60s idle timeout
- **Workflow system**: multi-step processes with prompt templates, tool presets, container modes, transitions, and modules per step
- **Build manager**: tracks build lifecycle (image build, container run) with status updates streamed to dashboard
- **Polling**: React Query — 5s for task list/resources, 3s for logs when a task is running
- **Testing**: Bun test runner + PGLite (in-memory Postgres) for integration tests

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
