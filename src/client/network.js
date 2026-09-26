// @ts-check

import {
  addPlayer,
  removePlayer,
  setNickname,
  setTyping,
  submitMessage,
} from "../shared/world.js";
import { acceptMoveIntent } from "../shared/protocol.js";

/** @typedef {import('../shared/world.js').World} World */
/** @typedef {{world:World,localId:string,status:string,metrics?:{transport:string,joinMs:number|null,rttMs:number[]}}} Scene */
/** @typedef {{id:string,from:'host'|'admin',kind:string,data:unknown}} Signal */

/** @param {string} session @param {'host'|'admin'} recipient @param {string} kind @param {unknown} data @param {'host'|'admin'} from */
async function signal(session, recipient, kind, data, from) {
  const response = await fetch(`/api/signal/${session}/${recipient}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: crypto.randomUUID(), from, kind, data }),
  });
  if (!response.ok) throw new Error(`Signaling failed: ${response.status}`);
}

/** @param {string} session @param {'host'|'admin'} recipient @param {(signal:Signal)=>void} receive */
function inbox(session, recipient, receive) {
  const events = new EventSource(`/api/signal/${session}/${recipient}`);
  /** @type {Set<string>} */
  const seen = new Set();
  events.onmessage = (event) => {
    try {
      const message = /** @type {Signal} */ (JSON.parse(event.data));
      if (seen.has(message.id)) return;
      seen.add(message.id);
      if (seen.size > 64) {
        const oldest = seen.values().next().value;
        if (oldest) seen.delete(oldest);
      }
      receive(message);
    } catch (error) {
      console.error(error);
    }
  };
  return () => events.close();
}

async function ice() {
  const response = await fetch("/api/ice");
  if (!response.ok) throw new Error("ICE configuration unavailable");
  const data = await response.json();
  return /** @type {RTCIceServer[]} */ (data.iceServers);
}

/** @param {RTCPeerConnection} peer */
function gathered(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", done);
        resolve(undefined);
      }
    };
    peer.addEventListener("icegatheringstatechange", done);
    setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", done);
      resolve(undefined);
    }, 4000);
  });
}

/** @param {Scene} scene @param {string} session */
export function startHost(scene, session) {
  /** @type {RTCPeerConnection|null} */
  let peer = null;
  /** @type {RTCDataChannel|null} */
  let channel = null;
  let joined = false;
  let sseConnected = false;
  let lastAdminSequence = 0;
  const heartbeat = () => {
    void fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: session }),
    }).catch(() => {});
  };
  heartbeat();
  const timer = setInterval(heartbeat, 10_000);

  function publish() {
    const state = { type: "state", world: scene.world };
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(state));
    }
    if (sseConnected) {
      void signal(session, "admin", "game", state, "host").catch(console.error);
    }
  }

  /** @param {Record<string,unknown>} message */
  function handleAdminMessage(message) {
    try {
      const player = scene.world.players.admin;
      if (!player) return;
      if (message.type === "ping") {
        const pong = { type: "pong", id: message.id };
        if (channel?.readyState === "open") channel.send(JSON.stringify(pong));
        if (sseConnected) {
          void signal(session, "admin", "game", pong, "host").catch(
            console.error,
          );
        }
        return;
      }
      if (message.type === "move") {
        const result = acceptMoveIntent(
          scene.world,
          "admin",
          {
            dx: Number(message.dx),
            dy: Number(message.dy),
            sequence: Number(message.sequence),
          },
          lastAdminSequence,
        );
        lastAdminSequence = result.sequence;
      }
      if (message.type === "typing") {
        setTyping(scene.world, "admin", message.typing === true);
      }
      if (message.type === "message") {
        submitMessage(scene.world, "admin", String(message.text));
      }
      if (message.type === "nick") {
        const result = setNickname(scene.world, "admin", String(message.name));
        channel?.send(JSON.stringify({ type: "nick-result", result }));
        if (sseConnected) {
          void signal(
            session,
            "admin",
            "game",
            { type: "nick-result", result },
            "host",
          );
        }
      }
      publish();
    } catch (error) {
      console.error(error);
    }
  }

  /** @param {MessageEvent<string>} event */
  function fromAdmin(event) {
    try {
      handleAdminMessage(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  }

  /** @param {'webrtc'|'sse'} mode */
  async function acceptJoin(mode) {
    if (joined) return;
    joined = true;
    if (mode === "sse") {
      sseConnected = true;
      addPlayer(scene.world, "admin", { x: 8, y: 7 });
      scene.status = "A visitor joined your world";
      publish();
      return;
    }
    try {
      peer = new RTCPeerConnection({ iceServers: await ice() });
      channel = peer.createDataChannel("world", { ordered: true });
      channel.onopen = () => {
        addPlayer(scene.world, "admin", { x: 8, y: 7 });
        scene.status = "A visitor joined your world";
        publish();
      };
      channel.onmessage = fromAdmin;
      peer.onconnectionstatechange = () => {
        if (
          peer?.connectionState === "failed" ||
          peer?.connectionState === "closed" ||
          peer?.connectionState === "disconnected"
        ) {
          removePlayer(scene.world, "admin");
          scene.status = "Visitor left. Local world.";
          joined = false;
          publish();
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      await gathered(peer);
      await signal(session, "admin", "offer", peer.localDescription, "host");
    } catch (error) {
      joined = false;
      scene.status = "Join failed";
      console.error(error);
    }
  }

  const closeInbox = inbox(session, "host", (message) => {
    if (message.kind === "join") {
      const mode = /** @type {{transport?:string}} */ (message.data)?.transport;
      void acceptJoin(mode === "sse" ? "sse" : "webrtc");
    }
    if (message.kind === "answer" && peer) {
      void peer.setRemoteDescription(
        /** @type {RTCSessionDescriptionInit} */ (message.data),
      );
    }
    if (
      message.kind === "game" && sseConnected && message.data &&
      typeof message.data === "object"
    ) {
      handleAdminMessage(/** @type {Record<string,unknown>} */ (message.data));
    }
    if (message.kind === "leave" && sseConnected) {
      sseConnected = false;
      joined = false;
      removePlayer(scene.world, "admin");
      scene.status = "Visitor left. Local world.";
    }
  });
  const syncTimer = setInterval(publish, 500);
  globalThis.addEventListener("pagehide", () => {
    navigator.sendBeacon(
      `/api/signal/${session}/admin`,
      new Blob([
        JSON.stringify({
          id: crypto.randomUUID(),
          from: "host",
          kind: "leave",
          data: {},
        }),
      ], { type: "application/json" }),
    );
    void fetch(`/api/presence/${session}`, {
      method: "DELETE",
      keepalive: true,
    });
  }, { once: true });
  return {
    publish,
    close() {
      clearInterval(timer);
      clearInterval(syncTimer);
      closeInbox();
      channel?.close();
      peer?.close();
    },
  };
}

/** @param {Scene} scene @param {string} session @param {'webrtc'|'sse'} [mode] */
export function joinWorld(scene, session, mode = "webrtc") {
  /** @type {RTCPeerConnection|null} */
  let peer = null;
  /** @type {RTCDataChannel|null} */
  let channel = null;
  let connected = false;
  const startedAt = performance.now();
  /** @type {Map<string,number>} */
  const pings = new Map();
  scene.metrics = { transport: mode, joinMs: null, rttMs: [] };
  scene.status = "Connecting to visitor…";

  /** @param {Record<string,unknown>} value */
  function receiveGame(value) {
    if (value.type === "state") {
      scene.world = /** @type {World} */ (value.world);
      scene.localId = "admin";
      scene.status = connected ? "Visitor world" : "Connected to visitor";
      if (!connected && scene.metrics) {
        scene.metrics.joinMs = Math.round(performance.now() - startedAt);
      }
      connected = true;
    }
    if (value.type === "pong" && typeof value.id === "string") {
      const sent = pings.get(value.id);
      if (sent !== undefined && scene.metrics) {
        scene.metrics.rttMs.push(Math.round(performance.now() - sent));
        scene.metrics.rttMs = scene.metrics.rttMs.slice(-32);
        pings.delete(value.id);
      }
    }
    if (
      value.type === "nick-result" && value.result &&
      typeof value.result === "object"
    ) {
      const result = /** @type {{ok:boolean,reason?:string}} */ (value.result);
      if (!result.ok) scene.status = result.reason ?? "Name rejected";
    }
  }

  const closeInbox = inbox(session, "admin", (message) => {
    if (message.kind === "leave") {
      scene.world = { tick: 0, players: {} };
      scene.status = "Visitor left. World ended.";
      connected = false;
      return;
    }
    if (
      mode === "sse" && message.kind === "game" && message.data &&
      typeof message.data === "object"
    ) {
      receiveGame(/** @type {Record<string,unknown>} */ (message.data));
    }
    if (message.kind !== "offer") return;
    void (async () => {
      try {
        peer = new RTCPeerConnection({ iceServers: await ice() });
        peer.ondatachannel = (event) => {
          channel = event.channel;
          channel.onmessage = (incoming) => {
            try {
              receiveGame(JSON.parse(incoming.data));
            } catch (error) {
              console.error(error);
            }
          };
        };
        peer.onconnectionstatechange = () => {
          if (
            peer?.connectionState === "failed" ||
            peer?.connectionState === "closed" ||
            peer?.connectionState === "disconnected"
          ) {
            scene.status = "Visitor disconnected";
          }
        };
        await peer.setRemoteDescription(
          /** @type {RTCSessionDescriptionInit} */ (message.data),
        );
        await peer.setLocalDescription(await peer.createAnswer());
        await gathered(peer);
        await signal(session, "host", "answer", peer.localDescription, "admin");
      } catch (error) {
        scene.status = "Join failed";
        console.error(error);
      }
    })();
  });
  void signal(session, "host", "join", { transport: mode }, "admin").catch(
    (error) => {
      scene.status = "Join request failed";
      console.error(error);
    },
  );

  /** @param {Record<string,unknown>} message */
  function send(message) {
    if (mode === "sse") {
      void signal(session, "host", "game", message, "admin").catch(
        console.error,
      );
      return true;
    }
    if (channel?.readyState !== "open") return false;
    channel.send(JSON.stringify(message));
    return true;
  }
  const pingTimer = setInterval(() => {
    if (!connected) return;
    const id = crypto.randomUUID();
    pings.set(id, performance.now());
    if (pings.size > 8) pings.delete(pings.keys().next().value ?? "");
    send({ type: "ping", id });
  }, 2000);
  return {
    send,
    close() {
      clearInterval(pingTimer);
      if (mode === "sse") void signal(session, "host", "leave", {}, "admin");
      closeInbox();
      channel?.close();
      peer?.close();
    },
  };
}
