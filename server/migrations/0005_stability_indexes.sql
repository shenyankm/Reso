CREATE INDEX events_owner_activity ON events(owner_id,updated_at DESC);
CREATE INDEX members_active_user ON members(user_id,event_id) WHERE active;
CREATE INDEX agent_runs_trigger ON agent_runs(event_id,domain,trigger_message_id,created_at DESC);
