import { PEER_PATTERN } from "../shared/signal-frame.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";
import { createRelay, type Relay } from "./relay.ts";
import { signalingFromEnv, type SignalingProvider } from "./signaling.ts";

const SESSION = "[a-zA-Z0-9_-]{8,80}";

export interface SessionRoutesOptions {
  relay?: Relay;
  provider?: SignalingProvider;
  /** Session starts and joins allowed per IP in each window. */
  startLimiter?: RateLimiter;
  /** ICE requests allowed per IP in each window. */
  iceLimiter?: RateLimiter;
  /** Signs host keys. Defaults to `XIRSYS_SECRET`, else a key made at start. */
  secret?: string;
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
 * Seam for the session store: `start` is where the shell will record a live
 * session, and `end` where it marks one ended.
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
        return credentials(id, "host", !renew, url.origin, { hostKey });
      }
      const join = new RegExp(`^/api/sessions/(${SESSION})/join$`).exec(path);
      if (join && request.method === "POST") {
        if (!startLimiter.allow(ip)) return json({ error: "slow down" }, 429);
        const data = await body(request);
        if (typeof data.peer !== "string" || !PEER_PATTERN.test(data.peer)) {
          return json({ error: "invalid peer" }, 400);
        }
        if (data.peer === "host") return json({ error: "invalid peer" }, 400);
        return credentials(join[1], data.peer, false, url.origin);
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
        const key = request.headers.get("x-host-key") ?? "";
        if (!sameText(key, await hostKeyFor(secret, end[1]))) {
          return json({ error: "not the host" }, 403);
        }
        try {
          await provider.close(end[1]);
        } catch (error) {
          console.error("Could not delete the session channel", error);
          return json({ error: "signaling unavailable" }, 502);
        }
        return json({ ok: true });
      }
      return null;
    },
  };
}
