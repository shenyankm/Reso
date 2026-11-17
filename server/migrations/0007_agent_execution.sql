ALTER TABLE agent_runs ADD COLUMN checkpoint jsonb;
CREATE INDEX agent_runs_resume ON agent_runs(event_id,domain,trigger_message_id,created_at DESC) WHERE checkpoint IS NOT NULL;
CREATE TABLE agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  domain text NOT NULL DEFAULT 'private' CHECK(domain='private'),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  message_id bigint NOT NULL,
  slot integer NOT NULL CHECK(slot BETWEEN 0 AND 1),
  base_version integer NOT NULL,
  proposal jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY(event_id,domain,message_id) REFERENCES messages(event_id,domain,id) ON DELETE CASCADE,
  UNIQUE(message_id,slot)
);
CREATE INDEX agent_actions_event ON agent_actions(event_id,message_id);
