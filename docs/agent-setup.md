# Agent setup

The ysa agent is a background daemon that runs on your machine (or a remote server) and connects to the dashboard to receive and execute AI tasks.

> **Important:** The published agent binary does not know where your dashboard is. You must always tell it the URL of your self-hosted instance with `--url`. Without it the agent won't know where to connect.

---

## Option A — Install the published binary

The easiest option. Pre-built binaries are available for macOS and Linux.

**macOS:**
```sh
brew install ysa-ai/tap/ysa-agent
```

**Linux:**
```sh
curl -fsSL https://get.ysa.ai/agent | sh
```

**npm (any platform):**
```sh
bun install -g @ysa-ai/agent
```

---

## Option B — Run from source

If you cloned this repo you already have the agent source in `packages/agent/`. You can run it directly without installing anything:

```sh
cd packages/agent
bun run src/index.ts start --url http://localhost:3333
```

This is identical to the published binary in behaviour — the source is the same. Use this if you want to inspect or modify the agent, or if you prefer not to install an external binary.

To run it as a persistent background process with the same flags, wrap it in a shell alias or a simple systemd/launchd unit pointing to `bun run src/index.ts`.

---

## Connect to your dashboard

**Local instance** (running via `bun run dev:dashboard` or `docker compose up`):
```sh
ysa-agent start --url http://localhost:3333
```

**VPS / remote instance:**
```sh
ysa-agent start --url https://your-domain.com
```

The agent will open a sign-in flow in your browser on first run. Your session is stored locally and reused on subsequent starts.

---

## Running as a persistent service

If you want the agent to start automatically on login rather than running it manually each time:

**macOS (launchd):**
```sh
ysa-agent install --url http://localhost:3333
```

**Linux (systemd):**
```sh
ysa-agent install --url http://localhost:3333
```

The `--url` is saved as part of the service configuration. To change it later, uninstall and reinstall the service:
```sh
ysa-agent uninstall
ysa-agent install --url https://your-new-url.com
```

---

## Verify

In the dashboard, open the sidebar menu → the agent status indicator should show as connected. You can also check from the terminal:
```sh
ysa-agent status
```

---

## Upgrade

```sh
# macOS
brew upgrade ysa-ai/tap/ysa-agent

# Linux / npm
bun install -g @ysa-ai/agent
```
