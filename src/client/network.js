// @ts-check

import {
  addPlayer,
  removePlayer,
  setNickname,
  setTyping,
  submitMessage,
} from "../shared/world.js";
import { acceptMoveIntent } from "../shared/protocol.js";
import { mergeSnapshot } from "../shared/reconcile.js";
import { renderPosition } from "../shared/world.js";

/** @typedef {import('../shared/world.js').World} World */
/** @typedef {{world:World,localId:string,status:string,renderOffset:{x:number,y:number,z:number},metrics?:{joinMs:number|null,rttMs:number[],route:string}}} Scene */
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

/** Report ICE candidate types without exposing addresses. */
/** @param {RTCPeerConnection} peer */
async function selectedRoute(peer) {
  const stats = await peer.getStats();
  const transport = [...stats.values()].find((stat) =>
    stat.type === "transport" && "selectedCandidatePairId" in stat
  );
  const pairId = transport && "selectedCandidatePairId" in transport
    ? String(transport.selectedCandidatePairId)
    : "";
  const pair = stats.get(pairId);
  if (
    !pair || !("localCandidateId" in pair) ||
    !("remoteCandidateId" in pair)
  ) return "connecting";
  const local = stats.get(String(pair.localCandidateId));
  const remote = stats.get(String(pair.remoteCandidateId));
  const localType = local && "candidateType" in local
    ? String(local.candidateType)
    : "?";
  const remoteType = remote && "candidateType" in remote
    ? String(remote.candidateType)
    : "?";
  return `${localType}/${remoteType}`;
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
  let visitorToken = "";
  let activeAttempt = "";
  let lastAdminSeen = performance.now();
  /** @type {ReturnType<typeof setTimeout>|null} */
  let departureTimer = null;
  /** @type {import('../shared/world.js').Player|null} */
  let rememberedPlayer = null;
  let lastAdminSequence = 0;
  /** @type {{dx:number,dy:number,sequence:number}[]} */
  const pendingMoves = [];
  const heartbeat = () => {
    void fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: session }),
    }).catch(() => {});
  };
  heartbeat();
  const timer = setInterval(heartbeat, 10_000);
  const connectionWatchdog = setInterval(() => {
    if (
      !joined || !scene.world.players.admin ||
      performance.now() - lastAdminSeen <= 4500
    ) return;
    rememberedPlayer = scene.world.players.admin;
    removePlayer(scene.world, "admin");
    joined = false;
    scene.status = "Visitor left. Local world.";
    peer?.close();
    publish();
  }, 500);

  function publish() {
    const state = {
      type: "state",
      world: scene.world,
      lastAdminSequence,
    };
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(state));
    }
  }

  function drainMoves() {
    while (pendingMoves.length) {
      const intent = pendingMoves[0];
      const result = acceptMoveIntent(
        scene.world,
        "admin",
        intent,
        lastAdminSequence,
      );
      if (result.reason === "already moving") return;
      pendingMoves.shift();
      lastAdminSequence = result.sequence;
      publish();
    }
  }

  /** @param {Record<string,unknown>} message */
  function handleAdminMessage(message) {
    try {
      lastAdminSeen = performance.now();
      const player = scene.world.players.admin;
      if (!player) return;
      if (message.type === "ping") {
        const pong = { type: "pong", id: message.id };
        if (channel?.readyState === "open") channel.send(JSON.stringify(pong));
        return;
      }
      if (message.type === "move") {
        if (pendingMoves.length < 8) {
          pendingMoves.push({
            dx: Number(message.dx),
            dy: Number(message.dy),
            sequence: Number(message.sequence),
          });
          drainMoves();
        }
        return;
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

  /** @param {{relay?:boolean,token?:string,attempt?:string}} request */
  async function acceptJoin(request) {
    const token = typeof request.token === "string" ? request.token : "";
    const attempt = typeof request.attempt === "string" ? request.attempt : "";
    if (!token || !attempt) return;
    if (joined && token !== visitorToken) return;
    if (departureTimer) clearTimeout(departureTimer);
    departureTimer = null;
    if (peer) peer.close();
    channel?.close();
    if (token !== visitorToken) rememberedPlayer = null;
    visitorToken = token;
    activeAttempt = attempt;
    joined = true;
    lastAdminSequence = 0;
    pendingMoves.length = 0;
    try {
      const iceServers = await ice();
      if (activeAttempt !== attempt) return;
      const nextPeer = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: request.relay ? "relay" : "all",
      });
      peer = nextPeer;
      channel = nextPeer.createDataChannel("world", { ordered: true });
      channel.onopen = () => {
        lastAdminSeen = performance.now();
        if (rememberedPlayer && !scene.world.players.admin) {
          scene.world.players.admin = rememberedPlayer;
        } else addPlayer(scene.world, "admin", { x: 8, y: 7, z: 0 });
        rememberedPlayer = null;
        scene.status = "A visitor joined your world";
        publish();
      };
      channel.onmessage = fromAdmin;
      nextPeer.onconnectionstatechange = () => {
        if (peer !== nextPeer) return;
        if (!joined) return;
        if (
          nextPeer.connectionState === "failed" ||
          nextPeer.connectionState === "closed" ||
          nextPeer.connectionState === "disconnected"
        ) {
          scene.status = "Visitor reconnecting…";
          if (departureTimer) clearTimeout(departureTimer);
          departureTimer = setTimeout(() => {
            if (peer !== nextPeer || nextPeer.connectionState === "connected") {
              return;
            }
            rememberedPlayer = scene.world.players.admin ?? rememberedPlayer;
            removePlayer(scene.world, "admin");
            joined = false;
            scene.status = "Visitor left. Local world.";
            publish();
          }, 5000);
        } else if (nextPeer.connectionState === "connected" && departureTimer) {
          clearTimeout(departureTimer);
          departureTimer = null;
        }
      };
      await nextPeer.setLocalDescription(await nextPeer.createOffer());
      await gathered(nextPeer);
      if (peer === nextPeer) {
        await signal(session, "admin", "offer", {
          description: nextPeer.localDescription,
          attempt,
        }, "host");
      }
    } catch (error) {
      if (activeAttempt !== attempt) return;
      joined = false;
      rememberedPlayer = scene.world.players.admin ?? rememberedPlayer;
      removePlayer(scene.world, "admin");
      scene.status = "Join failed";
      console.error(error);
    }
  }

  const closeInbox = inbox(session, "host", (message) => {
    if (message.kind === "join") {
      const request =
        /** @type {{relay?:boolean,token?:string,attempt?:string}} */ (message
          .data);
      void acceptJoin(request);
    }
    if (message.kind === "answer" && peer) {
      const answer =
        /** @type {{description:RTCSessionDescriptionInit,attempt:string}} */ (message
          .data);
      if (answer.attempt !== activeAttempt) return;
      void peer.setRemoteDescription(
        answer.description,
      );
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
    tick: drainMoves,
    close() {
      clearInterval(timer);
      clearInterval(connectionWatchdog);
      clearInterval(syncTimer);
      closeInbox();
      if (departureTimer) clearTimeout(departureTimer);
      channel?.close();
      peer?.close();
    },
  };
}

/** @param {Scene} scene @param {string} session */
export function joinWorld(scene, session) {
  /** @type {RTCPeerConnection|null} */
  let peer = null;
  /** @type {RTCDataChannel|null} */
  let channel = null;
  let connected = false;
  let closed = false;
  let attempt = "";
  let attemptStarted = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let retryTimer = null;
  const tokenKey = `opendwarf:visitor:${session}`;
  const token = sessionStorage.getItem(tokenKey) ?? crypto.randomUUID();
  sessionStorage.setItem(tokenKey, token);
  let latestLocalSequence = 0;
  let lastSnapshotTick = -1;
  const forceRelay = new URL(location.href).searchParams.has("relay");
  let lastPong = performance.now();
  let retryNotBefore = 0;
  /** @type {Map<string,number>} */
  const pings = new Map();
  scene.metrics = {
    joinMs: null,
    rttMs: [],
    route: "connecting",
  };
  scene.status = "Connecting to visitor…";

  function requestJoin() {
    if (closed) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retryNotBefore = 0;
    peer?.close();
    channel?.close();
    peer = null;
    channel = null;
    connected = false;
    latestLocalSequence = 0;
    lastSnapshotTick = -1;
    attempt = crypto.randomUUID();
    attemptStarted = performance.now();
    lastPong = attemptStarted;
    if (scene.metrics) {
      scene.metrics.route = "connecting";
      scene.metrics.rttMs = [];
    }
    scene.status = "Reconnecting to visitor…";
    void signal(session, "host", "join", {
      relay: forceRelay,
      token,
      attempt,
    }, "admin").catch((error) => {
      scene.status = "Join request failed; retrying…";
      console.error(error);
    });
  }

  function scheduleRetry() {
    if (closed || retryTimer) return;
    scene.status = "Visitor disconnected; retrying…";
    retryTimer = setTimeout(
      requestJoin,
      Math.max(700, retryNotBefore - performance.now()),
    );
  }

  /** @param {Record<string,unknown>} value */
  function receiveGame(value) {
    if (value.type === "state") {
      const snapshot = /** @type {World} */ (value.world);
      if (snapshot.tick < lastSnapshotTick) return;
      lastSnapshotTick = snapshot.tick;
      if (connected) {
        const before = scene.world.players.admin
          ? renderPosition(scene.world.players.admin, scene.world.tick)
          : null;
        const { corrected } = mergeSnapshot(
          scene.world,
          snapshot,
          Number(value.lastAdminSequence) || 0,
          latestLocalSequence,
        );
        const after = scene.world.players.admin
          ? renderPosition(scene.world.players.admin, scene.world.tick)
          : null;
        if (corrected && before && after) {
          scene.renderOffset.x += before.x - after.x;
          scene.renderOffset.y += before.y - after.y;
          scene.renderOffset.z += before.z - after.z;
        }
      } else {
        scene.world = snapshot;
      }
      scene.localId = "admin";
      scene.status = connected ? "Visitor world" : "Connected to visitor";
      if (!connected && scene.metrics) {
        scene.metrics.joinMs = Math.round(performance.now() - attemptStarted);
      }
      connected = true;
    }
    if (value.type === "pong" && typeof value.id === "string") {
      const sent = pings.get(value.id);
      if (sent !== undefined && scene.metrics) {
        lastPong = performance.now();
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
    if (message.kind !== "offer") return;
    const offer =
      /** @type {{description:RTCSessionDescriptionInit,attempt:string}} */ (message
        .data);
    if (offer.attempt !== attempt) return;
    void (async () => {
      try {
        const nextPeer = new RTCPeerConnection({
          iceServers: await ice(),
          iceTransportPolicy: forceRelay ? "relay" : "all",
        });
        if (closed || offer.attempt !== attempt) {
          nextPeer.close();
          return;
        }
        peer?.close();
        peer = nextPeer;
        nextPeer.ondatachannel = (event) => {
          channel = event.channel;
          channel.onmessage = (incoming) => {
            if (peer !== nextPeer) return;
            try {
              receiveGame(JSON.parse(incoming.data));
            } catch (error) {
              console.error(error);
            }
          };
        };
        nextPeer.onconnectionstatechange = () => {
          if (peer !== nextPeer) return;
          if (
            nextPeer.connectionState === "failed" ||
            nextPeer.connectionState === "closed" ||
            nextPeer.connectionState === "disconnected"
          ) {
            scheduleRetry();
          }
        };
        await nextPeer.setRemoteDescription(offer.description);
        await nextPeer.setLocalDescription(await nextPeer.createAnswer());
        await gathered(nextPeer);
        if (peer === nextPeer && offer.attempt === attempt) {
          await signal(session, "host", "answer", {
            description: nextPeer.localDescription,
            attempt,
          }, "admin");
        }
      } catch (error) {
        scene.status = "Join failed";
        console.error(error);
        scheduleRetry();
      }
    })();
  });
  requestJoin();
  const watchdog = setInterval(() => {
    if (!closed && !connected && performance.now() - attemptStarted > 8000) {
      requestJoin();
    } else if (connected && performance.now() - lastPong > 6000) {
      peer?.close();
      scheduleRetry();
    }
  }, 2000);

  /** @param {Record<string,unknown>} message */
  function send(message) {
    if (channel?.readyState !== "open") return false;
    if (message.type === "move" && typeof message.sequence === "number") {
      latestLocalSequence = Math.max(latestLocalSequence, message.sequence);
    }
    channel.send(JSON.stringify(message));
    return true;
  }
  const pingTimer = setInterval(() => {
    if (!connected) return;
    if (peer && scene.metrics) {
      const currentPeer = peer;
      void selectedRoute(currentPeer).then((route) => {
        if (scene.metrics && peer === currentPeer) {
          scene.metrics.route = route;
        }
      }).catch(console.error);
    }
    const id = crypto.randomUUID();
    pings.set(id, performance.now());
    if (pings.size > 8) pings.delete(pings.keys().next().value ?? "");
    send({ type: "ping", id });
  }, 2000);
  return {
    send,
    /** @param {number} [holdMs] */
    dropConnection(holdMs = 0) {
      retryNotBefore = performance.now() +
        Math.max(0, Math.min(10_000, holdMs));
      peer?.close();
    },
    close() {
      closed = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(pingTimer);
      closeInbox();
      channel?.close();
      peer?.close();
    },
  };
}
