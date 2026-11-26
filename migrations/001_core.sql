CREATE TABLE IF NOT EXISTS connect_numbers (
  id text PRIMARY KEY,
  label text NOT NULL,
  display_number text,
  phone_id text UNIQUE,
  waba_id text,
  enabled boolean NOT NULL DEFAULT false,
  is_test boolean NOT NULL DEFAULT false,
  CHECK (NOT enabled OR (phone_id IS NOT NULL AND waba_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS connect_branches (
  id text PRIMARY KEY,
  name text NOT NULL,
  number_id text REFERENCES connect_numbers(id)
);
CREATE TABLE IF NOT EXISTS connect_sessions (
  number_id text NOT NULL REFERENCES connect_numbers(id),
  contact_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('menu','reminded','handoff')),
  branch_id text REFERENCES connect_branches(id),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(number_id,contact_hash)
);
CREATE TABLE IF NOT EXISTS connect_events (
  number_id text NOT NULL REFERENCES connect_numbers(id),
  message_hash text NOT NULL,
  contact_hash text NOT NULL,
  recipient text,
  intent jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','uncertain','expired')),
  PRIMARY KEY(number_id,message_hash)
);
CREATE INDEX IF NOT EXISTS connect_events_pending ON connect_events(created_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS connect_sessions_expiry ON connect_sessions(expires_at);
INSERT INTO connect_numbers(id,label,display_number) VALUES
 ('forp_01','FORP 01','5511914622444'),('forp_02','FORP 02','5535988850459'),('forp_03','FORP 03','5511999903346') ON CONFLICT(id) DO NOTHING;
INSERT INTO connect_branches(id,name) VALUES ('cambui','Cambuí'),('camanducaia','Camanducaia'),('monte_verde','Monte Verde'),('joanopolis','Joanópolis'),('braganca','Bragança Paulista') ON CONFLICT(id) DO NOTHING;
