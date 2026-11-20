ALTER TABLE events ADD COLUMN room_closed_at timestamptz;

CREATE TABLE contact_categories (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('family', 'friend', 'classmate', 'uncategorized')),
  PRIMARY KEY (user_id, contact_id),
  CHECK (user_id <> contact_id)
);

CREATE INDEX revisions_event_recent ON revisions(event_id, created_at DESC, id DESC);
