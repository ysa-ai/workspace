# Installation

There are three ways to run ysa workspace:

| Setup | When to use |
|---|---|
| [Local server + local Postgres](#local-server--local-postgres) | Quickest to get started, no Docker needed |
| [Local server + Docker Postgres](#local-server--docker-postgres) | You prefer Docker for the database but want to run the server natively |
| [Full Docker](#full-docker) | Everything containerised — closer to a production setup |

---

## Local server + local Postgres

**Prerequisites**: Bun 1.2+, PostgreSQL running on localhost:5432

```sh
git clone https://github.com/ysa-ai/workspace
cd workspace
createdb ysa        # if the database doesn't exist yet
bun install
bun run build
bun run start:dashboard
```

Open http://localhost:3333. `MASTER_KEY` and `AUTH_SECRET` auto-generate on first run and are written to `.env`. No configuration needed.

If your Postgres is on a different host or requires a password, set `DATABASE_URL` in a `.env` file:
```
DATABASE_URL=postgresql://user:password@host:5432/ysa
```

---

## Local server + Docker Postgres

**Prerequisites**: Bun 1.2+, Docker with Compose v2

Create a `.env` file:
```
POSTGRES_PASSWORD=changeme
DATABASE_URL=postgresql://app:changeme@localhost:5432/ysa
```

Start only the database container:
```sh
git clone https://github.com/ysa-ai/workspace
cd workspace
docker compose up postgres -d
```

Then run the server locally:
```sh
bun install
bun run build
bun run start:dashboard
```

Open http://localhost:3333.

---

## Full Docker

**Prerequisites**: Docker with Compose v2

```sh
git clone https://github.com/ysa-ai/workspace
cd workspace
cp .env.example .env
```

Edit `.env` and set the required values:
```
POSTGRES_PASSWORD=changeme
MASTER_KEY=         # openssl rand -hex 32
AUTH_SECRET=        # openssl rand -hex 32
```

Then build and start:
```sh
docker compose up --build -d
```

Open http://localhost:3333.

> `MASTER_KEY` and `AUTH_SECRET` are required when running with Docker — the server will refuse to start without them. They encrypt your data and sign sessions, so they must not change between restarts.

For a full production VPS setup (TLS, reverse proxy, persistent storage) see [vps-setup.md](vps-setup.md).

---

## Upgrading

**Local:**
```sh
git pull
bun install
bun run build
bun run start:dashboard
```

**Docker:**
```sh
git pull
docker compose build
docker compose up -d
```

---

## Contributing / local development

If you are working on the codebase itself, use the dev server — it gives you hot reload on both the frontend and the server:

```sh
bun run dev:dashboard
```

This starts the Hono server on :3333 and Vite on :5173. The server proxies frontend requests from :3333 to :5173 automatically, so the agent can still connect to :3333.
