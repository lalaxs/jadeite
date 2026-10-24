-- Request deduplication belongs to the player's retained 200-key history.
-- The journal is an ordered record of committed changes, never a request gate.
-- Reusing a key after eviction or on another player must not drop a commit.
DROP INDEX IF EXISTS jade_world_mutations_request_idx;
DROP INDEX IF EXISTS jade_audit_request_action_idx;
CREATE INDEX IF NOT EXISTS jade_world_mutations_actor_request_idx
  ON jade_world_mutations(actor_id, request_id, action) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jade_audit_actor_request_idx
  ON jade_audit_log(actor_id, request_id, action) WHERE request_id IS NOT NULL;
