CREATE TABLE "device_auth_codes" (
  "id" serial PRIMARY KEY,
  "device_code" text NOT NULL UNIQUE,
  "user_code" text NOT NULL UNIQUE,
  "user_id" integer REFERENCES "users"("id"),
  "org_id" integer REFERENCES "organizations"("id"),
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
