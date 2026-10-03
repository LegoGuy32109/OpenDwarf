import {
  encodeIncoming,
  PEER_PATTERN,
  readOutgoing,
} from "../shared/signal-frame.js";

/** The part of a WebSocket the relay needs. */
export interface RelaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Relay {
  createChannel(channel: string): void;
  /** Closes every socket in the channel. */
  deleteChannel(channel: string): void;
  hasChannel(channel: string): boolean;
  /** A token that connects `peer` to `channel` until it expires. */
  issueToken(channel: string, peer: string): string;
  /** Null when the token is unknown or expired; otherwise the attached connection. */
  connect(token: string, socket: RelaySocket): RelayConnection | null;
}

export interface RelayConnection {
  /** Handle one frame the peer sent. Returns how many peers received it. */
  receive(raw: unknown): number;
  /** The peer's socket closed. */
  disconnect(): void;
}

/**
 * The local stand in for a Xirsys session channel. It issues its own tokens,
 * and a peer sends and receives the same frames, so the client code path does
 * not change between the relay and real Xirsys.
 */
export function createRelay(
  options: { now?: () => number; tokenTtlMs?: number } = {},
): Relay {
  const now = options.now ?? Date.now;
  const tokenTtlMs = options.tokenTtlMs ?? 60_000;
  const channels = new Map<string, Map<string, RelaySocket>>();
  const tokens = new Map<
    string,
    { channel: string; peer: string; expires: number }
  >();

  function deliver(
    channel: string,
    from: string,
    to: string | null,
    payload: Record<string, unknown>,
  ): number {
    const peers = channels.get(channel);
    if (!peers) return 0;
    const frame = encodeIncoming(channel, from, to, payload);
    let count = 0;
    for (const [peer, socket] of peers) {
      if (peer === from || (to !== null && peer !== to)) continue;
      try {
        socket.send(frame);
        count++;
      } catch { /* The socket is closing. */ }
    }
    return count;
  }

  function notice(channel: string, to: RelaySocket, peer: string) {
    const peers = channels.get(channel);
    const sys = `${channel}/__sys__`;
    try {
      to.send(JSON.stringify({
        t: "u",
        m: { f: `${channel}/${peer}`, o: "peer_connected" },
        p: peer,
      }));
      to.send(JSON.stringify({
        t: "u",
        m: { f: sys, o: "peers" },
        p: { users: [...(peers?.keys() ?? [])] },
      }));
    } catch { /* The socket is closing. */ }
  }

  return {
    createChannel(channel) {
      if (!channels.has(channel)) channels.set(channel, new Map());
    },
    deleteChannel(channel) {
      const peers = channels.get(channel);
      channels.delete(channel);
      for (const socket of peers?.values() ?? []) {
        try {
          socket.close(1000, "channel deleted");
        } catch { /* Already closed. */ }
      }
      for (const [token, entry] of tokens) {
        if (entry.channel === channel) tokens.delete(token);
      }
    },
    hasChannel: (channel) => channels.has(channel),
    issueToken(channel, peer) {
      if (!PEER_PATTERN.test(peer)) throw new Error("invalid peer");
      const time = now();
      for (const [token, entry] of tokens) {
        if (entry.expires <= time) tokens.delete(token);
      }
      const token = crypto.randomUUID();
      tokens.set(token, { channel, peer, expires: time + tokenTtlMs });
      return token;
    },
    connect(token, socket) {
      const entry = tokens.get(token);
      if (!entry || entry.expires <= now()) {
        tokens.delete(token);
        return null;
      }
      const peers = channels.get(entry.channel);
      if (!peers) return null;
      const { channel, peer } = entry;
      // A reconnect replaces the peer's older socket.
      const older = peers.get(peer);
      peers.set(peer, socket);
      if (older && older !== socket) {
        try {
          older.close(1000, "replaced");
        } catch { /* Already closed. */ }
      }
      notice(channel, socket, peer);
      // Everyone already there learns that this peer connected.
      for (const [other, otherSocket] of peers) {
        if (other === peer) continue;
        try {
          otherSocket.send(JSON.stringify({
            t: "u",
            m: { f: `${channel}/${peer}`, o: "peer_connected" },
            p: peer,
          }));
        } catch { /* The socket is closing. */ }
      }
      return {
        receive(raw) {
          const frame = readOutgoing(raw);
          if (!frame) return 0;
          return deliver(channel, peer, frame.to, frame.payload);
        },
        disconnect() {
          if (channels.get(channel)?.get(peer) === socket) peers.delete(peer);
        },
      };
    },
  };
}
