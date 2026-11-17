ALTER TABLE events ADD COLUMN room_updated_at timestamptz NOT NULL DEFAULT now();
UPDATE events e SET room_updated_at=coalesce((SELECT max(m.created_at) FROM messages m WHERE m.event_id=e.id AND m.domain='room'),e.created_at);
