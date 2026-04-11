# ysa workspace

**Orchestrate AI agents in parallel, safely, on your own infra.**

[Quick start](#quick-start) · [Features](#features) · [Agent setup](#connecting-the-agent) · [Docs](#documentation) · [Self-hosting](#docker)

<br>

## What is ysa workspace?

A self-hosted task runner that launches AI agents in parallel, each sandboxed inside a hardened container with a built-in network proxy. Define your workflows, connect an agent daemon to your machine, and watch every task in real time from a shared dashboard.

<br>

## Problems ysa workspace solves

| Without ysa workspace                                                                                                       | With ysa workspace                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You open a new Claude tab for each task and lose track of what's running. On reboot, everything is gone.                 | ✅ Every task is tracked, logs persist, and agents run headless in the background.                                                  |
| ❌ You re-explain your process to every new agent session. There is no memory of how your team works.                       | ✅ You define the workflow once: phases, prompts, behaviours. Every agent run follows the same process.                             |
| ❌ You run one agent at a time because running more in your editor is chaos.                                                 | ✅ Launch as many agents as you want in parallel. The dashboard shows all of them in real time.                                     |
| ❌ You run agents directly on your machine and hope they don't break your codebase, or worse, take control of it via prompt injection. | ✅ Each agent runs in a sandboxed container. Fully isolated, no shared state, no side effects.                                      |
| ❌ You have no idea what your agent is calling on the internet. It could be leaking your code anywhere.                     | ✅ A built-in network proxy enforces strict allow-lists. You decide exactly what the agent can reach.                               |
| ❌ Every developer runs agents their own way. No shared process, no visibility into what teammates are working on.           | ✅ Your team shares the same dashboard, the same workflows, and can see and interact with each other's running tasks.               |

<br>

## Is it right for you?

ysa workspace is a good fit if you want to:

- **Run many agents in parallel** at full speed using headless mode, each on its own branch
- **Enforce network isolation:** you decide what the AI can and can't call on the internet
- **Define multi-step workflows:** plan → execute → review, with custom behaviours per phase
- **Self-host everything:** your code never leaves your infra, no vendor lock-in, MIT licensed
- **Observe what's happening:** real-time log streaming, per-task results, connected agent status

<br>

## What it is not

- **Not a hosted AI service.** There is no cloud execution. Everything runs on your machine or your VPS.
- **Not a prompt playground.** It's a task runner for teams that need structured, repeatable AI workflows.
- **Not opinionated about your stack.** It works on any git repo, following the workflow you built.

<br>

## Features

| Feature | |
|---|---|
| **Parallel task execution** | Run as many agents as your machine can handle, each with its own isolated container and git worktree |
| **Sandboxed containers** | Rootless Podman with `--cap-drop ALL`, read-only filesystem, custom seccomp profile |
| **Network proxy** | Built-in MITM proxy enforces strict allow-lists: GET-only, no exfiltration, Shannon entropy detection on URLs |
| **Multi-step workflows** | Define plan → execute → review phases with custom behaviours per project |
| **Real-time dashboard** | Live log streaming, result tabs, agent status, shareable across your team |
| **Built for teams** | Share workflows, review each other's tasks, and keep everyone on the same process |
| **Self-hostable** | Docker Compose, MIT licensed, zero external dependencies |
| **Agent daemon** | Lightweight background process that connects your machine to the dashboard |

<br>

## Quick start

### Local (no Docker)

**Prerequisites:** Bun 1.2+, PostgreSQL

```sh
git clone https://github.com/ysa-ai/workspace
cd workspace
bun install
bun run build
bun run start:dashboard
```

Connects to `postgresql://localhost:5432/ysa` by default (your OS user, no password). Works out of the box with a local Postgres installed via Homebrew or apt with no auth configured. `MASTER_KEY` and `AUTH_SECRET` are auto-generated on first run and written to `.env`.

If your database is elsewhere, set `DATABASE_URL` in a `.env` file at the repo root — the connecting user must be owner of the database or have superuser privileges.

Open [http://localhost:3333](http://localhost:3333) and create your account.

### Docker

**Prerequisites:** Docker with Compose v2

```sh
git clone https://github.com/ysa-ai/workspace
cd workspace
cp .env.example .env
# Set POSTGRES_PASSWORD at minimum
docker compose up
```

Open [http://localhost:3333](http://localhost:3333) and create your account.

For a full production VPS setup (TLS, reverse proxy, persistent storage) see [docs/vps-setup.md](docs/vps-setup.md).

<br>

## Connecting the agent

The agent daemon runs on your machine and connects to the dashboard to receive and execute tasks.

**Install the published binary:**

```sh
# macOS
brew install ysa-ai/tap/ysa-agent

# Linux
curl -fsSL https://get.ysa.ai/agent | sh

# npm (any platform)
bun install -g @ysa-ai/agent
```

**Or run from source** — if you cloned this repo you already have it:

```sh
cd packages/agent && bun run src/index.ts start --url http://localhost:3333
```

**Start** — point it at your dashboard:

```sh
ysa-agent start --url http://localhost:3333
```

> **Note:** The `--url` flag is required. The published binary does not know where your self-hosted dashboard is. Use your VPS domain if connecting to a remote instance.

See [docs/agent-setup.md](docs/agent-setup.md) for full setup instructions, including running as a persistent service.

<br>

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_PASSWORD` | Local | | Password for the PostgreSQL `app` user |
| `ORIGIN` | VPS | | Public URL of your instance (e.g. `https://ysa.example.com`). Required for OAuth callbacks and email links. |
| `MASTER_KEY` | No | auto-generated | 64-char hex key that encrypts secrets at rest. Auto-generated on first run and written to `.env`. Set it explicitly on VPS to ensure it never changes. |
| `AUTH_SECRET` | No | auto-generated | Signing key for JWT tokens. Auto-generated on first run. Set it explicitly on VPS so sessions survive restarts. |
| `SIGNUP_DISABLED` | No | `false` | Set `true` to disable public sign-ups (invite-only). |
| `DASHBOARD_PORT` | No | `3333` | Port the server listens on. |
| `RESEND_API_KEY` | No | | Enables password reset and email change via [Resend](https://resend.com). |
| `FROM_EMAIL` | No | | Sender address for emails. Required when `RESEND_API_KEY` is set. |
| `GOOGLE_CLIENT_ID` | No | | Enables Google OAuth sign-in. |
| `GOOGLE_CLIENT_SECRET` | No | | Google OAuth secret. |
| `VITE_GOOGLE_CLIENT_ID` | No | | Same as `GOOGLE_CLIENT_ID`, baked into the frontend at build time to show the Google button. |

See [docs/configuration.md](docs/configuration.md) for the full reference.

<br>

## Telemetry

ysa workspace reports anonymous usage data (instance ID + event name) to help us improve the project. No PII is collected, no user data, no code, no prompts.

**Events reported:** `instance.started`, `agent.connected`

To opt out, set `YSA_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` in your environment.

<br>

## Documentation

- [Local development setup](docs/installation.md)
- [VPS / production setup](docs/vps-setup.md)
- [Agent setup](docs/agent-setup.md)
- [Configuration reference](docs/configuration.md)

<br>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

<br>

## License

[MIT](LICENSE)
