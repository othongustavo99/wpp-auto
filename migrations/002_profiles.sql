CREATE TABLE IF NOT EXISTS connect_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS connect_profiles (
 number_id text PRIMARY KEY REFERENCES connect_numbers(id),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings)='object')
);
INSERT INTO connect_profiles(number_id) VALUES ('forp_01'),('forp_02'),('forp_03') ON CONFLICT DO NOTHING;
-- Apply confirmed routes once; subsequent restarts preserve admin edits.
WITH applied AS (INSERT INTO connect_migrations(id) VALUES ('002_forp_confirmed_routes') ON CONFLICT DO NOTHING RETURNING id)
UPDATE connect_branches SET number_id=CASE id WHEN 'braganca' THEN 'forp_01' WHEN 'joanopolis' THEN 'forp_03' ELSE 'forp_02' END
WHERE id IN ('braganca','joanopolis','monte_verde','camanducaia','cambui') AND EXISTS(SELECT 1 FROM applied);
