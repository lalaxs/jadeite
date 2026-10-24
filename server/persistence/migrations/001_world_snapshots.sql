CREATE TABLE IF NOT EXISTS jade_schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jade_world_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_version INTEGER NOT NULL,
  saved_at BIGINT NOT NULL,
  player_count INTEGER NOT NULL,
  payload TEXT NOT NULL,
  checksum CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jade_world_snapshots_saved_at_idx
  ON jade_world_snapshots(saved_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS jade_audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  request_id TEXT,
  outcome TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS jade_player_projection (
  player_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  cash BIGINT NOT NULL CHECK (cash >= 0),
  reputation DOUBLE PRECISION NOT NULL,
  level INTEGER NOT NULL CHECK (level >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jade_ledger_entries (
  player_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  amount BIGINT NOT NULL,
  balance_before BIGINT,
  balance_after BIGINT,
  note TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (player_id, entry_id)
);

CREATE INDEX IF NOT EXISTS jade_ledger_entries_player_time_idx
  ON jade_ledger_entries(player_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS jade_idempotency_keys (
  player_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, request_id)
);

CREATE TABLE IF NOT EXISTS jade_inventory_projection (
  item_id TEXT PRIMARY KEY,
  owner_player_id TEXT NOT NULL,
  location TEXT NOT NULL,
  item_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jade_inventory_projection_owner_idx
  ON jade_inventory_projection(owner_player_id, location);

CREATE UNIQUE INDEX IF NOT EXISTS jade_audit_request_action_idx
  ON jade_audit_log(request_id, action)
  WHERE request_id IS NOT NULL;

INSERT INTO jade_schema_migrations(version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
