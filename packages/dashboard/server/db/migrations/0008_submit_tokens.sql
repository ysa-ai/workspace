CREATE TABLE "submit_tokens" (
  "id" serial PRIMARY KEY,
  "issue_id" integer NOT NULL,
  "project_id" text NOT NULL,
  "phase" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" bigint NOT NULL
);
