import { PEER_PATTERN } from "../shared/signal-frame.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { createRelay, type Relay } from "./relay.ts";
import { signalingFromEnv, type SignalingProvider } from "./signaling.ts";
import {
  LOCAL_COMMIT,
  openStore,
  type RecordedTelemetry,
  type Session,
  type Store,
} from "./store.ts";
import { createSweeper } from "./sweep.ts";

const SESSION = "[a-zA-Z0-9_-]{8,80}";
const COMMIT = /^[0-9a-f]{7,40}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PLAYERS = 10_000;

export interface SessionRoutesOptions {
  relay?: Relay;
  provider?: SignalingProvider;
  /** Session starts and joins allowed per IP in each window. */
  startLimiter?: RateLimiter;
  /** ICE requests allowed per IP in each window. */
  iceLimiter?: RateLimiter;
  /** Signs host keys. Defaults to `XIRSYS_SECRET`, else a key made at start. */
  secret?: string;
  /** Holds live and ended sessions and telemetry. Defaults to `openStore()`. */
  store?: Store;
  /** The clock, in milliseconds. Tests set it. */
  now?: () => number;
  /** The least time between two channel sweeps in one isolate. Default one minute. */
  sweepIntervalMs?: number;
}

/** What a session's host runs. `path` is the build's base path, where a guest on another build goes. */
export interface SessionBuild {
  commit: string;
  label: string | null;
  path: string;
}

/**
 * A session as the public sees it. It carries no host key and no peer id, so nobody can speak as
 * the host from it. `ended` is null while the session is live.
 */
export interface PublicSession {
  id: string;
  build: SessionBuild;
  started: number;
  lastHeartbeat: number;
  playerCount: number;
  ended: number | null;
}

/** The path of a build by its commit, so a guest runs the same code even after a label moves. */
export function buildPath(commit: string): string {
  return `/b/${commit}/`;
}

export function publicBuild(session: Session): SessionBuild {
  return {
    commit: session.buildCommit,
    label: session.label,
    path: buildPath(session.buildCommit),
  };
}

export function publicSession(session: Session): PublicSession {
  return {
    id: session.id,
    build: publicBuild(session),
    started: session.started,
    lastHeartbeat: session.lastHeartbeat,
    playerCount: session.playerCount,
    ended: session.ended,
  };
}

/** A telemetry row as the public sees it: numbers a dashboard charts, and no peer id. */
export function publicTelemetry(row: RecordedTelemetry) {
  const { session: _session, ...rest } = row;
  return rest;
}

/** The build a host names: a commit or `local` (the default), and a label. Null when invalid. */
function buildOf(
  data: Record<string, unknown>,
): { commit: string; label: string | null } | null {
  const commit = data.commit ?? LOCAL_COMMIT;
  const label = data.label ?? null;
  if (
    typeof commit !== "string" ||
    (commit !== LOCAL_COMMIT && !COMMIT.test(commit)) ||
    (label !== null && (typeof label !== "string" || !LABEL.test(label)))
  ) return null;
  return { commit, label };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** The caller's address: the edge's forwarded address, else the socket's. */
export function clientIp(
  request: Request,
  info?: { remoteAddr?: { hostname?: string } },
): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]
    ?.trim();
  return forwarded || info?.remoteAddr?.hostname || "unknown";
}

/** A host key proves who started a session without storing it: an HMAC of the id. */
export async function hostKeyFor(
  secret: string,
  session: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`host:${session}`),
  );
  return [...new Uint8Array(mac)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * The session routes of the shell: start, join, ICE servers, end, and the
 * local relay's WebSocket. `handle` returns null for a request that is none of
 * them. `path` is the request path with `/api/v1/` already read as `/api/`.
 *
 * A start records the session, a heartbeat from its host (proved by the host key) keeps it live,
 * and an end marks it ended and deletes its channel. A session with no heartbeat for 45 seconds
 * counts as ended but stays as history. Each start and heartbeat also runs the channel sweep.
 * Public reads list live and recent sessions and one session's telemetry.
 */
export function createSessionRoutes(options: SessionRoutesOptions = {}) {
  const relay = options.relay ?? createRelay();
  const provider = options.provider ?? signalingFromEnv(relay);
  const startLimiter = options.startLimiter ??
    createRateLimiter({ limit: 30, windowMs: 60_000 });
  const iceLimiter = options.iceLimiter ??
    createRateLimiter({ limit: 60, windowMs: 60_000 });
  const secret = options.secret ?? Deno.env.get("XIRSYS_SECRET") ??
    crypto.randomUUID();
  const store = options.store ?? openStore();
  const sweeper = createSweeper({
    store,
    provider,
    now: options.now,
    intervalMs: options.sweepIntervalMs,
  });

  const isHost = async (request: Request, session: string) =>
    sameText(
      request.headers.get("x-host-key") ?? "",
      await hostKeyFor(secret, session),
    );

  async function credentials(
    session: string,
    peer: string,
    create: boolean,
    origin: string,
    extra: Record<string, unknown> = {},
  ): Promise<Response> {
    try {
      const result = await provider.open(session, peer, { create, origin });
      if (!result) return json({ error: "no such session" }, 404);
      return json({ session, peer, ...extra, ...result });
    } catch (error) {
      console.error("Signaling unavailable", error);
      return json({ error: "signaling unavailable" }, 502);
    }
  }

  return {
    relay,
    sweeper,
    async handle(
      request: Request,
      path: string,
      info?: { remoteAddr?: { hostname?: string } },
    ): Promise<Response | null> {
      const url = new URL(request.url);
      const socketPath = /^\/v2\/([a-zA-Z0-9_-]{8,80})$/.exec(url.pathname);
      if (
        socketPath && request.method === "GET" &&
        request.headers.get("upgrade")?.toLowerCase() === "websocket"
      ) {
        const { socket, response } = Deno.upgradeWebSocket(request);
        let connection: ReturnType<Relay["connect"]> = null;
        socket.onopen = () => {
          connection = relay.connect(socketPath[1], socket);
          // A stale or unknown token cannot connect.
          if (!connection) socket.close(4401, "invalid token");
        };
        socket.onmessage = (event) => connection?.receive(event.data);
        socket.onclose = () => connection?.disconnect();
        return response;
      }
      const ip = clientIp(request, info);
      if (path === "/api/sessions" && request.method === "POST") {
        if (!startLimiter.allow(ip)) return json({ error: "slow down" }, 429);
        const data = await body(request);
        const id = data.id;
        if (typeof id !== "string" || !new RegExp(`^${SESSION}$`).test(id)) {
          return json({ error: "invalid session" }, 400);
        }
        const hostKey = await hostKeyFor(secret, id);
        // A host that already has a key asks for a fresh token, not a new channel.
        const renew = typeof data.hostKey === "string" &&
          sameText(data.hostKey, hostKey);
        const host = buildOf(data);
        if (!host) return json({ error: "invalid build" }, 400);
        if (!renew) {
          try {
            // Only the host that made the session may open its channel again.
            if (await store.getSession(id)) {
              return json({ error: "session id is taken" }, 409);
            }
            await store.startSession({
              id,
              buildCommit: host.commit,
              label: host.label,
              hostPeer: "host",
            });
          } catch (error) {
            // Signaling works without the database; the session is then missing from the lists.
            console.error("Could not record the session", error);
          }
        }
        const response = await credentials(id, "host", !renew, url.origin, {
          hostKey,
        });
        await sweeper.maybeRun();
        return response;
      }
      const join = new RegExp(`^/api/sessions/(${SESSION})/join$`).exec(path);
      if (join && request.method === "POST") {
        if (!startLimiter.allow(ip)) return json({ error: "slow down" }, 429);
        const data = await body(request);
        if (typeof data.peer !== "string" || !PEER_PATTERN.test(data.peer)) {
          return json({ error: "invalid peer" }, 400);
        }
        if (data.peer === "host") return json({ error: "invalid peer" }, 400);
        let session: Session | null = null;
        try {
          session = await store.getSession(join[1]);
        } catch (error) {
          console.error("Could not read the session", error);
        }
        if (session && session.ended !== null) {
          return json({ error: "session ended" }, 404);
        }
        // The guest compares this build with its own and goes to the host's build when they differ.
        return credentials(
          join[1],
          data.peer,
          false,
          url.origin,
          session ? { build: publicBuild(session) } : {},
        );
      }
      const heartbeat = new RegExp(`^/api/sessions/(${SESSION})/heartbeat$`)
        .exec(path);
      if (heartbeat && request.method === "POST") {
        const id = heartbeat[1];
        if (!await isHost(request, id)) {
          return json({ error: "not the host" }, 403);
        }
        const data = await body(request);
        const players = data.players;
        const host = buildOf(data);
        if (
          typeof players !== "number" || !Number.isSafeInteger(players) ||
          players < 0 || players > MAX_PLAYERS
        ) return json({ error: "invalid player count" }, 400);
        if (!host) return json({ error: "invalid build" }, 400);
        try {
          if (!await store.heartbeatSession(id, players)) {
            if (await store.getSession(id)) {
              return json({ error: "session ended" }, 410);
            }
            // The host holds a valid key for a session the store never recorded.
            await store.startSession({
              id,
              buildCommit: host.commit,
              label: host.label,
              hostPeer: "host",
              playerCount: players,
            });
          }
        } catch (error) {
          console.error("Could not record the heartbeat", error);
          return json({ error: "the shell could not record it" }, 502);
        }
        await sweeper.maybeRun();
        return json({ ok: true });
      }
      if (path === "/api/sessions" && request.method === "GET") {
        try {
          const live = await store.listLiveSessions();
          return json({ sessions: live.map(publicSession) });
        } catch (error) {
          console.error("Could not list sessions", error);
          return json({ error: "the shell could not list sessions" }, 502);
        }
      }
      if (path === "/api/sessions/recent" && request.method === "GET") {
        const asked = Number(url.searchParams.get("limit") ?? 50);
        const limit = Number.isSafeInteger(asked) && asked > 0
          ? Math.min(asked, 200)
          : 50;
        try {
          const ended = await store.listEndedSessions(limit);
          return json({ sessions: ended.map(publicSession) });
        } catch (error) {
          console.error("Could not list sessions", error);
          return json({ error: "the shell could not list sessions" }, 502);
        }
      }
      const telemetry = new RegExp(`^/api/sessions/(${SESSION})/telemetry$`)
        .exec(path);
      if (telemetry && request.method === "GET") {
        try {
          if (!await store.getSession(telemetry[1])) {
            return json({ error: "no such session" }, 404);
          }
          const rows = await store.listTelemetry(telemetry[1]);
          return json({ telemetry: rows.map(publicTelemetry) });
        } catch (error) {
          console.error("Could not read telemetry", error);
          return json({ error: "the shell could not read telemetry" }, 502);
        }
      }
      const ice = new RegExp(`^/api/sessions/(${SESSION})/ice$`).exec(path);
      if (ice && request.method === "GET") {
        if (!iceLimiter.allow(ip)) return json({ error: "slow down" }, 429);
        try {
          return json({ iceServers: await provider.iceServers(ice[1]) });
        } catch (error) {
          console.error("ICE credentials unavailable", error);
          return json({ error: "ICE credentials unavailable" }, 502);
        }
      }
      const end = new RegExp(`^/api/sessions/(${SESSION})$`).exec(path);
      if (end && request.method === "DELETE") {
        if (!await isHost(request, end[1])) {
          return json({ error: "not the host" }, 403);
        }
        try {
          await store.endSession(end[1]);
          // A session the store never recorded has no lease to take, so delete its channel here.
          if (!await store.getSession(end[1])) await provider.close(end[1]);
          else await sweeper.closeSession(end[1]);
        } catch (error) {
          // The session stays ended, so a later sweep deletes the channel.
          console.error("Could not end the session", error);
          return json({ error: "signaling unavailable" }, 502);
        }
        return json({ ok: true });
      }
      return null;
    },
  };
}
