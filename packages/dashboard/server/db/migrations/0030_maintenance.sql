CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
--> statement-breakpoint
INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', 'false') ON CONFLICT DO NOTHING;
