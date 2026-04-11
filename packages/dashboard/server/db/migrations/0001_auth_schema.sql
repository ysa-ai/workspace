CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_members" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id" INTEGER NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'member',
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE("user_id", "org_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
