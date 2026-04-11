# Contributing

## Local development setup

**Prerequisites**: Bun 1.2+, PostgreSQL running on localhost:5432

```sh
git clone https://github.com/ysa-ai/workspace
cd workspace
bun install
```

Start the dashboard:
```sh
bun run dev:dashboard
```

This starts both the Hono server (:3333) and the Vite dev server (:5173). Open http://localhost:5173.

No `.env` file is required for local development — `MASTER_KEY` and `AUTH_SECRET` are auto-generated on first run, and `DATABASE_URL` defaults to `postgresql://localhost:5432/ysa`.

## Running tests

```sh
bun run test
```

Or for a specific package:
```sh
bun test --preload ./test-preload.ts server/lib/ server/trpc/
```

## Typechecking

```sh
bun run typecheck
```

## Project structure

```
packages/
  shared/     — shared types and utilities (no build step)
  dashboard/  — web dashboard: server (Hono + tRPC) + client (React)
  agent/      — agent daemon (connects machine to dashboard)
```

See [CLAUDE.md](CLAUDE.md) for a detailed architecture reference.

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Run typecheck and tests before submitting
- No AI attribution in commits or PR descriptions
