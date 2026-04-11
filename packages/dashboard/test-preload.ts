import { mock } from "bun:test";
import { getTestDb } from "./server/lib/test-db";

(globalThis as any).__testDb = await getTestDb();

// Mock server startup modules so tests that import `app` from server/index.ts
// don't trigger real postgres connections or migrations.
mock.module("./server/db", () => ({ db: (globalThis as any).__testDb }));
mock.module("./server/db/migrate", () => ({ runMigrations: () => Promise.resolve() }));
mock.module("./server/lib/crypto-migrate", () => ({ migrateEncryptKeys: () => Promise.resolve() }));
mock.module("./server/lib/telemetry", () => ({ telemetry: () => Promise.resolve() }));
mock.module("./server/lib/email", () => ({ sendEmail: () => Promise.resolve() }));
