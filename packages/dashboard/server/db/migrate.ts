import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";
import { join } from "path";

const migrationsFolder = join(import.meta.dir, "migrations");

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}


if (import.meta.main) {
  await runMigrations();
  const { log } = await import("../logger");
  log.success("Migrations applied successfully");
  process.exit(0);
}
