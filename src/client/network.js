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
import {
  cancelMining,
  miningEntries,
  startMining,
  stepMining,
} from "../shared/mining.js";
import {
  chunkCoord,
  chunkIndex,
  chunkKey,
  drainTileChanges,
  getChunk,
  localCoord,
} from "../shared/terrain.js";
import { mergeSnapshot } from "../shared/reconcile.js";
import { renderPosition } from "../shared/world.js";
import {
  createVisibility,
  tileKey,
  visibilityPosition,
} from "../shared/visibility.js";
import { entityPlayers, entityView } from "../shared/view.js";
import { unpackVisibility } from "../shared/visibility-wire.js";
import { createSnapshotSender } from "./snapshot-sender.js";
import {
  enableLocomotion,
  moveEntity,
  speedTilesPerSecond,
} from "../shared/locomotion.js";
import { createStamina, setSprint, stepStamina } from "../shared/stamina.js";
import { chatView, receiveChat } from "../shared/chat.js";
import { createAttemptDeadline } from "./attempt-deadline.js";
import { createRevisionOrder } from "./revision-order.js";
import {
  decodeChat,
  decodeControl,
  decodeMining,
  decodeMotion,
  decodeState,
  decodeTerrainChanges,
  encodeMotionPlayers,
  encodeWorld,
  MAX_TERRAIN_CHANGES,
  parsePacket,
  PROTOCOL_VERSION,
} from "../shared/wire.js";
import { centerTile } from "../shared/locomotion.js";
import { roomSpawnTile } from "../shared/spawn-room.js";

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
const motionHz =
  harnessParams.has("harness") && harnessParams.get("motionHz") === "20"
    ? 20
    : 10;
let randomState = (Number(harnessParams.get("seed")) || 1) >>> 0;
function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

/** @param {()=>void} receive @param {boolean} [replaceable] */
function deliver(receive, replaceable = false) {
  if (replaceable && harnessLoss && random() < harnessLoss) return;
  const delay = harnessDelay +
    (harnessJitter ? (random() * 2 - 1) * harnessJitter : 0);
  if (delay > 0) setTimeout(receive, delay);
  else receive();
}

/** @typedef {import('../shared/world.js').World} World */
/** @typedef {{at:number,entries:import('../shared/mining.js').MiningEntry[]}} MineFeed */
/** @typedef {{world:World,localId:string,layout?:"room"|"test",status:string,mineFeed?:MineFeed,viewMode:"entity"|"master",visibility:import('../shared/visibility.js').Visibility,presentation:ReturnType<typeof import('./presentation.js').createPresentation>,chatFeed:import('../shared/chat.js').DisplayChatRecord[],systemLine?:(text:string)=>void,renderOffset:{x:number,y:number,z:number},metrics?:{joinMs:number|null,rttMs:number[],route:string},telemetry?:(kind:"connection"|"error",fields?:Record<string,unknown>)=>void}} Scene */
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
  // Generated chunks appear later, so count the authored area before any exist.
  const authoredChunks = scene.world.chunks.size;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let publishTimer = null;
  let lastPublish = 0;
  const heartbeat = () => {
    void fetch("/api/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: session }),
    }).catch(() => {});
  };
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 10_000);

  function flushPublish() {
    publishTimer = null;
    lastPublish = performance.now();
    for (const connection of peers.values()) connection.publish();
  }

  /**
   * Adds a system line to the host's hearing log and sends it to every joined
   * guest except `exceptId`. Features such as pickups and sales call this.
   * @param {string} text @param {string} [exceptId]
   */
  function announce(text, exceptId) {
    scene.systemLine?.(text);
    for (const [id, connection] of peers) {
      if (id !== exceptId) connection.system(text);
    }
  }

  function publish() {
    if (publishTimer) return;
    publishTimer = setTimeout(
      flushPublish,
      Math.max(0, 100 - (performance.now() - lastPublish)),
    );
  }

  function tick() {
    // Finished mining is handled in `completeMining`; the tile it wrote reaches
    // each peer that can see it as a small terrain message.
    stepMining(scene.world);
    const changes = drainTileChanges(scene.world);
    if (changes.length) {
      // Force the host's own sight to see through a mined tile.
      scene.visibility.sample = "";
      for (const connection of peers.values()) connection.terrain(changes);
    }
    for (const connection of peers.values()) connection.tick();
  }

  function spawn() {
    if (scene.layout === "room") return roomSpawnTile(++spawnOrdinal);
    if (authoredChunks === 1 && spawnOrdinal < 8) {
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
    /** @type {RTCDataChannel|null} */
    let motionChannel = null;
    /** @type {ReturnType<typeof createSnapshotSender>|null} */
    let motionSender = null;
    /** @type {ReturnType<typeof createSnapshotSender>|null} */
    let chatSender = null;
    let viewRevision = 0;
    let sightRevision = 0;
    let lastSight = "";
    let joined = false;
    let departedAt = 0;
    let visitorToken = "";
    let activeAttempt = "";
    let lastSeen = performance.now();
    let lastSequence = 0;
    /** What this peer was last told about visible mining, to send only changes. */
    let lastMining = "";
    let direction = { x: 0, y: 0 };
    /** The host tracks stamina, so a guest cannot sprint without it. */
    let stamina = createStamina();
    /** @type {ReturnType<typeof setTimeout>|null} */
    let departureTimer = null;
    /** @type {import('../shared/world.js').Player|null} */
    let rememberedPlayer = null;
    /** @type {{dx:number,dy:number,sequence:number}[]} */
    const pendingMoves = [];
    const timing = {
      filterMs: 0,
      encodeMs: 0,
      sendMs: 0,
      statePackets: 0,
      motionPackets: 0,
      chatPackets: 0,
      encodedChars: 0,
    };
    const sight = createVisibility();
    /** @type {Map<string,import('../shared/chat.js').ChatBand>} */
    const chatBands = new Map();
    /** @type {import('../shared/view.js').RememberedTerrain} */
    const rememberedTerrain = new Map();
    /** @type {"entity"|"master"} */
    let mode = "entity";
    const deadline = createAttemptDeadline((attempt) => {
      if (activeAttempt !== attempt) return;
      activeAttempt = "";
      snapshotSender?.close();
      motionSender?.close();
      chatSender?.close();
      motionChannel?.close();
      peer?.close();
      channel?.close();
      joinFailures++;
      depart();
      scene.status = "Visitor connection timed out";
    });

    function publishToPeer() {
      if (scene.world.players[playerId]) snapshotSender?.publish();
    }

    function stamp() {
      if (mode === "entity" && lastSight !== sight.sample) {
        lastSight = sight.sample;
        sightRevision++;
      }
      return { attempt: activeAttempt, viewRevision, sightRevision };
    }

    /** @param {"state"|"motion"|"chat"} kind */
    function recordSend(kind) {
      /** @param {{bytes:number,encodeMs:number,sendMs:number}} sample */
      return (sample) => {
        if (kind === "state") timing.statePackets++;
        if (kind === "motion") timing.motionPackets++;
        if (kind === "chat") timing.chatPackets++;
        timing.encodedChars += sample.bytes;
        timing.encodeMs += sample.encodeMs;
        timing.sendMs += sample.sendMs;
      };
    }

    function depart() {
      if (departureTimer) clearTimeout(departureTimer);
      departureTimer = null;
      const established = scene.world.players[playerId];
      rememberedPlayer = established ?? rememberedPlayer;
      removePlayer(scene.world, playerId);
      direction = { x: 0, y: 0 };
      joined = false;
      if (established || !departedAt) departedAt = performance.now();
      scene.status = "A visitor left your world";
      if (established) announce(`${established.name || "A visitor"} left`);
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
      if (message.type === "resync") {
        publishToPeer();
        return;
      }
      if (message.type === "ping") {
        if (channel?.readyState === "open") {
          channel.send(JSON.stringify({ type: "pong", id: message.id }));
        }
        return;
      }
      if (message.type === "input") {
        const dx = Number(message.dx);
        const dy = Number(message.dy);
        const incomingSequence = Number(message.sequence);
        if (
          Number.isSafeInteger(incomingSequence) &&
          incomingSequence >= lastSequence &&
          Number.isInteger(dx) && Number.isInteger(dy) &&
          Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        ) {
          lastSequence = incomingSequence;
          direction = { x: dx, y: dy };
          setSprint(stamina, message.sprint === true);
        }
        return;
      }
      if (message.type === "mine") {
        const result = startMining(scene.world, playerId, {
          x: Number(message.x),
          y: Number(message.y),
          z: Number(message.z),
        });
        if (!result.ok && channel?.readyState === "open") {
          channel.send(
            JSON.stringify({ type: "mine-result", reason: result.reason }),
          );
        }
        return;
      }
      if (message.type === "mine-cancel") {
        cancelMining(scene.world, playerId);
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
          if (mode !== message.mode) {
            mode = message.mode;
            viewRevision++;
            sightRevision = 0;
            lastSight = "";
          }
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
        const before = scene.world.players[playerId]?.name ?? "";
        const result = setNickname(scene.world, playerId, String(message.name));
        if (result.ok && result.name !== before) {
          announce(`${before || "A visitor"} is now ${result.name}`);
        }
        channel?.send(JSON.stringify({ type: "nick-result", result }));
      }
      publish();
    }

    /** @param {{relay?:boolean,token?:string,attempt?:string,version?:number}} request */
    async function acceptJoin(request) {
      const token = typeof request.token === "string" ? request.token : "";
      const attempt = typeof request.attempt === "string"
        ? request.attempt
        : "";
      if (request.version !== PROTOCOL_VERSION) {
        await signal(session, playerId, "incompatible", {
          attempt,
          version: PROTOCOL_VERSION,
        }, "host");
        scene.status =
          "Visitor uses a different game version. Refresh both pages.";
        return;
      }
      if (!token || !attempt || (visitorToken && token !== visitorToken)) {
        return;
      }
      if (departureTimer) clearTimeout(departureTimer);
      departureTimer = null;
      snapshotSender?.close();
      motionSender?.close();
      chatSender?.close();
      motionChannel?.close();
      peer?.close();
      channel?.close();
      visitorToken = token;
      activeAttempt = attempt;
      deadline.start(attempt);
      joined = true;
      lastSequence = 0;
      lastMining = "";
      direction = { x: 0, y: 0 };
      stamina = createStamina();
      pendingMoves.length = 0;
      viewRevision = sightRevision = 0;
      lastSight = "";
      try {
        const iceServers = await ice();
        if (activeAttempt !== attempt) return;
        const nextPeer = new RTCPeerConnection({
          iceServers,
          iceTransportPolicy: request.relay ? "relay" : "all",
        });
        peer = nextPeer;
        channel = nextPeer.createDataChannel("world", { ordered: true });
        motionChannel = nextPeer.createDataChannel("motion", {
          ordered: false,
          maxRetransmits: 0,
        });
        snapshotSender = createSnapshotSender(channel, () => {
          const began = performance.now();
          const view = mode === "master"
            ? { world: scene.world, visibility: null }
            : entityView(scene.world, playerId, sight, rememberedTerrain);
          timing.filterMs += performance.now() - began;
          return {
            type: "state",
            ...stamp(),
            ...view,
            world: encodeWorld(view.world),
            chat: chatView(scene.world, playerId, chatBands),
            mode,
            playerId,
            acknowledgedSequence: lastSequence,
          };
        }, recordSend("state"));
        motionSender = createSnapshotSender(motionChannel, () => {
          const began = performance.now();
          const players = mode === "master"
            ? scene.world.players
            : entityPlayers(scene.world, playerId, sight, rememberedTerrain);
          timing.filterMs += performance.now() - began;
          const previousSight = sightRevision;
          const envelope = stamp();
          if (sightRevision !== previousSight) publishToPeer();
          return {
            type: "motion",
            ...envelope,
            tick: scene.world.tick,
            players: encodeMotionPlayers(players),
            acknowledgedSequence: lastSequence,
          };
        }, recordSend("motion"));
        chatSender = createSnapshotSender(channel, () => ({
          type: "chat",
          ...stamp(),
          tick: scene.world.tick,
          chat: chatView(scene.world, playerId, chatBands),
        }), recordSend("chat"));
        let opened = false;
        const ready = () => {
          if (
            peer !== nextPeer || !joined || opened ||
            channel?.readyState !== "open" ||
            motionChannel?.readyState !== "open"
          ) return;
          opened = true;
          deadline.complete(attempt);
          departedAt = 0;
          lastSeen = performance.now();
          const rejoined = Boolean(rememberedPlayer);
          if (rememberedPlayer && !scene.world.players[playerId]) {
            scene.world.players[playerId] = rememberedPlayer;
          } else enableLocomotion(addPlayer(scene.world, playerId, spawn()));
          announce(
            `${scene.world.players[playerId]?.name || "A visitor"} ${
              rejoined ? "rejoined" : "joined"
            }`,
            playerId,
          );
          rememberedPlayer = null;
          scene.status = "A visitor joined your world";
          publish();
        };
        channel.onopen = ready;
        motionChannel.onopen = ready;
        const channelClosed = () => {
          if (peer !== nextPeer || !joined || !opened) return;
          snapshotSender?.close();
          motionSender?.close();
          chatSender?.close();
          nextPeer.close();
          depart();
        };
        channel.onclose = channelClosed;
        motionChannel.onclose = channelClosed;
        channel.onmessage = (event) =>
          deliver(() => {
            if (peer !== nextPeer || !joined || !opened) return;
            const message = decodeControl(parsePacket(event.data));
            if (message) handleMessage(message);
          });
        nextPeer.onconnectionstatechange = () => {
          if (peer !== nextPeer || !joined) return;
          if (
            nextPeer.connectionState === "failed" ||
            nextPeer.connectionState === "closed" ||
            nextPeer.connectionState === "disconnected"
          ) {
            if (nextPeer.connectionState === "failed") joinFailures++;
            if (nextPeer.connectionState === "failed") {
              scene.telemetry?.("error", { status: "peer-failed" });
            }
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
            version: PROTOCOL_VERSION,
          }, "host");
        }
      } catch (error) {
        if (activeAttempt !== attempt) return;
        deadline.complete(attempt);
        joinFailures++;
        scene.telemetry?.("error", { status: "join-failed" });
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
      if (deadline.check()) return;
      if (
        !joined || !scene.world.players[playerId] ||
        performance.now() - lastSeen <= 4500
      ) return;
      peer?.close();
      depart();
    }

    function close() {
      deadline.close();
      joined = false;
      activeAttempt = "";
      if (departureTimer) clearTimeout(departureTimer);
      snapshotSender?.close();
      motionSender?.close();
      chatSender?.close();
      motionChannel?.close();
      channel?.close();
      peer?.close();
    }

    /** Tell the peer which mining actions it can see, when that list changes. */
    function sendMining() {
      if (!joined || channel?.readyState !== "open") return;
      const entries = miningEntries(scene.world).filter((entry) =>
        entry.id === playerId || mode === "master" ||
        sight.visible.has(tileKey(entry.x, entry.y, entry.z))
      );
      const signature = entries.map((entry) =>
        `${entry.id}:${entry.x},${entry.y},${entry.z}`
      ).join(";");
      if (signature === lastMining) return;
      lastMining = signature;
      channel.send(JSON.stringify({ type: "mining", entries }));
    }

    /**
     * Send the changed tiles this peer can see. Remembered terrain follows only
     * what the peer sees; a tile out of sight keeps its last observed state.
     * @param {import('../shared/terrain.js').TileChange[]} changes
     */
    function sendTerrain(changes) {
      if (
        !joined || channel?.readyState !== "open" ||
        !scene.world.players[playerId]
      ) return;
      const seen = mode === "master"
        ? changes
        : changes.filter((change) =>
          sight.visible.has(tileKey(change.x, change.y, change.z))
        );
      if (!seen.length) return;
      if (mode === "entity") {
        for (const change of seen) {
          const chunk = rememberedTerrain.get(
            chunkKey(chunkCoord(change.x), chunkCoord(change.y)),
          );
          if (chunk) {
            chunk[
              chunkIndex(
                localCoord(change.x),
                localCoord(change.y),
                change.z,
              )
            ] = change.material;
          }
        }
        // Sight may now pass through the tile; the next snapshot recomputes it.
        sight.sample = "";
      }
      for (let i = 0; i < seen.length; i += MAX_TERRAIN_CHANGES) {
        channel.send(JSON.stringify({
          type: "terrain",
          changes: seen.slice(i, i + MAX_TERRAIN_CHANGES),
        }));
      }
    }

    function tickPeer() {
      sendMining();
      drainMoves();
      moveEntity(
        scene.world,
        playerId,
        direction.x,
        direction.y,
        speedTilesPerSecond(stamina.sprint),
      );
      stepStamina(stamina);
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
      motion() {
        if (joined && scene.world.players[playerId]) motionSender?.publish();
      },
      chat() {
        if (joined && scene.world.players[playerId]) chatSender?.publish();
      },
      /** @param {string} text */
      system(text) {
        if (joined && channel?.readyState === "open") {
          channel.send(JSON.stringify({ type: "system", text }));
        }
      },
      tick: tickPeer,
      terrain: sendTerrain,
      expireIfSilent,
      expired: () =>
        !joined && departedAt > 0 &&
        (!rememberedPlayer || performance.now() - departedAt >= 60_000),
      close,
      async diagnostics() {
        const stats = peer ? await peer.getStats() : null;
        const dataChannels = stats
          ? [...stats.values()].filter((stat) => stat.type === "data-channel")
          : [];
        const bytes = (/** @type {string|undefined} */ label) =>
          dataChannels.reduce(
            (sum, stat) =>
              sum +
              ((!label || stat.label === label)
                ? Number(stat.bytesSent ?? 0)
                : 0),
            0,
          );
        return {
          playerId,
          timing: { ...timing },
          connected: peer?.connectionState === "connected",
          route: peer ? await selectedRoute(peer) : "none",
          bytesSent: bytes(undefined),
          reliableBytesSent: bytes("world"),
          motionBytesSent: bytes("motion"),
          motionBufferedAmount: motionChannel?.bufferedAmount ?? 0,
          channels: {
            reliable: channel?.readyState,
            motion: motionChannel?.readyState,
          },
          bufferedAmount: channel?.bufferedAmount ?? 0,
        };
      },
    };
  }

  const closeInbox = inbox(session, "host", (message) => {
    if (message.kind === "join") {
      const request =
        /** @type {{playerId?:string,relay?:boolean,token?:string,attempt?:string,version?:number}} */ (message
          .data);
      const playerId = request.playerId ?? "";
      if (!/^peer-[a-f0-9-]{36}$/.test(playerId) || playerId !== message.from) {
        return;
      }
      if (
        typeof request.attempt !== "string" || !request.attempt ||
        request.attempt.length > 128 || typeof request.token !== "string" ||
        !request.token || request.token.length > 128
      ) return;
      if (request.version !== PROTOCOL_VERSION) {
        void signal(session, playerId, "incompatible", {
          attempt: request.attempt,
          version: PROTOCOL_VERSION,
        }, "host").catch(console.error);
        scene.status =
          "Visitor uses a different game version. Refresh both pages.";
        return;
      }
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
  let motionUntil = 0;
  const motionTimer = setInterval(() => {
    const now = performance.now();
    if (
      Object.values(scene.world.players).some((player) =>
        player.move || Math.hypot(player.vx ?? 0, player.vy ?? 0) > 0.05
      )
    ) motionUntil = now + 300;
    if (now <= motionUntil) {
      for (const connection of peers.values()) connection.motion();
    }
  }, 1000 / motionHz);
  let hadChat = false;
  const chatTimer = setInterval(() => {
    const active = Object.values(scene.world.players).some((player) =>
      player.typing ||
      Boolean(player.message) && scene.world.tick < player.messageUntil
    );
    if (active || hadChat) {
      for (const connection of peers.values()) connection.chat();
    }
    hadChat = active;
  }, 100);
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
    announce,
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
      if (publishTimer) clearTimeout(publishTimer);
      clearInterval(heartbeatTimer);
      clearInterval(watchdog);
      clearInterval(syncTimer);
      clearInterval(motionTimer);
      clearInterval(chatTimer);
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
  /** @type {RTCDataChannel|null} */
  let motionChannel = null;
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
  const revisions = createRevisionOrder();
  /** @type {import('../shared/wire.js').MotionPacket|null} */
  let pendingMotion = null;
  let pendingSince = 0;
  let resyncFailures = 0;
  const corrections = { count: 0, totalGap: 0, maxGap: 0 };
  let lastResync = -Infinity;
  /** The last state as sent: chunks are run-length strings. */
  /** @type {(Omit<import('../shared/wire.js').StatePacket,'world'> & {world:ReturnType<typeof encodeWorld>})|null} */
  let debugState = null;
  /** @type {import('../shared/wire.js').MotionPacket|null} */
  let debugMotion = null;
  let lastChatTick = -1;
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
    motionChannel?.close();
    peer = null;
    channel = null;
    motionChannel = null;
    connected = false;
    latestLocalSequence = 0;
    revisions.reset();
    pendingMotion = null;
    pendingSince = 0;
    lastResync = -Infinity;
    debugState = debugMotion = null;
    resyncFailures = 0;
    lastChatTick = -1;
    scene.chatFeed = [];
    scene.mineFeed = undefined;
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
      version: PROTOCOL_VERSION,
    }, playerId).catch((error) => {
      scene.status = "Join request failed; retrying…";
      scene.telemetry?.("error", { status: "signal-failed" });
      console.error(error);
    });
  }

  function scheduleRetry() {
    if (closed || retryTimer) return;
    scene.status = "Visitor disconnected; retrying…";
    scene.telemetry?.("connection", { status: "reconnecting" });
    retryTimer = setTimeout(
      requestJoin,
      Math.max(700, retryNotBefore - performance.now()),
    );
  }

  function recover() {
    if (performance.now() - lastResync < 1000) return;
    lastResync = performance.now();
    pendingMotion = null;
    pendingSince = 0;
    if (++resyncFailures >= 3) {
      endWithError("Invalid world updates. Refresh both pages to reconnect.");
    } else send({ type: "resync" });
  }

  /** @param {string} message */
  function endWithError(message) {
    closed = true;
    connected = false;
    if (retryTimer) clearTimeout(retryTimer);
    channel?.close();
    motionChannel?.close();
    peer?.close();
    scene.status = message;
  }

  /** @param {import('../shared/wire.js').MotionPacket} value */
  function receiveMotion(value) {
    if (value.attempt !== attempt) return;
    if (harnessParams.has("harness")) debugMotion = value;
    const decision = revisions.motion(value);
    if (decision === "hold") {
      if (!pendingMotion) pendingSince = performance.now();
      if (!pendingMotion || value.tick > pendingMotion.tick) {
        pendingMotion = value;
      }
      // A reliable sight packet can still be in transit. The watchdog requests
      // recovery only when this wait exceeds one second.
      return;
    }
    if (decision === "drop" || !connected) return;
    const local = scene.world.players[playerId];
    for (const player of Object.values(value.players)) {
      if (player.id !== playerId) {
        scene.presentation.observe(player, value.tick);
      }
    }
    scene.world.players = {
      ...value.players,
      ...(local ? { [playerId]: local } : {}),
    };
  }

  /** @param {unknown} raw @param {boolean} [replaceable] */
  function receiveRaw(raw, replaceable = false) {
    const value = parsePacket(raw);
    if (replaceable) {
      const motion = decodeMotion(value);
      if (motion) receiveMotion(motion);
      return;
    }
    if (!value) {
      recover();
      return;
    }
    receiveGame(value);
  }

  /** @param {Record<string,unknown>} value */
  function receiveGame(value) {
    if (value.type === "system") {
      if (typeof value.text === "string" && value.text.length <= 120) {
        scene.systemLine?.(value.text);
      }
      return;
    }
    if (value.type === "terrain") {
      const changes = decodeTerrainChanges(value);
      if (!changes) {
        recover();
        return;
      }
      for (const change of changes) {
        const chunk = getChunk(
          scene.world,
          chunkCoord(change.x),
          chunkCoord(change.y),
        );
        if (chunk) {
          chunk[
            chunkIndex(
              localCoord(change.x),
              localCoord(change.y),
              change.z,
            )
          ] = change.material;
        }
      }
      return;
    }
    if (value.type === "mining") {
      const entries = decodeMining(value);
      if (entries) scene.mineFeed = { at: performance.now(), entries };
      return;
    }
    if (value.type === "mine-result") {
      if (typeof value.reason === "string" && value.reason.length <= 40) {
        scene.status = `Cannot mine: ${value.reason}`;
      }
      return;
    }
    if (value.type === "chat") {
      const chat = decodeChat(value);
      if (chat?.attempt === attempt && chat.tick > lastChatTick) {
        scene.chatFeed = receiveChat(scene.chatFeed, chat.chat, chat.tick);
        lastChatTick = chat.tick;
      }
      return;
    }
    if (value.type === "state") {
      const decoded = decodeState(value);
      if (!decoded || decoded.playerId !== playerId) {
        recover();
        return;
      }
      if (decoded.attempt !== attempt) return;
      if (
        channel?.readyState !== "open" || motionChannel?.readyState !== "open"
      ) return;
      const snapshot = decoded.world;
      const ordering = revisions.reliable({ ...decoded, tick: snapshot.tick });
      if (!ordering) return;
      resyncFailures = 0;
      if (harnessParams.has("harness")) {
        debugState = { ...decoded, world: encodeWorld(decoded.world) };
      }
      const visibility = decoded.mode === "entity"
        ? unpackVisibility(
          /** @type {import('../shared/visibility-wire.js').WireVisibility} */ (decoded
            .visibility),
        )
        : createVisibility();
      if (ordering.preserveMotion) {
        const incomingLocal = snapshot.players[playerId];
        const current = scene.world.players;
        const remote = ordering.sightChanged ? snapshot.players : current;
        snapshot.players = Object.fromEntries(
          Object.entries(remote).filter(([id, player]) =>
            id === playerId || decoded.mode === "master" ||
            visibility.visible.has(
              tileKey(
                centerTile((current[id] ?? player).x),
                centerTile((current[id] ?? player).y),
                (current[id] ?? player).z,
              ),
            )
          ).map(([id, player]) => [
            id,
            id === playerId ? incomingLocal : current[id] ?? player,
          ]),
        );
        snapshot.players[playerId] = incomingLocal;
      }
      if (snapshot.tick > lastChatTick) {
        scene.chatFeed = receiveChat(
          scene.chatFeed,
          decoded.chat,
          snapshot.tick,
        );
        lastChatTick = snapshot.tick;
      }
      const incomingMode = decoded.mode === "master" ? "master" : "entity";
      const modeChanged = scene.viewMode !== incomingMode;
      if (connected && !modeChanged) {
        const before = scene.world.players[playerId]
          ? renderPosition(scene.world.players[playerId], scene.world.tick)
          : null;
        const { corrected } = mergeSnapshot(
          scene.world,
          snapshot,
          decoded.acknowledgedSequence,
          latestLocalSequence,
          playerId,
        );
        const after = scene.world.players[playerId]
          ? renderPosition(scene.world.players[playerId], scene.world.tick)
          : null;
        if (corrected && before && after) {
          const gap = Math.hypot(
            before.x - after.x,
            before.y - after.y,
            before.z - after.z,
          );
          corrections.count++;
          corrections.totalGap += gap;
          corrections.maxGap = Math.max(corrections.maxGap, gap);
          scene.renderOffset = gap < 0.5
            ? {
              x: scene.renderOffset.x + before.x - after.x,
              y: scene.renderOffset.y + before.y - after.y,
              z: scene.renderOffset.z + before.z - after.z,
            }
            : { x: 0, y: 0, z: 0 };
        }
      } else {
        scene.world = snapshot;
        scene.presentation.reset();
        scene.renderOffset = { x: 0, y: 0, z: 0 };
      }
      for (
        const player of ordering.preserveMotion
          ? []
          : Object.values(snapshot.players)
      ) {
        if (player.id !== playerId) {
          scene.presentation.observe(player, snapshot.tick);
        }
      }
      scene.viewMode = incomingMode;
      scene.visibility = visibility;
      scene.localId = playerId;
      scene.status = connected ? "Visitor world" : "Connected to visitor";
      if (!connected && scene.metrics) {
        scene.metrics.joinMs = Math.round(performance.now() - attemptStarted);
      }
      if (!connected) scene.telemetry?.("connection", { status: "connected" });
      connected = true;
      if (pendingMotion) {
        const waiting = pendingMotion;
        pendingMotion = null;
        pendingSince = 0;
        receiveMotion(waiting);
      }
    }
    if (
      value.type === "pong" && decodeControl(value) &&
      typeof value.id === "string"
    ) {
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
      scene.mineFeed = undefined;
      scene.chatFeed = [];
      scene.status = "Visitor left. World ended.";
      connected = false;
      return;
    }
    if (message.kind === "incompatible") {
      const incompatible = /** @type {{attempt?:string}} */ (message.data);
      if (incompatible.attempt === attempt) {
        endWithError(
          "Different game versions. Refresh both pages to reconnect.",
        );
      }
      return;
    }
    if (message.kind !== "offer") return;
    const offer =
      /** @type {{description:RTCSessionDescriptionInit,attempt:string,version?:number}} */ (message
        .data);
    if (offer.attempt !== attempt) return;
    if (offer.version !== PROTOCOL_VERSION) {
      endWithError("Different game versions. Refresh both pages to reconnect.");
      return;
    }
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
          const incomingChannel = event.channel;
          if (incomingChannel.label === "world") channel = incomingChannel;
          else if (incomingChannel.label === "motion") {
            motionChannel = incomingChannel;
          } else {
            incomingChannel.close();
            return;
          }
          const replaceable = incomingChannel.label === "motion";
          incomingChannel.onmessage = (incoming) =>
            deliver(() => {
              if (peer !== nextPeer || closed) return;
              receiveRaw(incoming.data, replaceable);
            }, replaceable);
          incomingChannel.onclose = () => {
            if (peer !== nextPeer || closed) return;
            connected = false;
            nextPeer.close();
            scheduleRetry();
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
    if (!closed && pendingMotion && performance.now() - pendingSince > 1000) {
      recover();
    }
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
    if (
      (message.type === "move" || message.type === "input") &&
      typeof message.sequence === "number"
    ) {
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
    /** @param {unknown} value @param {boolean} [replaceable] */
    injectPacket(value, replaceable = false) {
      if (harnessParams.has("harness")) {
        receiveRaw(JSON.stringify(value), replaceable);
      }
    },
    resetDiagnostics() {
      if (harnessParams.has("harness")) {
        corrections.count = corrections.totalGap = corrections.maxGap = 0;
      }
    },
    wireDebug() {
      return harnessParams.has("harness")
        ? {
          corrections: { ...corrections },
          state: debugState,
          motion: debugMotion,
          pending: pendingMotion,
          reliable: channel?.readyState,
          motionChannel: motionChannel?.readyState,
          ordered: motionChannel?.ordered,
          maxRetransmits: motionChannel?.maxRetransmits,
        }
        : null;
    },
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
      motionChannel?.close();
      peer?.close();
    },
  };
}
