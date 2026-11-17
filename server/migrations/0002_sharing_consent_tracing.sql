CREATE TABLE share_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by text NOT NULL REFERENCES "user"(id),
  content text NOT NULL,
  source_version integer NOT NULL CHECK(source_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,source_version),
  UNIQUE(event_id,id)
);

INSERT INTO share_snapshots(event_id,created_by,content,source_version)
SELECT DISTINCT old.event_id,e.owner_id,old.content,old.version
FROM (
  SELECT event_id,content,version FROM snapshots
  UNION
  SELECT event_id,snapshot,snapshot_version FROM invites WHERE snapshot IS NOT NULL
) old JOIN events e ON e.id=old.event_id;

CREATE TABLE share_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL,
  granted_by text NOT NULL REFERENCES "user"(id),
  recipient_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text REFERENCES "user"(id),
  source text NOT NULL DEFAULT 'user' CHECK(source IN ('user','legacy_import')),
  FOREIGN KEY(event_id,snapshot_id) REFERENCES share_snapshots(event_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX share_grants_current_recipient ON share_grants(event_id,recipient_id) WHERE revoked_at IS NULL;
CREATE INDEX share_grants_snapshot ON share_grants(snapshot_id);

-- Legacy timestamps are unknown; source marks migration time rather than historical consent.
INSERT INTO share_grants(event_id,snapshot_id,granted_by,recipient_id,revoked_at,source)
SELECT old.event_id,s.id,e.owner_id,old.user_id,
  CASE WHEN old.active AND coalesce(m.active,false) THEN NULL ELSE now() END,'legacy_import'
FROM snapshots old
JOIN share_snapshots s ON s.event_id=old.event_id AND s.source_version=old.version
JOIN events e ON e.id=old.event_id
LEFT JOIN members m ON m.event_id=old.event_id AND m.user_id=old.user_id;

ALTER TABLE invites ADD COLUMN snapshot_id uuid;
UPDATE invites i SET snapshot_id=s.id FROM share_snapshots s
WHERE i.event_id=s.event_id AND i.snapshot_version=s.source_version AND i.snapshot IS NOT NULL;
ALTER TABLE invites ADD FOREIGN KEY(event_id,snapshot_id) REFERENCES share_snapshots(event_id,id);
ALTER TABLE invites DROP COLUMN snapshot, DROP COLUMN snapshot_version;
DROP TABLE snapshots;

CREATE TABLE consent_records (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  policy_version text NOT NULL,
  action text NOT NULL CHECK(action IN ('accepted','legacy_import')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,consent_type,policy_version)
);
INSERT INTO consent_records(user_id,consent_type,policy_version,action,occurred_at)
SELECT user_id,'local_test','legacy-unversioned','legacy_import',consent_at FROM profiles;
ALTER TABLE profiles DROP COLUMN consent_at;

ALTER TABLE agent_runs
  ADD COLUMN trigger_message_id bigint REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN response_message_id bigint REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN prompt_version text,
  ADD COLUMN finished_at timestamptz,
  ADD COLUMN error_code text;
UPDATE agent_runs SET error_code=status,status='error' WHERE status NOT IN ('running','complete');
ALTER TABLE agent_runs ADD CHECK(status IN ('running','complete','error'));
ALTER TABLE agent_runs ADD CHECK(domain IN ('private','room'));
