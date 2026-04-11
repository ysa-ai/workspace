ALTER TABLE users ADD COLUMN email_verified_at timestamp;
--> statement-breakpoint
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;
--> statement-breakpoint
CREATE TABLE email_verification_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE password_reset_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE email_change_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
