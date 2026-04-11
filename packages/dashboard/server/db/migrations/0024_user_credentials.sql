CREATE TABLE "user_credentials" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "provider" text NOT NULL,
  "type" text NOT NULL,
  "encrypted_value" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("user_id", "name")
);
