-- Live sessions: the sweep that deletes the Xirsys channel of an ended session, and telemetry
-- summaries that keep the role, player count, and test flag, with a number left empty when the
-- peer had none to report (a host has no round trip time).

-- The sweep takes a short lease on a session before it deletes the channel, so two isolates
-- never delete the same one. A deleted channel is not swept again.
ALTER TABLE sessions ADD COLUMN sweep_claimed_at INTEGER;
ALTER TABLE sessions ADD COLUMN channel_deleted_at INTEGER;

-- SQLite cannot drop NOT NULL in place, so rebuild the table and keep every row.
CREATE TABLE telemetry_summaries_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  route TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('host', 'guest')),
  players INTEGER,
  frame_mean_ms REAL,
  frame_max_ms REAL,
  rtt_ms REAL,
  bytes INTEGER,
  is_test INTEGER NOT NULL DEFAULT 0
);

INSERT INTO telemetry_summaries_v2(id, session_id, recorded_at, route, frame_mean_ms, frame_max_ms, rtt_ms, bytes)
SELECT id, session_id, recorded_at, route, frame_mean_ms, frame_max_ms, rtt_ms, bytes FROM telemetry_summaries;

DROP TABLE telemetry_summaries;

ALTER TABLE telemetry_summaries_v2 RENAME TO telemetry_summaries;

CREATE INDEX telemetry_summaries_session_idx ON telemetry_summaries(session_id, id);

-- Retention deletes by age.
CREATE INDEX telemetry_summaries_recorded_idx ON telemetry_summaries(recorded_at);
