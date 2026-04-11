import { db } from "../db";
import { userProjectSettings, projects } from "../db/schema";
import { config } from "../config";
import { encrypt } from "./crypto";
import { and, eq } from "drizzle-orm";

const ENCRYPTED_PREFIX = "enc:";

/**
 * Encrypts any plaintext values in user_project_settings.issue_source_token
 * and projects.issue_source_token.
 * Safe to run on every startup — already-encrypted values are skipped.
 */
export async function migrateEncryptKeys(): Promise<void> {
  try {
    // Migrate user_project_settings.issue_source_token
    const userSettings = await db.select().from(userProjectSettings);
    for (const row of userSettings) {
      if (!row.issue_source_token || row.issue_source_token.startsWith(ENCRYPTED_PREFIX)) continue;
      await db.update(userProjectSettings)
        .set({ issue_source_token: encrypt(row.issue_source_token, config.masterKey) })
        .where(and(eq(userProjectSettings.user_id, row.user_id), eq(userProjectSettings.project_id, row.project_id)));
      console.log(`[crypto] Migrated user settings for user ${row.user_id} / project ${row.project_id}`);
    }

    // Migrate projects.issue_source_token
    const projectRows = await db.select({ project_id: projects.project_id, issue_source_token: projects.issue_source_token }).from(projects);
    for (const row of projectRows) {
      if (!row.issue_source_token || row.issue_source_token.startsWith(ENCRYPTED_PREFIX)) continue;
      await db.update(projects)
        .set({ issue_source_token: encrypt(row.issue_source_token, config.masterKey) })
        .where(eq(projects.project_id, row.project_id));
      console.log(`[crypto] Migrated project token for project ${row.project_id}`);
    }
  } catch (err: any) {
    console.error("[crypto] Migration error:", err.message);
  }
}
