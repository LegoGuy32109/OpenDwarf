-- The shell's database: labels, promotions, shell deploys, live sessions, and telemetry
-- summaries. Terms follow CONTEXT.md. Timestamps are milliseconds since the Unix epoch.
-- An applied migration is immutable: change the schema with a new numbered file.

-- A label names a build. It points to a branch (and follows its latest commit) or to one commit.
CREATE TABLE labels (
  name TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('branch', 'commit')),
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Every change to a label. A rename moves the earlier rows to the new name.
CREATE TABLE label_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'moved', 'renamed', 'deleted')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('branch', 'commit')),
  target TEXT NOT NULL,
  previous_name TEXT,
  at INTEGER NOT NULL
);

CREATE INDEX label_history_name_idx ON label_history(name, id);

-- Making a build main. Main is the latest promotion.
CREATE TABLE promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_sha TEXT NOT NULL,
  label TEXT NOT NULL,
  promoted_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

-- One recorded deploy of the shell to Deno Deploy.
CREATE TABLE shell_deploys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_sha TEXT NOT NULL,
  deno_revision TEXT NOT NULL,
  deployed_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  build_commit TEXT NOT NULL,
  label TEXT,
  host_peer TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE INDEX sessions_live_idx ON sessions(ended_at, last_heartbeat_at);

-- A telemetry summary names its session by id but has no foreign key, so a summary that
-- arrives after the session row was removed is still kept.
CREATE TABLE telemetry_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  route TEXT NOT NULL,
  frame_mean_ms REAL NOT NULL,
  frame_max_ms REAL NOT NULL,
  rtt_ms REAL NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE INDEX telemetry_summaries_session_idx ON telemetry_summaries(session_id, id);
