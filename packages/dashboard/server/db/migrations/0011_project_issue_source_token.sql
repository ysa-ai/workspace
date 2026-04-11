ALTER TABLE "projects" ADD COLUMN "issue_source_token" TEXT;
--> statement-breakpoint
UPDATE "projects" p SET "issue_source_token" = o."issue_source_token"
FROM "organizations" o WHERE o.id = p.org_id AND o."issue_source_token" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "issue_source_token";
