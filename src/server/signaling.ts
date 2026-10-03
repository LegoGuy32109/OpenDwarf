import type { Relay } from "./relay.ts";

/** What a peer needs to signal through one session channel. */
export interface SessionCredentials {
  channel: string;
  token: string;
  /** The signaling host, as `wss://host/ws` or the relay's `ws://host`. */
  host: string;
  /** The address the client opens: `<host>/v2/<token>`. */
  signalUrl: string;
  iceServers: unknown[];
}

/** Where the shell gets session channels: real Xirsys, or the local relay. */
export interface SignalingProvider {
  /**
   * Credentials for `peer`. `create` makes the session channel first (the host
   * starting a session); a join or a token refresh leaves it as it is.
   * Returns null when the session channel does not exist and cannot be made.
   */
  open(
    session: string,
    peer: string,
    options: { create: boolean; origin: string },
  ): Promise<SessionCredentials | null>;
  iceServers(session: string): Promise<unknown[]>;
  /** Delete the session channel. */
  close(session: string): Promise<void>;
}

/** Xirsys answers `{s:"ok", v:...}`. */
async function xirsys(
  fetcher: typeof fetch,
  auth: string,
  method: string,
  path: string,
): Promise<unknown> {
  const response = await fetcher(`https://global.xirsys.net${path}`, {
    method,
    headers: { authorization: auth },
  });
  const data = await response.json().catch(() => null) as
    | { s?: string; v?: unknown }
    | null;
  if (!response.ok || data?.s !== "ok") {
    throw new Error(`Xirsys ${method} ${path.split("?")[0]} failed`);
  }
  return data.v;
}

/** Xirsys gives one ICE server object or a list; a browser wants a list. */
export function iceList(value: unknown): unknown[] {
  const servers = (value as { iceServers?: unknown } | null)?.iceServers;
  if (Array.isArray(servers)) return servers;
  return servers ? [servers] : [];
}

export function createXirsysProvider(options: {
  ident: string;
  secret: string;
  channel: string;
  fetch?: typeof fetch;
}): SignalingProvider {
  const fetcher = options.fetch ?? fetch;
  const auth = `Basic ${btoa(`${options.ident}:${options.secret}`)}`;
  const root = encodeURIComponent(options.channel);
  const sub = (session: string) => `${root}/${encodeURIComponent(session)}`;
  const call = (method: string, path: string) =>
    xirsys(fetcher, auth, method, path);
  return {
    async open(session, peer, { create }) {
      const channel = `${options.channel}/${session}`;
      if (create) await call("PUT", `/_ns/${sub(session)}`);
      const k = encodeURIComponent(peer);
      const [token, host, iceServers] = await Promise.all([
        call("PUT", `/_token/${sub(session)}?k=${k}&expire=60`),
        call("GET", `/_host/${sub(session)}?type=signal&k=${k}`),
        this.iceServers(session),
      ]);
      if (typeof token !== "string" || typeof host !== "string") {
        throw new Error("Xirsys returned no token or host");
      }
      return {
        channel,
        token,
        host,
        signalUrl: `${host.replace(/\/+$/, "")}/v2/${token}`,
        iceServers,
      };
    },
    async iceServers(session) {
      return iceList(
        await call("PUT", `/_turn/${sub(session)}?webrtc=1&expire=60`),
      );
    },
    async close(session) {
      await call("DELETE", `/_ns/${sub(session)}`);
    },
  };
}

/** The relay as a provider; the shell serves its WebSocket at `/v2/<token>`. */
export function createLocalProvider(relay: Relay): SignalingProvider {
  return {
    open(session, peer, { create, origin }) {
      const channel = `local/${session}`;
      if (create) relay.createChannel(channel);
      if (!relay.hasChannel(channel)) return Promise.resolve(null);
      const token = relay.issueToken(channel, peer);
      const host = origin.replace(/^http/, "ws");
      return Promise.resolve({
        channel,
        token,
        host,
        signalUrl: `${host}/v2/${token}`,
        iceServers: [],
      });
    },
    iceServers: () => Promise.resolve([]),
    close(session) {
      relay.deleteChannel(`local/${session}`);
      return Promise.resolve();
    },
  };
}

/**
 * Real Xirsys when `XIRSYS_IDENT`, `XIRSYS_SECRET`, and `XIRSYS_CHANNEL` are
 * set; the local relay otherwise. `SIGNALING=local` forces the relay.
 */
export function signalingFromEnv(
  relay: Relay,
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): SignalingProvider {
  const ident = env("XIRSYS_IDENT");
  const secret = env("XIRSYS_SECRET");
  const channel = env("XIRSYS_CHANNEL");
  if (env("SIGNALING") === "local" || !ident || !secret || !channel) {
    return createLocalProvider(relay);
  }
  return createXirsysProvider({ ident, secret, channel });
}
