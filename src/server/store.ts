// The shell's store: one interface, two implementations. `createTursoStore` talks to Turso through
// `@tursodatabase/serverless`; `createMemoryStore` serves unit tests and `deno task dev` without
// credentials. Terms follow CONTEXT.md: Label, Main, Promotion, Shell deploy, Session.
// A store never logs, stores, or returns credentials; only `openStore` reads them, and only to
// hand them to the Turso client.
import { createClient } from "@tursodatabase/serverless/compat";
import type { Client } from "@tursodatabase/serverless/compat";

export type LabelTargetKind = "branch" | "commit";

/** A movable name for a build. */
export interface Label {
  name: string;
  kind: LabelTargetKind;
  /** A branch name, or a commit SHA. */
  target: string;
  created: number;
  updated: number;
}

export type LabelAction = "created" | "moved" | "renamed" | "deleted";

/** One change to a label. A rename moves earlier changes to the new name. */
export interface LabelChange {
  name: string;
  action: LabelAction;
  kind: LabelTargetKind;
  target: string;
  /** The name before a rename. */
  previousName: string | null;
  at: number;
}

/** Making a build main. */
export interface Promotion {
  commit: string;
  /** The label the build came from. */
  label: string;
  at: number;
  note: string;
}

/** One recorded deploy of the shell to Deno Deploy. */
export interface ShellDeploy {
  commit: string;
  denoRevision: string;
  at: number;
  note: string;
}

export interface Session {
  id: string;
  buildCommit: string;
  label: string | null;
  hostPeer: string;
  started: number;
  lastHeartbeat: number;
  playerCount: number;
  /** Null while the session is live. */
  ended: number | null;
}

/** What one peer reports about a session. A number is null when the peer had none to report. */
export interface TelemetrySummary {
  session: string;
  route: string;
  role: "host" | "guest";
  players: number | null;
  frameMeanMs: number | null;
  frameMaxMs: number | null;
  rttMs: number | null;
  bytes: number | null;
  /** From a test run, so a dashboard can leave it out. */
  test: boolean;
}

export interface RecordedTelemetry extends TelemetrySummary {
  at: number;
}

export interface Store {
  /** Creates a label, or moves it to another target. Setting the same target changes nothing. */
  setLabel(
    input: { name: string; kind: LabelTargetKind; target: string },
  ): Promise<Label>;
  /** Throws when `from` is missing or `to` is taken. */
  renameLabel(from: string, to: string): Promise<Label>;
  /** True when the label existed. Its history stays. */
  deleteLabel(name: string): Promise<boolean>;
  getLabel(name: string): Promise<Label | null>;
  /** By name. */
  listLabels(): Promise<Label[]>;
  /** Oldest first. */
  labelHistory(name: string): Promise<LabelChange[]>;

  promote(
    input: { commit: string; label: string; note?: string },
  ): Promise<Promotion>;
  /** Main: the latest promotion, or null before the first. */
  getMain(): Promise<Promotion | null>;
  /** Newest first. */
  listPromotions(limit?: number): Promise<Promotion[]>;

  recordShellDeploy(
    input: { commit: string; denoRevision: string; note?: string },
  ): Promise<ShellDeploy>;
  /** Newest first. */
  listShellDeploys(limit?: number): Promise<ShellDeploy[]>;

  /** Throws when the session id exists. */
  startSession(
    input: {
      id: string;
      buildCommit: string;
      label?: string | null;
      hostPeer: string;
      playerCount?: number;
    },
  ): Promise<Session>;
  /** True when the session is live. */
  heartbeatSession(id: string, playerCount: number): Promise<boolean>;
  /** True when the session was live. */
  endSession(id: string): Promise<boolean>;
  getSession(id: string): Promise<Session | null>;
  /** Not ended, and a heartbeat within the timeout. Newest first. */
  listLiveSessions(): Promise<Session[]>;
  /**
   * Sessions that have ended, or whose heartbeat timed out, newest first. `ended` is when the host
   * ended the session, or when its heartbeat timed out.
   */
  listEndedSessions(limit?: number): Promise<Session[]>;
  /** Ended sessions whose channel is not deleted, oldest first. */
  listSessionsToSweep(limit?: number): Promise<Session[]>;
  /**
   * Takes the lease to delete an ended session's channel for `leaseMs`. True for exactly one caller
   * at a time, so several isolates never delete the same channel.
   */
  claimSessionSweep(id: string, leaseMs: number): Promise<boolean>;
  /** Records that the session's channel is deleted, so no sweep takes it again. */
  markChannelDeleted(id: string): Promise<void>;

  recordTelemetry(summary: TelemetrySummary): Promise<void>;
  /** Oldest first. */
  listTelemetry(session: string): Promise<RecordedTelemetry[]>;
  /** Deletes summaries recorded before `before`. Returns how many. */
  pruneTelemetry(before: number): Promise<number>;
}

export interface StoreOptions {
  /** The clock, in milliseconds. Tests set it. */
  now?: () => number;
  /** How long a session stays live without a heartbeat. Default 45 seconds. */
  heartbeatTimeoutMs?: number;
}

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
/** Telemetry summaries are kept this long. */
export const TELEMETRY_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** The build commit of a session whose host runs the working tree. */
export const LOCAL_COMMIT = "local";
const DEFAULT_LIMIT = 50;

// ---- Validation, shared so both implementations accept the same input. ----

const LABEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const BRANCH = /^[^\s~^:?*\[\\]{1,200}$/;

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

function checkLabelName(name: string): void {
  check(LABEL_NAME.test(name), `invalid label name: ${JSON.stringify(name)}`);
}

function checkCommit(commit: string): void {
  check(COMMIT.test(commit), "a commit is 7 to 40 lowercase hex digits");
}

function checkBuildCommit(commit: string): void {
  if (commit !== LOCAL_COMMIT) checkCommit(commit);
}

function checkTarget(kind: LabelTargetKind, target: string): void {
  check(kind === "branch" || kind === "commit", "kind is branch or commit");
  if (kind === "commit") checkCommit(target);
  else check(BRANCH.test(target), "invalid branch name");
}

function checkId(id: string, what: string): void {
  check(typeof id === "string" && id.length > 0, `${what} is required`);
}

function checkCount(value: number, what: string): void {
  check(Number.isSafeInteger(value) && value >= 0, `${what} must be a count`);
}

function checkNumber(value: number, what: string): void {
  check(Number.isFinite(value) && value >= 0, `${what} must be a number`);
}

function checkTelemetry(summary: TelemetrySummary): void {
  checkId(summary.session, "session");
  checkId(summary.route, "route");
  check(
    summary.role === "host" || summary.role === "guest",
    "role is host or guest",
  );
  if (summary.players !== null) checkCount(summary.players, "players");
  if (summary.frameMeanMs !== null) {
    checkNumber(summary.frameMeanMs, "frameMeanMs");
  }
  if (summary.frameMaxMs !== null) {
    checkNumber(summary.frameMaxMs, "frameMaxMs");
  }
  if (summary.rttMs !== null) checkNumber(summary.rttMs, "rttMs");
  if (summary.bytes !== null) checkCount(summary.bytes, "bytes");
}

function limitOf(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIMIT;
  check(Number.isSafeInteger(value) && value > 0, "limit must be positive");
  return value;
}

// ---- In-memory store ----

/** A store that keeps everything in this process. */
export function createMemoryStore(options: StoreOptions = {}): Store {
  const store = memoryStore(options);
  // Validation throws inside a method; callers of a Store expect a rejected promise instead.
  const methods = Object.entries(store).map(([name, method]) => [
    name,
    (...args: unknown[]) => {
      try {
        return (method as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (error) {
        return Promise.reject(error);
      }
    },
  ]);
  return Object.fromEntries(methods) as unknown as Store;
}

function memoryStore(options: StoreOptions): Store {
  const now = options.now ?? Date.now;
  const timeout = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const labels = new Map<string, Label>();
  const history: LabelChange[] = [];
  const promotions: Promotion[] = [];
  const deploys: ShellDeploy[] = [];
  const sessions = new Map<string, Session>();
  const telemetry: RecordedTelemetry[] = [];
  /** Sweep lease start and channel deletion time, by session id. */
  const claims = new Map<string, number>();
  const deleted = new Set<string>();
  const timedOut = (s: Session) =>
    s.ended !== null || s.lastHeartbeat < now() - timeout;
  /** The session as it ended: a timed out heartbeat ends it when the timeout passed. */
  const asEnded = (s: Session): Session => ({
    ...s,
    ended: s.ended ?? s.lastHeartbeat + timeout,
  });

  return {
    setLabel(input) {
      checkLabelName(input.name);
      checkTarget(input.kind, input.target);
      const at = now();
      const existing = labels.get(input.name);
      if (
        existing && existing.kind === input.kind &&
        existing.target === input.target
      ) return Promise.resolve({ ...existing });
      const label: Label = {
        name: input.name,
        kind: input.kind,
        target: input.target,
        created: existing?.created ?? at,
        updated: at,
      };
      labels.set(label.name, label);
      history.push({
        name: label.name,
        action: existing ? "moved" : "created",
        kind: label.kind,
        target: label.target,
        previousName: null,
        at,
      });
      return Promise.resolve({ ...label });
    },
    renameLabel(from, to) {
      checkLabelName(to);
      const existing = labels.get(from);
      if (!existing) return Promise.reject(new Error("no such label"));
      if (from === to || labels.has(to)) {
        return Promise.reject(new Error("label name is taken"));
      }
      const at = now();
      const label: Label = { ...existing, name: to, updated: at };
      labels.delete(from);
      labels.set(to, label);
      for (const change of history) {
        if (change.name === from) change.name = to;
      }
      history.push({
        name: to,
        action: "renamed",
        kind: label.kind,
        target: label.target,
        previousName: from,
        at,
      });
      return Promise.resolve({ ...label });
    },
    deleteLabel(name) {
      const existing = labels.get(name);
      if (!existing) return Promise.resolve(false);
      labels.delete(name);
      history.push({
        name,
        action: "deleted",
        kind: existing.kind,
        target: existing.target,
        previousName: null,
        at: now(),
      });
      return Promise.resolve(true);
    },
    getLabel(name) {
      const label = labels.get(name);
      return Promise.resolve(label ? { ...label } : null);
    },
    listLabels() {
      return Promise.resolve(
        [...labels.values()].sort((a, b) => a.name < b.name ? -1 : 1)
          .map((label) => ({ ...label })),
      );
    },
    labelHistory(name) {
      return Promise.resolve(
        history.filter((change) => change.name === name)
          .map((change) => ({ ...change })),
      );
    },

    promote(input) {
      checkCommit(input.commit);
      checkLabelName(input.label);
      const promotion: Promotion = {
        commit: input.commit,
        label: input.label,
        at: now(),
        note: input.note ?? "",
      };
      promotions.push(promotion);
      return Promise.resolve({ ...promotion });
    },
    getMain() {
      const latest = promotions.at(-1);
      return Promise.resolve(latest ? { ...latest } : null);
    },
    listPromotions(limit) {
      return Promise.resolve(
        promotions.toReversed().slice(0, limitOf(limit))
          .map((promotion) => ({ ...promotion })),
      );
    },

    recordShellDeploy(input) {
      checkCommit(input.commit);
      checkId(input.denoRevision, "denoRevision");
      const deploy: ShellDeploy = {
        commit: input.commit,
        denoRevision: input.denoRevision,
        at: now(),
        note: input.note ?? "",
      };
      deploys.push(deploy);
      return Promise.resolve({ ...deploy });
    },
    listShellDeploys(limit) {
      return Promise.resolve(
        deploys.toReversed().slice(0, limitOf(limit))
          .map((deploy) => ({ ...deploy })),
      );
    },

    startSession(input) {
      checkId(input.id, "session id");
      checkBuildCommit(input.buildCommit);
      checkId(input.hostPeer, "hostPeer");
      const playerCount = input.playerCount ?? 1;
      checkCount(playerCount, "playerCount");
      if (sessions.has(input.id)) {
        return Promise.reject(new Error("session id is taken"));
      }
      const at = now();
      const session: Session = {
        id: input.id,
        buildCommit: input.buildCommit,
        label: input.label ?? null,
        hostPeer: input.hostPeer,
        started: at,
        lastHeartbeat: at,
        playerCount,
        ended: null,
      };
      sessions.set(session.id, session);
      return Promise.resolve({ ...session });
    },
    heartbeatSession(id, playerCount) {
      checkCount(playerCount, "playerCount");
      const session = sessions.get(id);
      if (!session || session.ended !== null) return Promise.resolve(false);
      session.lastHeartbeat = now();
      session.playerCount = playerCount;
      return Promise.resolve(true);
    },
    endSession(id) {
      const session = sessions.get(id);
      if (!session || session.ended !== null) return Promise.resolve(false);
      session.ended = now();
      return Promise.resolve(true);
    },
    getSession(id) {
      const session = sessions.get(id);
      return Promise.resolve(session ? { ...session } : null);
    },
    listLiveSessions() {
      const cutoff = now() - timeout;
      return Promise.resolve(
        [...sessions.values()]
          .filter((s) => s.ended === null && s.lastHeartbeat >= cutoff)
          .sort((a, b) => b.started - a.started)
          .map((session) => ({ ...session })),
      );
    },

    listEndedSessions(limit) {
      return Promise.resolve(
        [...sessions.values()].filter(timedOut)
          .sort((a, b) => b.started - a.started)
          .slice(0, limitOf(limit))
          .map(asEnded),
      );
    },
    listSessionsToSweep(limit) {
      return Promise.resolve(
        [...sessions.values()]
          .filter((s) => timedOut(s) && !deleted.has(s.id))
          .sort((a, b) => a.started - b.started)
          .slice(0, limitOf(limit))
          .map(asEnded),
      );
    },
    claimSessionSweep(id, leaseMs) {
      const session = sessions.get(id);
      const claimed = claims.get(id);
      if (
        !session || !timedOut(session) || deleted.has(id) ||
        (claimed !== undefined && claimed > now() - leaseMs)
      ) return Promise.resolve(false);
      claims.set(id, now());
      return Promise.resolve(true);
    },
    markChannelDeleted(id) {
      if (sessions.has(id)) deleted.add(id);
      return Promise.resolve();
    },

    recordTelemetry(summary) {
      checkTelemetry(summary);
      telemetry.push({ ...summary, at: now() });
      return Promise.resolve();
    },
    listTelemetry(session) {
      return Promise.resolve(
        telemetry.filter((row) => row.session === session)
          .map((row) => ({ ...row })),
      );
    },
    pruneTelemetry(before) {
      const kept = telemetry.filter((row) => row.at >= before);
      const count = telemetry.length - kept.length;
      telemetry.splice(0, telemetry.length, ...kept);
      return Promise.resolve(count);
    },
  };
}

// ---- Turso store ----

type Row = Record<string, unknown>;

function int(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("database integer is outside the safe range");
  }
  return parsed;
}

function labelOf(row: Row): Label {
  return {
    name: String(row.name),
    kind: String(row.target_kind) as LabelTargetKind,
    target: String(row.target),
    created: int(row.created_at),
    updated: int(row.updated_at),
  };
}

function promotionOf(row: Row): Promotion {
  return {
    commit: String(row.commit_sha),
    label: String(row.label),
    at: int(row.promoted_at),
    note: String(row.note),
  };
}

function sessionOf(row: Row): Session {
  return {
    id: String(row.id),
    buildCommit: String(row.build_commit),
    label: row.label === null ? null : String(row.label),
    hostPeer: String(row.host_peer),
    started: int(row.started_at),
    lastHeartbeat: int(row.last_heartbeat_at),
    playerCount: int(row.player_count),
    ended: row.ended_at === null ? null : int(row.ended_at),
  };
}

/** A session row read as an ended one: `ended` falls back to when its heartbeat timed out. */
function endedOf(timeout: number): (row: Row) => Session {
  return (row) => {
    const session = sessionOf(row);
    return {
      ...session,
      ended: session.ended ?? session.lastHeartbeat + timeout,
    };
  };
}

/**
 * A store backed by a migrated Turso database. It keeps the client in a closure, so no property of
 * the returned store holds the URL or token.
 */
export function createTursoStore(
  db: Client,
  options: StoreOptions = {},
): Store {
  const now = options.now ?? Date.now;
  const timeout = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

  async function rows(sql: string, args: (string | number | null)[] = []) {
    return (await db.execute({ sql, args })).rows as Row[];
  }

  async function getLabel(name: string): Promise<Label | null> {
    const [row] = await rows("SELECT * FROM labels WHERE name = ?", [name]);
    return row ? labelOf(row) : null;
  }

  async function getSession(id: string): Promise<Session | null> {
    const [row] = await rows("SELECT * FROM sessions WHERE id = ?", [id]);
    return row ? sessionOf(row) : null;
  }

  const insertHistory =
    "INSERT INTO label_history(name, action, target_kind, target, previous_name, at) VALUES (?, ?, ?, ?, ?, ?)";

  return {
    async setLabel(input) {
      checkLabelName(input.name);
      checkTarget(input.kind, input.target);
      const existing = await getLabel(input.name);
      if (
        existing && existing.kind === input.kind &&
        existing.target === input.target
      ) return existing;
      const at = now();
      await db.batch([
        {
          sql:
            "INSERT INTO labels(name, target_kind, target, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(name) DO UPDATE SET target_kind = excluded.target_kind, target = excluded.target, updated_at = excluded.updated_at",
          args: [input.name, input.kind, input.target, at, at],
        },
        {
          sql: insertHistory,
          args: [
            input.name,
            existing ? "moved" : "created",
            input.kind,
            input.target,
            null,
            at,
          ],
        },
      ], "write");
      return {
        name: input.name,
        kind: input.kind,
        target: input.target,
        created: existing?.created ?? at,
        updated: at,
      };
    },
    async renameLabel(from, to) {
      checkLabelName(to);
      const existing = await getLabel(from);
      if (!existing) throw new Error("no such label");
      if (from === to || await getLabel(to)) {
        throw new Error("label name is taken");
      }
      const at = now();
      await db.batch([
        {
          sql: "UPDATE labels SET name = ?, updated_at = ? WHERE name = ?",
          args: [to, at, from],
        },
        {
          sql: "UPDATE label_history SET name = ? WHERE name = ?",
          args: [to, from],
        },
        {
          sql: insertHistory,
          args: [to, "renamed", existing.kind, existing.target, from, at],
        },
      ], "write");
      return { ...existing, name: to, updated: at };
    },
    async deleteLabel(name) {
      const existing = await getLabel(name);
      if (!existing) return false;
      await db.batch([
        { sql: "DELETE FROM labels WHERE name = ?", args: [name] },
        {
          sql: insertHistory,
          args: [
            name,
            "deleted",
            existing.kind,
            existing.target,
            null,
            now(),
          ],
        },
      ], "write");
      return true;
    },
    getLabel,
    async listLabels() {
      return (await rows("SELECT * FROM labels ORDER BY name")).map(labelOf);
    },
    async labelHistory(name) {
      const found = await rows(
        "SELECT * FROM label_history WHERE name = ? ORDER BY id",
        [name],
      );
      return found.map((row) => ({
        name: String(row.name),
        action: String(row.action) as LabelAction,
        kind: String(row.target_kind) as LabelTargetKind,
        target: String(row.target),
        previousName: row.previous_name === null
          ? null
          : String(row.previous_name),
        at: int(row.at),
      }));
    },

    async promote(input) {
      checkCommit(input.commit);
      checkLabelName(input.label);
      const promotion: Promotion = {
        commit: input.commit,
        label: input.label,
        at: now(),
        note: input.note ?? "",
      };
      await rows(
        "INSERT INTO promotions(commit_sha, label, promoted_at, note) VALUES (?, ?, ?, ?)",
        [promotion.commit, promotion.label, promotion.at, promotion.note],
      );
      return promotion;
    },
    async getMain() {
      const [row] = await rows(
        "SELECT * FROM promotions ORDER BY id DESC LIMIT 1",
      );
      return row ? promotionOf(row) : null;
    },
    async listPromotions(limit) {
      return (await rows(
        "SELECT * FROM promotions ORDER BY id DESC LIMIT ?",
        [limitOf(limit)],
      )).map(promotionOf);
    },

    async recordShellDeploy(input) {
      checkCommit(input.commit);
      checkId(input.denoRevision, "denoRevision");
      const deploy: ShellDeploy = {
        commit: input.commit,
        denoRevision: input.denoRevision,
        at: now(),
        note: input.note ?? "",
      };
      await rows(
        "INSERT INTO shell_deploys(commit_sha, deno_revision, deployed_at, note) VALUES (?, ?, ?, ?)",
        [deploy.commit, deploy.denoRevision, deploy.at, deploy.note],
      );
      return deploy;
    },
    async listShellDeploys(limit) {
      return (await rows(
        "SELECT * FROM shell_deploys ORDER BY id DESC LIMIT ?",
        [limitOf(limit)],
      )).map((row) => ({
        commit: String(row.commit_sha),
        denoRevision: String(row.deno_revision),
        at: int(row.deployed_at),
        note: String(row.note),
      }));
    },

    async startSession(input) {
      checkId(input.id, "session id");
      checkBuildCommit(input.buildCommit);
      checkId(input.hostPeer, "hostPeer");
      const playerCount = input.playerCount ?? 1;
      checkCount(playerCount, "playerCount");
      const at = now();
      try {
        await rows(
          "INSERT INTO sessions(id, build_commit, label, host_peer, started_at, last_heartbeat_at, player_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            input.id,
            input.buildCommit,
            input.label ?? null,
            input.hostPeer,
            at,
            at,
            playerCount,
          ],
        );
      } catch (error) {
        if (await getSession(input.id)) throw new Error("session id is taken");
        throw error;
      }
      return {
        id: input.id,
        buildCommit: input.buildCommit,
        label: input.label ?? null,
        hostPeer: input.hostPeer,
        started: at,
        lastHeartbeat: at,
        playerCount,
        ended: null,
      };
    },
    async heartbeatSession(id, playerCount) {
      checkCount(playerCount, "playerCount");
      const result = await db.execute({
        sql:
          "UPDATE sessions SET last_heartbeat_at = ?, player_count = ? WHERE id = ? AND ended_at IS NULL",
        args: [now(), playerCount, id],
      });
      return result.rowsAffected > 0;
    },
    async endSession(id) {
      const result = await db.execute({
        sql:
          "UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL",
        args: [now(), id],
      });
      return result.rowsAffected > 0;
    },
    getSession,
    async listLiveSessions() {
      return (await rows(
        "SELECT * FROM sessions WHERE ended_at IS NULL AND last_heartbeat_at >= ? ORDER BY started_at DESC, id",
        [now() - timeout],
      )).map(sessionOf);
    },

    async listEndedSessions(limit) {
      const cutoff = now() - timeout;
      return (await rows(
        "SELECT * FROM sessions WHERE ended_at IS NOT NULL OR last_heartbeat_at < ? ORDER BY started_at DESC, id LIMIT ?",
        [cutoff, limitOf(limit)],
      )).map(endedOf(timeout));
    },
    async listSessionsToSweep(limit) {
      return (await rows(
        "SELECT * FROM sessions WHERE channel_deleted_at IS NULL AND (ended_at IS NOT NULL OR last_heartbeat_at < ?) ORDER BY started_at, id LIMIT ?",
        [now() - timeout, limitOf(limit)],
      )).map(endedOf(timeout));
    },
    async claimSessionSweep(id, leaseMs) {
      const at = now();
      // One statement decides, so of several isolates exactly one sees a changed row.
      const result = await db.execute({
        sql:
          "UPDATE sessions SET sweep_claimed_at = ? WHERE id = ? AND channel_deleted_at IS NULL " +
          "AND (ended_at IS NOT NULL OR last_heartbeat_at < ?) " +
          "AND (sweep_claimed_at IS NULL OR sweep_claimed_at <= ?)",
        args: [at, id, at - timeout, at - leaseMs],
      });
      return result.rowsAffected > 0;
    },
    async markChannelDeleted(id) {
      await rows(
        "UPDATE sessions SET channel_deleted_at = ? WHERE id = ? AND channel_deleted_at IS NULL",
        [now(), id],
      );
    },

    async recordTelemetry(summary) {
      checkTelemetry(summary);
      await rows(
        "INSERT INTO telemetry_summaries(session_id, recorded_at, route, role, players, frame_mean_ms, frame_max_ms, rtt_ms, bytes, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          summary.session,
          now(),
          summary.route,
          summary.role,
          summary.players,
          summary.frameMeanMs,
          summary.frameMaxMs,
          summary.rttMs,
          summary.bytes,
          summary.test ? 1 : 0,
        ],
      );
    },
    async listTelemetry(session) {
      const maybe = (value: unknown) => value === null ? null : Number(value);
      return (await rows(
        "SELECT * FROM telemetry_summaries WHERE session_id = ? ORDER BY id",
        [session],
      )).map((row) => ({
        session: String(row.session_id),
        at: int(row.recorded_at),
        route: String(row.route),
        role: String(row.role) === "host" ? "host" : "guest",
        players: maybe(row.players),
        frameMeanMs: maybe(row.frame_mean_ms),
        frameMaxMs: maybe(row.frame_max_ms),
        rttMs: maybe(row.rtt_ms),
        bytes: maybe(row.bytes),
        test: Number(row.is_test) === 1,
      }));
    },
    async pruneTelemetry(before) {
      const result = await db.execute({
        sql: "DELETE FROM telemetry_summaries WHERE recorded_at < ?",
        args: [before],
      });
      return result.rowsAffected;
    },
  };
}

/**
 * The store for this process: Turso when TURSO_DB_URL and TURSO_DB_TOKEN are both set, otherwise
 * an in-memory store. The database must already be migrated (`deno task db:migrate`).
 */
export function openStore(options: StoreOptions = {}): Store {
  const url = Deno.env.get("TURSO_DB_URL");
  const authToken = Deno.env.get("TURSO_DB_TOKEN");
  if (!url || !authToken) return createMemoryStore(options);
  return createTursoStore(createClient({ url, authToken }), options);
}
