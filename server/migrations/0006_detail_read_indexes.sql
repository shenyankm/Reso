CREATE INDEX followups_event_user_created ON followups(event_id,user_id,created_at DESC);
CREATE INDEX applications_event ON applications(event_id);
CREATE INDEX invites_event_created ON invites(event_id,created_at DESC);
