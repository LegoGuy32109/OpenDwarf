// @ts-check

/**
 * Signaling frames, in the format a Xirsys session channel speaks over its
 * WebSocket: `{t:"u", m:{f, o:"message", t:<peer>}, p:<signal>}`. The shell's
 * local relay and the browser client share this file, so both sides read and
 * write the same frames.
 * @typedef {{id:string,from:string,kind:string,data:unknown}} Signal
 */

/** The largest frame the relay forwards. An offer with its candidates is a few KB. */
export const MAX_FRAME_BYTES = 32768;

/** A peer name: the world host or one joining player. */
export const PEER_PATTERN = /^(host|peer-[a-f0-9-]{36})$/;

/**
 * The frame that sends a signal to one peer.
 * @param {string} channel @param {string} from @param {string} to @param {Signal} signal
 */
export function encodeSignal(channel, from, to, signal) {
  return JSON.stringify({
    t: "u",
    m: { f: `${channel}/${from}`, o: "message", t: to },
    p: signal,
  });
}

/**
 * Read a frame as the relay sees it from a peer: who it is for, and its payload.
 * Anything that is not a message frame, is too large, or is not JSON gives null.
 * `to` is null for a broadcast to every other peer.
 * @param {unknown} raw
 * @returns {{to:string|null,payload:Record<string,unknown>}|null}
 */
export function readOutgoing(raw) {
  if (typeof raw !== "string" || raw.length > MAX_FRAME_BYTES) return null;
  const frame = parse(raw);
  if (!frame || frame.t !== "u") return null;
  const meta = object(frame.m);
  const payload = object(frame.p);
  if (!meta || !payload || meta.o !== "message") return null;
  if (meta.t === undefined || meta.t === null) return { to: null, payload };
  if (typeof meta.t !== "string" || !PEER_PATTERN.test(meta.t)) return null;
  return { to: meta.t, payload };
}

/**
 * The frame a recipient receives. The relay, like Xirsys, names the sender
 * itself, so a peer cannot claim to be another one.
 * @param {string} channel @param {string} from @param {string|null} to @param {Record<string,unknown>} payload
 */
export function encodeIncoming(channel, from, to, payload) {
  return JSON.stringify({
    t: "u",
    m: to === null
      ? { f: `${channel}/${from}`, o: "message" }
      : { f: `${channel}/${from}`, o: "message", t: to },
    p: payload,
  });
}

/**
 * Read a frame a client receives. Frames about peers joining or leaving and
 * frames that are not signals give null. The sender comes from the frame's
 * `f` field, which the channel sets, and falls back to the signal's own `from`.
 * @param {unknown} raw
 * @returns {Signal|null}
 */
export function readSignal(raw) {
  if (typeof raw !== "string") return null;
  const frame = parse(raw);
  if (!frame || frame.t !== "u") return null;
  const meta = object(frame.m);
  const payload = object(frame.p);
  if (!meta || !payload || meta.o !== "message") return null;
  if (typeof payload.id !== "string" || typeof payload.kind !== "string") {
    return null;
  }
  const named = typeof meta.f === "string" ? meta.f.split("/").pop() ?? "" : "";
  const from = PEER_PATTERN.test(named)
    ? named
    : typeof payload.from === "string"
    ? payload.from
    : "";
  return { id: payload.id, from, kind: payload.kind, data: payload.data };
}

/**
 * The peer a `peer_connected` frame names, or null for any other frame. The
 * channel sends one when a peer connects, so a guest that joined before the
 * host connected knows when to ask again.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function readPeerConnected(raw) {
  if (typeof raw !== "string") return null;
  const frame = parse(raw);
  const meta = frame && object(frame.m);
  if (!frame || frame.t !== "u" || !meta || meta.o !== "peer_connected") {
    return null;
  }
  return typeof frame.p === "string" && PEER_PATTERN.test(frame.p)
    ? frame.p
    : null;
}

/** @param {string} raw */
function parse(raw) {
  try {
    return object(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {Record<string,unknown>|null} */
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string,unknown>} */ (value)
    : null;
}
