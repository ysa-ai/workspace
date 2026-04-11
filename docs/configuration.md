# Configuration reference

All configuration is done via environment variables. Copy `.env.example` to `.env` and edit it.

## Database

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://localhost:5432/ysa` | PostgreSQL connection string. For Docker, this is set automatically. |
| `POSTGRES_PASSWORD` | — | Password for the `app` database user. Used in the Docker Compose setup. |

## Security

| Variable | Default | Description |
|---|---|---|
| `MASTER_KEY` | auto-generated | 64-char hex key used to encrypt secrets (API keys, tokens) at rest. Auto-generated on first run and written to `.env`. **Set explicitly on VPS** so it survives restarts. Generate with `openssl rand -hex 32`. |
| `AUTH_SECRET` | auto-generated | Secret used to sign JWT tokens. **Set explicitly on VPS**. Generate with `openssl rand -hex 32`. |

## Instance

| Variable | Default | Description |
|---|---|---|
| `ORIGIN` | derived from request | Public URL of your instance, e.g. `https://ysa.example.com`. Required for OAuth callbacks and email links on VPS deployments. |
| `DASHBOARD_PORT` | `3333` | Port the server listens on. |
| `SIGNUP_DISABLED` | `false` | Set `true` to disable public sign-ups. Users must be invited. |

## Email (optional)

Email features (password reset, email change) require a [Resend](https://resend.com) account.

| Variable | Default | Description |
|---|---|---|
| `RESEND_API_KEY` | — | Resend API key. When not set, password reset and email change return a clear error. |
| `FROM_EMAIL` | — | Sender address for emails (e.g. `noreply@example.com`). Required when `RESEND_API_KEY` is set. |

## Google OAuth (optional)

| Variable | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID (server-side). |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret. |
| `VITE_GOOGLE_CLIENT_ID` | — | Same as `GOOGLE_CLIENT_ID` — baked into the frontend at build time to show the "Sign in with Google" button. Must match `GOOGLE_CLIENT_ID`. |

To set up Google OAuth:
1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Google+ API
3. Create OAuth 2.0 credentials (Web application)
4. Add `{ORIGIN}/auth/google/callback` as an authorized redirect URI

## Telemetry

| Variable | Default | Description |
|---|---|---|
| `YSA_TELEMETRY_DISABLED` | — | Set `1` to disable anonymous server-side telemetry. |
| `DO_NOT_TRACK` | — | Set `1` to disable all telemetry (client + server). |
