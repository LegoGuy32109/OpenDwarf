// @ts-check
import {
  encodeSignal,
  readPeerConnected,
  readSignal,
} from "../shared/signal-frame.js";

/** @typedef {import('../shared/signal-frame.js').Signal} Signal */
/** @typedef {{signalUrl:string,channel:string}} SignalingTicket */

const RETRY_MS = [300, 700, 1500, 3000];
const SEND_TIMEOUT_MS = 10_000;
const MAX_PENDING = 32;

/**
 * One peer's connection to its session channel. `credentials` asks the shell
 * for a signaling address with a fresh token; the connection calls it again for
 * every reconnect, because a token must be used before it expires.
 * @param {{
 *   self: string,
 *   credentials: () => Promise<SignalingTicket>,
 *   receive: (signal:Signal) => void,
 *   socket?: (url:string) => WebSocket,
 *   onPeer?: (peer:string) => void,
 *   onOpen?: (info:{url:string,reconnect:boolean}) => void,
 * }} options
 */
export function createSignaling(options) {
  const open = options.socket ?? ((url) => new WebSocket(url));
  /** @type {WebSocket|null} */
  let socket = null;
  let channel = "";
  let closed = false;
  let failures = 0;
  let opened = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {{frame:string,resolve:()=>void,reject:(error:Error)=>void,timer:ReturnType<typeof setTimeout>}[]} */
  let pending = [];
  /** Remember ids so a redelivered signal is handled once. */
  /** @type {Set<string>} */
  const seen = new Set();

  function schedule() {
    if (closed || timer) return;
    const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures++;
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  }

  async function connect() {
    if (closed) return;
    /** @type {SignalingTicket} */
    let ticket;
    try {
      ticket = await options.credentials();
    } catch (error) {
      console.error(error);
      schedule();
      return;
    }
    if (closed) return;
    channel = ticket.channel;
    const next = open(ticket.signalUrl);
    socket = next;
    next.onopen = () => {
      if (socket !== next) return;
      failures = 0;
      options.onOpen?.({ url: ticket.signalUrl, reconnect: opened++ > 0 });
      const queued = pending;
      pending = [];
      for (const item of queued) {
        clearTimeout(item.timer);
        next.send(item.frame);
        item.resolve();
      }
    };
    next.onmessage = (event) => {
      const arrived = readPeerConnected(event.data);
      if (arrived) {
        options.onPeer?.(arrived);
        return;
      }
      const signal = readSignal(event.data);
      if (!signal || seen.has(signal.id)) return;
      seen.add(signal.id);
      if (seen.size > 64) {
        const oldest = seen.values().next().value;
        if (oldest) seen.delete(oldest);
      }
      options.receive(signal);
    };
    next.onclose = () => {
      if (socket !== next) return;
      socket = null;
      schedule();
    };
  }

  void connect();

  return {
    /**
     * Send one signal to a peer. It goes out when the socket is open; the
     * promise rejects when no socket opens within ten seconds.
     * @param {string} to @param {string} kind @param {unknown} data
     * @returns {Promise<void>}
     */
    send(to, kind, data) {
      if (closed) return Promise.reject(new Error("Signaling closed"));
      const frame = encodeSignal(channel, options.self, to, {
        id: crypto.randomUUID(),
        from: options.self,
        kind,
        data,
      });
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const item = {
          frame,
          resolve,
          reject,
          timer: setTimeout(() => {
            pending = pending.filter((entry) => entry !== item);
            reject(new Error("Signaling not connected"));
          }, SEND_TIMEOUT_MS),
        };
        pending.push(item);
        if (pending.length > MAX_PENDING) {
          const dropped = /** @type {NonNullable<typeof pending[0]>} */ (
            pending.shift()
          );
          clearTimeout(dropped.timer);
          dropped.reject(new Error("Signaling queue full"));
        }
      });
    },
    /** Drop the socket as a network failure would. The connection reconnects. */
    drop() {
      socket?.close();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const item of pending) {
        clearTimeout(item.timer);
        item.reject(new Error("Signaling closed"));
      }
      pending = [];
      socket?.close();
      socket = null;
    },
  };
}
