// @ts-check

// The guest side of a session: it sends intents and draws what the host sends.

import { createWorld } from "../shared/world.js";
import { build } from "./build.js";
import { applyReveal } from "../shared/reveal.js";
import { mergeSnapshot } from "../shared/reconcile.js";
import { renderPosition, TICK_MS } from "../shared/world.js";
import { createVisibility, tileKey } from "../shared/visibility.js";
import { createSignaling } from "./signaling.js";
import { unpackVisibility } from "../shared/visibility-wire.js";
import { encodeChunks } from "../shared/chunk-wire.js";
import { receiveChat } from "../shared/chat.js";
import { createRevisionOrder } from "./revision-order.js";
import {
  decodeChat,
  decodeControl,
  decodeHeld,
  decodeInventory,
  decodeItems,
  decodeMining,
  decodeMotion,
  decodeMusicCue,
  decodeSounds,
  decodeState,
  encodeWorld,
  parsePacket,
  PROTOCOL_VERSION,
} from "../shared/wire.js";
import { centerTile } from "../shared/locomotion.js";
import {
  deliver,
  gathered,
  harnessParams,
  ice,
  selectedRoute,
  ticket,
} from "./network-common.js";

/** @typedef {import('./network-common.js').Scene} Scene */
/** @typedef {import('./network-common.js').World} World */
/** @typedef {import('./network-common.js').Signal} Signal */

/** The host's refusal messages and how each one reads as a notice: the longest accepted reason and the text before it. */
const RESULT_NOTICES = new Map([
  ["pickup-result", { max: 40, prefix: "Cannot pick up: " }],
  ["sell-result", { max: 60, prefix: "Cannot sell: " }],
  ["place-result", { max: 40, prefix: "" }],
  ["mine-result", { max: 40, prefix: "Cannot mine: " }],
]);

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
  /** The view mode the guest's copy of the terrain belongs to; a change starts the copy over. */
  /** @type {"entity"|"master"|null} */
  let copyMode = null;
  const revisions = createRevisionOrder();
  /** @type {import('../shared/wire.js').MotionPacket|null} */
  let pendingMotion = null;
  let pendingSince = 0;
  let resyncFailures = 0;
  const corrections = { count: 0, totalGap: 0, maxGap: 0 };
  let lastResync = -Infinity;
  /** The last state as sent: reveal chunks are run-length strings. */
  /** @type {(Omit<import('../shared/wire.js').StatePacket,'world'|'reveal'> & {world:ReturnType<typeof encodeWorld>,reveal:Record<string,string>})|null} */
  let debugState = null;
  /** @type {import('../shared/wire.js').MotionPacket|null} */
  let debugMotion = null;
  let lastChatTick = -1;
  /** The latest music cue, held until the first state sets the tick clock. @type {import('../shared/wire.js').MusicCue|null} */
  let pendingCue = null;
  /**
   * Hand the host's music cue to the player, at the offset the host is in the
   * track now. A heartbeat names the host's own position on a tick; a plain cue
   * counts from the start tick. Both use the host's clock with no presentation
   * delay, so the guest hears what the host hears.
   */
  function followCue() {
    const cue = pendingCue;
    pendingCue = null;
    if (!cue || !scene.followMusic) return;
    const tick = cue.atTick ?? cue.startTick;
    const base = cue.position ?? 0;
    const at = scene.presentation.clockOfTick(tick);
    const seconds = base +
      (at === null
        ? (scene.world.tick - tick) * TICK_MS / 1000
        : (performance.now() - at) / 1000);
    scene.followMusic(cue, Math.max(0, seconds));
  }
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
    copyMode = null;
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
    scene.itemFeed = scene.inventoryFeed = scene.heldFeed = undefined;
    attempt = crypto.randomUUID();
    attemptStarted = performance.now();
    lastPong = attemptStarted;
    if (scene.metrics) {
      scene.metrics.route = "connecting";
      scene.metrics.rttMs = [];
    }
    scene.status = "Reconnecting to visitor…";
    void signaling.send("host", "join", {
      playerId,
      relay: forceRelay,
      token,
      attempt,
      version: PROTOCOL_VERSION,
    }).catch((error) => {
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

  /** A full-state packet: reveal, ordering, merge and the first-join steps. @param {Record<string,unknown>} value */
  function receiveState(value) {
    const decoded = decodeState(value);
    if (!decoded || decoded.playerId !== playerId) {
      recover();
      return;
    }
    if (decoded.attempt !== attempt) return;
    if (
      channel?.readyState !== "open" || motionChannel?.readyState !== "open"
    ) return;
    // Apply the reveal first: the host drained it when it built this packet,
    // so it must land even if the revision order drops the rest.
    if (copyMode !== decoded.mode) {
      scene.world.chunks = new Map();
      copyMode = decoded.mode;
    }
    applyReveal(scene.world, decoded.reveal);
    const snapshot = { ...decoded.world, chunks: scene.world.chunks };
    const ordering = revisions.reliable({ ...decoded, tick: snapshot.tick });
    if (!ordering) return;
    resyncFailures = 0;
    if (harnessParams.has("harness")) {
      debugState = {
        ...decoded,
        world: encodeWorld(decoded.world),
        reveal: encodeChunks(decoded.reveal),
      };
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
    scene.world.shops = snapshot.shops ?? [];
    scene.world.limits = snapshot.limits;
    scene.viewMode = incomingMode;
    scene.visibility = visibility;
    scene.localId = playerId;
    scene.status = connected ? "Visitor world" : "Connected to visitor";
    if (!connected && scene.metrics) {
      scene.metrics.joinMs = Math.round(performance.now() - attemptStarted);
    }
    if (!connected) scene.telemetry?.("connection", { status: "connected" });
    connected = true;
    if (pendingCue) followCue();
    if (pendingMotion) {
      const waiting = pendingMotion;
      pendingMotion = null;
      pendingSince = 0;
      receiveMotion(waiting);
    }
  }

  /** @param {Record<string,unknown>} value */
  function receiveGame(value) {
    if (value.type === "system") {
      if (typeof value.text === "string" && value.text.length <= 120) {
        scene.systemLine?.(value.text);
      }
      return;
    }
    if (value.type === "mining") {
      const entries = decodeMining(value);
      if (entries) scene.mineFeed = { at: performance.now(), entries };
      return;
    }
    if (value.type === "sounds") {
      const list = decodeSounds(value);
      if (list) scene.hearSounds?.(list);
      return;
    }
    if (value.type === "music") {
      const cue = decodeMusicCue(value);
      if (cue) {
        pendingCue = cue;
        if (connected) followCue();
      }
      return;
    }
    if (value.type === "items") {
      const entries = decodeItems(value);
      if (entries) scene.itemFeed = entries;
      return;
    }
    if (value.type === "inventory") {
      const stacks = decodeInventory(value);
      if (stacks) scene.inventoryFeed = stacks;
      return;
    }
    if (value.type === "held") {
      const kind = decodeHeld(value);
      if (kind) scene.heldFeed = kind;
      return;
    }
    const notice = RESULT_NOTICES.get(String(value.type));
    if (notice) {
      if (
        typeof value.reason === "string" && value.reason.length <= notice.max
      ) {
        scene.notice = {
          text: notice.prefix + value.reason,
          until: performance.now() + 2500,
        };
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
      receiveState(value);
      return;
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

  /** @param {Signal} message */
  const receiveSignal = (message) => {
    if (message.kind === "leave") {
      scene.world = createWorld();
      scene.mineFeed = undefined;
      scene.itemFeed = scene.inventoryFeed = scene.heldFeed = undefined;
      scene.chatFeed = [];
      // The host deleted the session: stop the retries and the watchdog's
      // rejoin, which would otherwise replace this status.
      endWithError("Visitor left. World ended.");
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
          iceServers: await ice(session),
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
          await signaling.send("host", "answer", {
            playerId,
            description: nextPeer.localDescription,
            attempt,
          });
        }
      } catch (error) {
        scene.status = "Join failed";
        console.error(error);
        scheduleRetry();
      }
    })();
  };
  const signaling = createSignaling({
    self: playerId,
    receive: receiveSignal,
    // A join sent before the host connected was dropped; ask again.
    onPeer: (peer) => {
      if (peer === "host" && !connected) requestJoin();
    },
    credentials: async () => {
      const result = await ticket(`sessions/${session}/join`, {
        peer: playerId,
      }).catch((error) => {
        // The host's leave signal can lose the race with the session's end, so
        // the shell refusing a join because the session ended ends it too.
        if (
          /** @type {{reason?:string}} */ (error).reason === "session ended"
        ) {
          endWithError("Visitor left. World ended.");
          signaling.close();
        }
        throw error;
      });
      // The host runs another build: join on that one, so both run the same client.
      const target = build.joinRedirect(
        result.build,
        session,
        location.origin,
        location.search,
      );
      if (target) {
        scene.status = "Opening the host's build…";
        // joinRedirect validates the build path and constructs the target on location.origin.
        // fallow-ignore-next-line security-sink
        location.replace(target);
        throw new Error("Joining on the host's build");
      }
      return result;
    },
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
    /** Test hook: lose the signaling socket as a network failure would. */
    dropSignaling() {
      signaling.drop();
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
      signaling.close();
      channel?.close();
      motionChannel?.close();
      peer?.close();
    },
  };
}
