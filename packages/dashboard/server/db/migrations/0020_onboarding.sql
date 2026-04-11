ALTER TABLE users ADD COLUMN onboarding_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN onboarding_completed_at TEXT;
ALTER TABLE users ADD COLUMN onboarding_role TEXT;
ALTER TABLE users ADD COLUMN onboarding_team_size TEXT;
ALTER TABLE users ADD COLUMN onboarding_use_case TEXT;
