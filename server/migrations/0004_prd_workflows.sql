ALTER TABLE messages ADD COLUMN card_type text CHECK(card_type IN ('safety'));
ALTER TABLE messages ADD CONSTRAINT messages_source UNIQUE(event_id,domain,id);
ALTER TABLE exercises ADD COLUMN practice_notes jsonb NOT NULL DEFAULT '{}';

ALTER TABLE applications DROP CONSTRAINT applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check CHECK(status IN ('pending','accepted','rejected','cancelled','proposed','scheduled','completed'));
ALTER TABLE applications ADD COLUMN proposed_at timestamptz,
  ADD COLUMN schedule_version integer NOT NULL DEFAULT 0,
  ADD COLUMN rejection_reason text NOT NULL DEFAULT '';
-- Old unilateral appointments need explicit client confirmation; completed history stays intact.
UPDATE applications SET status='proposed',proposed_at=scheduled_at,scheduled_at=NULL,schedule_version=1 WHERE status='scheduled';
ALTER TABLE consultants ADD COLUMN specialties text[] NOT NULL DEFAULT '{}',
  ADD COLUMN service_modes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN availability text NOT NULL DEFAULT '需要协商时间',
  ADD COLUMN verified_at timestamptz;

CREATE TABLE consultation_notes (
  application_id uuid PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES "user"(id),
  content text NOT NULL,
  client_visible boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE note_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  recipient_id text NOT NULL REFERENCES "user"(id),
  granted_by text NOT NULL REFERENCES "user"(id),
  content text NOT NULL,
  source_version integer NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX note_shares_current ON note_shares(application_id,recipient_id) WHERE revoked_at IS NULL;

CREATE TABLE understandings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK(domain IN ('private','room')),
  author_id text NOT NULL REFERENCES "user"(id),
  source_message_id bigint NOT NULL,
  content text NOT NULL,
  provenance text NOT NULL CHECK(provenance IN ('user_quoted','model_inference','user_corrected')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(event_id,domain,source_message_id) REFERENCES messages(event_id,domain,id) ON DELETE CASCADE,
  UNIQUE(event_id,domain,source_message_id)
);
CREATE TABLE understanding_confirmations (
  understanding_id uuid NOT NULL REFERENCES understandings(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id),
  version integer NOT NULL,
  agreed boolean NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(understanding_id,user_id,version)
);
CREATE TABLE followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id),
  reflection text NOT NULL,
  next_step text NOT NULL DEFAULT '',
  review_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX followups_owner ON followups(user_id,created_at DESC);
