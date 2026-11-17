CREATE TABLE IF NOT EXISTS profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  consent_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('member','counselor'))
);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL,
  summary text NOT NULL DEFAULT '',
  summary_version integer NOT NULL DEFAULT 0,
  initial_summary text NOT NULL DEFAULT '',
  private_version integer NOT NULL DEFAULT 0,
  room_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author_id text REFERENCES "user"(id) ON DELETE SET NULL,
  author_name text NOT NULL,
  domain text NOT NULL CHECK(domain IN ('private','room')),
  role text NOT NULL CHECK(role IN ('user','assistant')),
  content text NOT NULL,
  status text NOT NULL DEFAULT 'complete' CHECK(status IN ('complete','error')),
  client_id uuid UNIQUE,
  in_reply_to bigint REFERENCES messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,domain,in_reply_to)
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS room_title text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS messages_event_cursor ON messages(event_id,domain,id);
CREATE TABLE IF NOT EXISTS exercises (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  act integer NOT NULL DEFAULT 0 CHECK(act BETWEEN 0 AND 5),
  paused boolean NOT NULL DEFAULT false,
  notes jsonb NOT NULL DEFAULT '{}',
  story text NOT NULL DEFAULT '',
  saved boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS questionnaires (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  version text NOT NULL,
  answers jsonb NOT NULL,
  scores jsonb,
  discovery text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','unconfirmed','accepted','rejected')),
  confirmed_summary text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  snapshot text,
  snapshot_version integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled')),
  recipient_id text REFERENCES "user"(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snapshots (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  content text NOT NULL,
  version integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS perspectives (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  text text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS consultants (
  id uuid PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  approach text NOT NULL,
  qualifications text NOT NULL,
  price text NOT NULL,
  test_only boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL UNIQUE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  applicant_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES consultants(id),
  shared_summary text,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled','scheduled','completed')),
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS revisions (
  id bigserial PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES "user"(id),
  kind text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  domain text NOT NULL,
  context_version integer NOT NULL,
  model text NOT NULL,
  assessment jsonb,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
