ALTER TABLE connect_diagnostics ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'meta_test';
CREATE INDEX IF NOT EXISTS connect_diagnostics_scope_time ON connect_diagnostics(scope,observed_at);
ALTER TABLE connect_numbers ADD COLUMN IF NOT EXISTS runtime_key text;
