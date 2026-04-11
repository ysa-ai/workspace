CREATE TABLE "org_invitations" (
  "id" serial PRIMARY KEY,
  "org_id" integer NOT NULL REFERENCES "organizations"("id"),
  "role" text NOT NULL DEFAULT 'member',
  "token" text NOT NULL UNIQUE,
  "invited_by" integer REFERENCES "users"("id"),
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
