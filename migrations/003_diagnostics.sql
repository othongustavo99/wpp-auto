CREATE TABLE IF NOT EXISTS connect_diagnostics (
 event_key text PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('incoming','sent','delivered','read','failed','accepted','send_error')),
 error_codes integer[] NOT NULL DEFAULT '{}',
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connect_diagnostics_time ON connect_diagnostics(observed_at);
