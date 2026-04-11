import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import * as schema from "../db/schema";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getTestDb() {
  if (_db) return _db;

  const client = new PGlite();

  const migrationsDir = join(import.meta.dir, "../db/migrations");
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const content = await readFile(join(migrationsDir, file), "utf-8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }

  _db = drizzle(client as any, { schema });
  return _db;
}
