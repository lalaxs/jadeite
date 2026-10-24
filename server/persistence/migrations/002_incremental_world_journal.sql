ALTER TABLE jade_world_snapshots
  ADD COLUMN IF NOT EXISTS last_mutation_id BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS jade_world_mutations (
  id BIGSERIAL PRIMARY KEY,
  snapshot_version INTEGER NOT NULL,
  saved_at BIGINT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  request_id TEXT,
  payload TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jade_world_mutations_saved_at_idx
  ON jade_world_mutations(saved_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS jade_world_mutations_request_idx
  ON jade_world_mutations(request_id, action)
  WHERE request_id IS NOT NULL;

INSERT INTO jade_schema_migrations(version)
VALUES (2)
ON CONFLICT (version) DO NOTHING;
