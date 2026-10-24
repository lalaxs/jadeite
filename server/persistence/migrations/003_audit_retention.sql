CREATE INDEX IF NOT EXISTS jade_audit_log_occurred_at_idx
  ON jade_audit_log(occurred_at);

INSERT INTO jade_schema_migrations(version)
VALUES (3)
ON CONFLICT (version) DO NOTHING;
