FROM oven/bun:1.2.4-alpine AS builder

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/agent/package.json ./packages/agent/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY packages/dashboard ./packages/dashboard
# Build frontend
ARG VITE_POSTHOG_KEY
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
ENV NODE_ENV=production
RUN cd packages/dashboard && bun run build

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM oven/bun:1.2.4-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/dashboard ./packages/dashboard
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3333

CMD ["bun", "packages/dashboard/server/index.ts"]
