// @ts-check

import {
  addPlayer,
  createWorld,
  isSolid,
  removePlayer,
  setNickname,
  setTyping,
  submitMessage,
} from "../shared/world.js";
import { acceptMoveIntent } from "../shared/protocol.js";
import { mergeSnapshot } from "../shared/reconcile.js";
import { renderPosition } from "../shared/world.js";
import {
  createVisibility,
  tileKey,
  visibilityPosition,
} from "../shared/visibility.js";
import { entityView } from "../shared/view.js";
import { unpackVisibility } from "../shared/visibility-wire.js";
import { createSnapshotSender } from "./snapshot-sender.js";

// Test-only game-message delivery conditions; ICE and physical packets are unchanged.
const harnessParams = new URL(location.href).searchParams;
const harnessDelay = harnessParams.has("harness")
  ? Math.max(0, Math.min(500, Number(harnessParams.get("delay")) || 0))
  : 0;
const harnessJitter = harnessParams.has("harness")
  ? Math.max(0, Math.min(200, Number(harnessParams.get("jitter")) || 0))
  : 0;
const harnessLoss = harnessParams.has("harness")
  ? Math.max(0, Math.min(0.2, Number(harnessParams.get("loss")) || 0))
  : 0;
let randomState = (Number(harnessParams.get("seed")) || 1) >>> 0;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

/** @param {()=>void} receive */
function deliver(receive) {
  if (harnessLoss && random() < harnessLoss) return;
  const delay = harnessDelay +
    (harnessJitter ? (random() * 2 - 1) * harnessJitter : 0);
  if (delay > 0) setTimeout(receive, delay);
  else receive();
}

/** @typedef {import('../shared/world.js').World} World */
/** @typedef {{world:World,localId:string,status:string,viewMode:"entity"|"master",visibility:import('../shared/visibility.js').Visibility,presentation:ReturnType<typeof import('./presentation.js').createPresentation>,renderOffset:{x:number,y:number,z:number},metrics?:{joinMs:number|null,rttMs:number[],route:string}}} Scene */
/** @typedef {{id:string,from:string,kind:string,data:unknown}} Signal */

/** @param {string} session @param {string} recipient @param {string} kind @param {unknown} data @param {string} from */
async function signal(session, recipient, kind, data, from) {
  const response = await fetch(`/api/signal/${session}/${recipient}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: crypto.randomUUID(), from, kind, data }),
  });
  if (!response.ok) throw new Error(`Signaling failed: ${response.status}`);
}

/** @param {string} session @param {string} recipient @param {(signal:Signal)=>void} receive */
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
  /** @type {Map<string,ReturnType<typeof createPeer>>} */
  const peers = new Map();
  let joinFailures = 0;
  let spawnOrdinal = 0;
  const heartbeat = () => {
    void fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: session }),
    }).catch(() => {});
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 10_000);

  function publish() {
    for (const connection of peers.values()) connection.publish();
  }

  function tick() {
    for (const connection of peers.values()) connection.tick();
  }

  function spawn() {
    if (scene.world.edge === 16 && spawnOrdinal < 8) {
      const position = { x: 8 + spawnOrdinal, y: 7, z: 0 };
      spawnOrdinal++;
      return position;
    }
    const positions = [];
    for (let y = 3; y <= 11; y++) {
      for (let x = 3; x <= 12; x++) {
        if (!isSolid(scene.world, x, y, 0)) positions.push({ x, y, z: 0 });
      }
    }
    const position = positions[spawnOrdinal % positions.length];
    spawnOrdinal++;
    return position ?? { x: 7, y: 6, z: 0 };
  }

  /** @param {string} playerId */
  function createPeer(playerId) {
    /** @type {RTCPeerConnection|null} */
    let peer = null;
    /** @type {RTCDataChannel|null} */
    let channel = null;
    /** @type {ReturnType<typeof createSnapshotSender>|null} */
    let snapshotSender = null;
    let joined = false;
    let departedAt = 0;
    let visitorToken = "";
    let activeAttempt = "";
    let lastSeen = performance.now();
    let lastSequence = 0;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let departureTimer = null;
    /** @type {import('../shared/world.js').Player|null} */
    let rememberedPlayer = null;
    /** @type {{dx:number,dy:number,sequence:number}[]} */
    const pendingMoves = [];
    const sight = createVisibility();
    const rememberedTerrain = scene.world.terrain.map(() => 0);
    /** @type {"entity"|"master"} */
    let mode = "entity";

    function publishToPeer() {
      snapshotSender?.publish();
    }

    function depart() {
      if (departureTimer) clearTimeout(departureTimer);
      departureTimer = null;
      rememberedPlayer = scene.world.players[playerId] ?? rememberedPlayer;
      removePlayer(scene.world, playerId);
      joined = false;
      departedAt = performance.now();
      scene.status = "A visitor left your world";
      publish();
    }

    function drainMoves() {
      while (pendingMoves.length) {
        const intent = pendingMoves[0];
        const result = acceptMoveIntent(
          scene.world,
          playerId,
          intent,
          lastSequence,
        );
        if (result.reason === "already moving") return;
        pendingMoves.shift();
        lastSequence = result.sequence;
        publish();
      }
    }

    /** @param {Record<string,unknown>} message */
    function handleMessage(message) {
      lastSeen = performance.now();
      if (!scene.world.players[playerId]) return;
      if (message.type === "ping") {
        if (channel?.readyState === "open") {
          channel.send(JSON.stringify({ type: "pong", id: message.id }));
        }
        return;
      }
      if (message.type === "move") {
        // Only the latest direction is useful while a previous step is finishing.
        // A queued step must not run after the visitor has turned elsewhere.
        pendingMoves.splice(0, pendingMoves.length, {
          dx: Number(message.dx),
          dy: Number(message.dy),
          sequence: Number(message.sequence),
        });
        drainMoves();
        return;
      }
      if (message.type === "cancel") {
        const sequence = Number(message.sequence);
        if (Number.isSafeInteger(sequence) && sequence >= lastSequence) {
          pendingMoves.length = 0;
          lastSequence = sequence;
          publish();
        }
        return;
      }
      if (message.type === "mode") {
        if (message.mode === "entity" || message.mode === "master") {
          mode = message.mode;
          publishToPeer();
        }
        return;
      }
      if (message.type === "typing") {
        setTyping(scene.world, playerId, message.typing === true);
      }
      if (message.type === "message") {
        submitMessage(scene.world, playerId, String(message.text));
      }
      if (message.type === "nick") {
        const result = setNickname(scene.world, playerId, String(message.name));
        channel?.send(JSON.stringify({ type: "nick-result", result }));
      }
      publish();
    }

    /** @param {{relay?:boolean,token?:string,attempt?:string}} request */
    async function acceptJoin(request) {
      const token = typeof request.token === "string" ? request.token : "";
      const attempt = typeof request.attempt === "string"
        ? request.attempt
        : "";
      if (!token || !attempt || (visitorToken && token !== visitorToken)) {
        return;
      }
      if (departureTimer) clearTimeout(departureTimer);
      departureTimer = null;
      snapshotSender?.close();
      peer?.close();
      channel?.close();
      visitorToken = token;
      activeAttempt = attempt;
      joined = true;
      lastSequence = 0;
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
        snapshotSender = createSnapshotSender(channel, () => {
          const view = mode === "master"
            ? { world: scene.world, visibility: null }
            : entityView(scene.world, playerId, sight, rememberedTerrain);
          return {
            type: "state",
            ...view,
            mode,
            playerId,
            acknowledgedSequence: lastSequence,
          };
        });
        channel.onopen = () => {
          if (peer !== nextPeer || !joined) return;
          departedAt = 0;
          lastSeen = performance.now();
          if (rememberedPlayer && !scene.world.players[playerId]) {
            scene.world.players[playerId] = rememberedPlayer;
          } else addPlayer(scene.world, playerId, spawn());
          rememberedPlayer = null;
          scene.status = "A visitor joined your world";
          publish();
        };
        channel.onmessage = (event) =>
          deliver(() => {
            if (peer !== nextPeer || !joined) return;
            try {
              handleMessage(JSON.parse(event.data));
            } catch (error) {
              console.error(error);
            }
          });
        nextPeer.onconnectionstatechange = () => {
          if (peer !== nextPeer || !joined) return;
          if (
            nextPeer.connectionState === "failed" ||
            nextPeer.connectionState === "closed" ||
            nextPeer.connectionState === "disconnected"
          ) {
            if (nextPeer.connectionState === "failed") joinFailures++;
            scene.status = "Visitor reconnecting...";
            if (departureTimer) clearTimeout(departureTimer);
            departureTimer = setTimeout(() => {
              if (
                peer !== nextPeer || nextPeer.connectionState === "connected"
              ) return;
              depart();
            }, 5000);
          } else if (
            nextPeer.connectionState === "connected" && departureTimer
          ) {
            clearTimeout(departureTimer);
            departureTimer = null;
          }
        };
        await nextPeer.setLocalDescription(await nextPeer.createOffer());
        await gathered(nextPeer);
        if (peer === nextPeer) {
          await signal(session, playerId, "offer", {
            description: nextPeer.localDescription,
            attempt,
          }, "host");
        }
      } catch (error) {
        if (activeAttempt !== attempt) return;
        joinFailures++;
        depart();
        scene.status = "Join failed";
        console.error(error);
      }
    }

    /** @param {{description:RTCSessionDescriptionInit,attempt:string}} answer */
    function acceptAnswer(answer) {
      if (answer.attempt !== activeAttempt || !peer) return;
      void peer.setRemoteDescription(answer.description);
    }

    function expireIfSilent() {
      if (
        !joined || !scene.world.players[playerId] ||
        performance.now() - lastSeen <= 4500
      ) return;
      peer?.close();
      depart();
    }

    function close() {
      if (departureTimer) clearTimeout(departureTimer);
      snapshotSender?.close();
      channel?.close();
      peer?.close();
    }

    function tickPeer() {
      drainMoves();
      const player = scene.world.players[playerId];
      const position = player
        ? visibilityPosition(player, scene.world.tick)
        : null;
      if (
        mode === "entity" && position &&
        sight.sample !== tileKey(position.x, position.y, position.z)
      ) {
        publishToPeer();
        return;
      }
      if (mode !== "entity") return;
      for (const other of Object.values(scene.world.players)) {
        if (other.id === playerId || !other.move) continue;
        const move = other.move;
        if (move.origin.z !== move.target.z) continue;
        const entered = scene.world.tick === move.startTick +
            Math.ceil(move.durationTicks * 0.25);
        const left = scene.world.tick === move.startTick +
            Math.ceil(move.durationTicks * 0.75);
        if (!entered && !left) continue;
        const originSeen = sight.visible.has(tileKey(
          move.origin.x,
          move.origin.y,
          move.origin.z,
        ));
        const targetSeen = sight.visible.has(tileKey(
          move.target.x,
          move.target.y,
          move.target.z,
        ));
        if (originSeen !== targetSeen) {
          publishToPeer();
          return;
        }
      }
    }

    return {
      acceptJoin,
      acceptAnswer,
      publish: publishToPeer,
      tick: tickPeer,
      expireIfSilent,
      expired: () =>
        !joined && departedAt > 0 &&
        performance.now() - departedAt >= 60_000,
      close,
      async diagnostics() {
        const stats = peer ? await peer.getStats() : null;
        const dataChannel = stats
          ? [...stats.values()].find((stat) => stat.type === "data-channel")
          : null;
        return {
          playerId,
          connected: peer?.connectionState === "connected",
          route: peer ? await selectedRoute(peer) : "none",
          bytesSent: dataChannel && "bytesSent" in dataChannel
            ? Number(dataChannel.bytesSent)
            : 0,
          bufferedAmount: channel?.bufferedAmount ?? 0,
        };
      },
    };
  }

  const closeInbox = inbox(session, "host", (message) => {
    if (message.kind === "join") {
      const request =
        /** @type {{playerId?:string,relay?:boolean,token?:string,attempt?:string}} */ (message
          .data);
      const playerId = request.playerId ?? "";
      if (!/^peer-[a-f0-9-]{36}$/.test(playerId)) return;
      let connection = peers.get(playerId);
      if (!connection) {
        connection = createPeer(playerId);
        peers.set(playerId, connection);
      }
      void connection.acceptJoin(request);
    }
    if (message.kind === "answer") {
      const answer =
        /** @type {{playerId:string,description:RTCSessionDescriptionInit,attempt:string}} */ (message
          .data);
      peers.get(answer.playerId)?.acceptAnswer(answer);
    }
  });
  const syncTimer = setInterval(publish, 500);
  const watchdog = setInterval(() => {
    for (const [playerId, connection] of peers) {
      connection.expireIfSilent();
      if (connection.expired()) {
        connection.close();
        peers.delete(playerId);
      }
    }
  }, 500);
  globalThis.addEventListener("pagehide", () => {
    for (const playerId of peers.keys()) {
      navigator.sendBeacon(
        "/api/signal/" + session + "/" + playerId,
        new Blob([
          JSON.stringify({
            id: crypto.randomUUID(),
            from: "host",
            kind: "leave",
            data: {},
          }),
        ], { type: "application/json" }),
      );
    }
    void fetch("/api/presence/" + session, {
      method: "DELETE",
      keepalive: true,
    });
  }, { once: true });
  return {
    publish,
    tick,
    async diagnostics() {
      const connections = await Promise.all(
        [...peers.values()].map((connection) => connection.diagnostics()),
      );
      return {
        at: performance.now(),
        players: Object.keys(scene.world.players).length,
        joinFailures,
        connections,
      };
    },
    close() {
      clearInterval(heartbeatTimer);
      clearInterval(watchdog);
      clearInterval(syncTimer);
      closeInbox();
      for (const connection of peers.values()) connection.close();
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
  const playerIdKey = `opendwarf:peer-id:${session}`;
  const playerId = sessionStorage.getItem(playerIdKey) ??
    `peer-${crypto.randomUUID()}`;
  sessionStorage.setItem(playerIdKey, playerId);
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
      playerId,
      relay: forceRelay,
      token,
      attempt,
    }, playerId).catch((error) => {
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
      const incomingMode = value.mode === "master" ? "master" : "entity";
      const modeChanged = scene.viewMode !== incomingMode;
      if (connected && !modeChanged) {
        const before = scene.world.players[playerId]
          ? renderPosition(scene.world.players[playerId], scene.world.tick)
          : null;
        const { corrected } = mergeSnapshot(
          scene.world,
          snapshot,
          Number(value.acknowledgedSequence) || 0,
          latestLocalSequence,
          playerId,
        );
        const after = scene.world.players[playerId]
          ? renderPosition(scene.world.players[playerId], scene.world.tick)
          : null;
        if (corrected && before && after) {
          scene.renderOffset.x += before.x - after.x;
          scene.renderOffset.y += before.y - after.y;
          scene.renderOffset.z += before.z - after.z;
        }
      } else {
        scene.world = snapshot;
        scene.presentation.reset();
        scene.renderOffset = { x: 0, y: 0, z: 0 };
      }
      scene.viewMode = incomingMode;
      scene.visibility = incomingMode === "entity"
        ? unpackVisibility(
          /** @type {import('../shared/visibility-wire.js').WireVisibility} */ (value
            .visibility),
        )
        : createVisibility();
      scene.localId = playerId;
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

  const closeInbox = inbox(session, playerId, (message) => {
    if (message.kind === "leave") {
      scene.world = createWorld();
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
          channel.onmessage = (incoming) =>
            deliver(() => {
              if (peer !== nextPeer) return;
              try {
                receiveGame(JSON.parse(incoming.data));
              } catch (error) {
                console.error(error);
              }
            });
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
            playerId,
            description: nextPeer.localDescription,
            attempt,
          }, playerId);
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
    /** @param {"entity"|"master"} mode */
    setMode(mode) {
      return send({ type: "mode", mode });
    },
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
