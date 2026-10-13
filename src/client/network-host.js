// @ts-check

// The host side of a session: it owns the world, validates every guest action,
// and sends each guest its view.

import { build } from "./build.js";
import { droppedEntries, droppedItems, inventoryOf } from "../shared/items.js";
import { sellItems } from "../shared/shop.js";
import { heldItem, miningEntries } from "../shared/mining.js";
import { chunkCoord, drainTileChanges } from "../shared/terrain.js";
import {
  createPendingReveal,
  drainReveal,
  markAllPending,
  revealChanges as addRevealedChanges,
  syncLoadedChunks,
} from "../shared/reveal.js";
import { itemSeen, seesFrom } from "../shared/reach.js";
import {
  createVisibility,
  tileKey,
  tileSeen,
  visibilityPosition,
} from "../shared/visibility.js";
import { entityPlayers, entityView } from "../shared/view.js";
import { createSignaling } from "./signaling.js";
import { createSnapshotSender } from "./snapshot-sender.js";
import { drainSounds, soundsFor, sourceTile } from "../shared/sound.js";
import { createStamina, setSprint } from "../shared/stamina.js";
import { chatView } from "../shared/chat.js";
import { createAttemptDeadline } from "./attempt-deadline.js";
import {
  decodeControl,
  encodeMotionPlayers,
  encodeWorld,
  parsePacket,
  PROTOCOL_VERSION,
} from "../shared/wire.js";
import { centerTile } from "../shared/locomotion.js";
import {
  deliver,
  gathered,
  ice,
  motionHz,
  selectedRoute,
  ticket,
} from "./network-common.js";
import { hostMessages } from "./host-messages.js";

/** @typedef {import('./network-common.js').Scene} Scene */
/** @typedef {import('./network-common.js').Signal} Signal */

/** The host tells the shell its session is live this often; the shell ends one after 45 s without. */
const HEARTBEAT_MS = 15_000;

/** Ticks between the host's music heartbeats: every 4 s (ADR 0009). */
const MUSIC_BEAT_TICKS = 80;

/**
 * @param {Scene} scene @param {string} session
 * @param {{running?:(id:string)=>boolean,musicPosition?:()=>{key:string,seconds:number}|null,simulation?:ReturnType<typeof import("../shared/simulation.js").createSimulation>}} [sounds] `running` says whether the host's own entity is sprinting; `musicPosition` is where the host's music is in its track
 */
export function startHost(scene, session, sounds = {}) {
  /** @type {Map<string,ReturnType<typeof createPeer>>} */
  const peers = new Map();
  let joinFailures = 0;
  const simulation = sounds.simulation;
  if (!simulation) throw new Error("Hosting requires a simulation runner");
  /** The music cue of the track playing now, sent to each guest that joins (ADR 0009). @type {import('../shared/wire.js').MusicCue|null} */
  let musicCue = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let publishTimer = null;
  let lastPublish = 0;
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

  /**
   * Adds a system line for one player only: the host's own log for the host,
   * or a `system` message to that guest.
   * @param {string} id @param {string} text
   */
  function tell(id, text) {
    if (id === scene.localId) scene.systemLine?.(text);
    else peers.get(id)?.system(text);
  }

  /**
   * The host's check of a sale to a shop placed by the world recipe. A guest names an item kind and a count, or all.
   * @param {string} id @param {unknown} request
   */
  function sellAt(id, request) {
    return sellItems(scene.world, id, request);
  }

  function publish() {
    if (publishTimer) return;
    publishTimer = setTimeout(
      flushPublish,
      Math.max(0, 100 - (performance.now() - lastPublish)),
    );
  }

  function tick() {
    const changes = drainTileChanges(scene.world);
    if (changes.length) {
      // Force the host's own sight to see through a mined tile.
      scene.visibility.sample = "";
      for (const connection of peers.values()) connection.reveal(changes);
    }
    for (const connection of peers.values()) connection.tick();
    if (musicCue && peers.size && scene.world.tick % MUSIC_BEAT_TICKS === 0) {
      const position = sounds.musicPosition?.();
      if (position && position.key === musicCue.key) {
        const beat = {
          ...musicCue,
          atTick: scene.world.tick,
          position: Math.round(position.seconds * 1000) / 1000,
        };
        for (const connection of peers.values()) connection.music(beat);
      }
    }
    const events = drainSounds(scene.world);
    if (!events.length) return;
    for (const connection of peers.values()) connection.hear(events);
    const own = scene.localId;
    if (scene.hearSounds && scene.world.players[own]) {
      const heard = soundsFor(scene.world, events, own, (event) => {
        if (scene.viewMode === "master") return true;
        const tile = sourceTile(scene.world, event);
        return scene.visibility.visible.has(tileKey(tile.x, tile.y, tile.z));
      });
      if (heard.length) scene.hearSounds(heard);
    }
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
    /** What this peer was last told about dropped items and its inventory. */
    let lastItems = "";
    let lastInventory = "";
    /** The held item this peer was last told about. */
    let lastHeld = "";
    /** The host tracks stamina, so a guest cannot sprint without it. */
    let stamina = createStamina();
    /** @type {ReturnType<typeof setTimeout>|null} */
    let departureTimer = null;
    /** @type {import('../shared/world.js').Player|null} */
    let rememberedPlayer = null;
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
    /** What a master view guest holds: the loaded chunks near its player. */
    /** @type {Map<string,import('../shared/terrain.js').ChunkData>} */
    const masterTerrain = new Map();
    /** Tiles of the guest's copy it has not been sent yet. */
    const pendingReveal = createPendingReveal();
    /** @type {"entity"|"master"} */
    let mode = "entity";
    /** The terrain the guest's copy holds in the current view mode. */
    const guestTerrain = () =>
      mode === "master" ? masterTerrain : rememberedTerrain;
    /** The guest starts its copy over; send it everything held for this view mode again. */
    function resendTerrain() {
      masterTerrain.clear();
      markAllPending(pendingReveal, guestTerrain());
    }
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
      simulation.leave(playerId);
      joined = false;
      if (established || !departedAt) departedAt = performance.now();
      scene.status = "A visitor left your world";
      if (established) announce(`${established.name || "A visitor"} left`);
      publish();
    }

    /** @type {import('./host-messages.js').HostPeer} */
    const hostPeer = {
      scene,
      playerId,
      get lastSequence() {
        return lastSequence;
      },
      get mode() {
        return mode;
      },
      sees: () => sees(),
      tell,
      announce,
      sellAt,
      reply(message) {
        if (channel?.readyState === "open") {
          channel.send(JSON.stringify(message));
        }
      },
      channel: () => channel,
      resync() {
        resendTerrain();
        publishToPeer();
      },
      setInput(dx, dy, sequence, sprint) {
        lastSequence = sequence;
        setSprint(stamina, sprint);
        sounds.simulation?.enqueue(playerId, {
          type: "input",
          dx,
          dy,
          sequence,
          sprint,
        });
      },
      queueMove(move) {
        simulation.enqueue(
          playerId,
          { type: "move", ...move },
          (/** @type {Record<string,unknown>} */ result) => {
            if (typeof result.sequence === "number") {
              lastSequence = result.sequence;
            }
            publish();
          },
        );
      },
      cancelMoves(sequence) {
        lastSequence = sequence;
        simulation.enqueue(playerId, { type: "cancel", sequence });
        publish();
      },
      setMode(next) {
        mode = next;
        if (sounds.simulation) {
          sounds.simulation.state(playerId).master = next === "master";
        }
        resendTerrain();
        viewRevision++;
        sightRevision = 0;
        lastSight = "";
      },
      publishToPeer,
    };

    /** @param {Record<string,unknown>} message */
    function handleMessage(message) {
      lastSeen = performance.now();
      if (!scene.world.players[playerId]) return;
      if (
        sounds.simulation &&
        [
          "mine",
          "mine-cancel",
          "place",
          "hold",
          "pickup",
          "sell",
          "message",
          "typing",
          "nick",
        ].includes(String(message.type))
      ) {
        const before = scene.world.players[playerId]?.name ?? "";
        sounds.simulation.enqueue(
          playerId,
          message,
          (/** @type {Record<string,unknown>} */ result) => {
            if (!scene.world.players[playerId]) return;
            if (message.type === "nick") {
              if (result.ok && result.name !== before) {
                announce(`${before || "A visitor"} is now ${result.name}`);
              }
              hostPeer.reply({ type: "nick-result", result });
            } else if (result.ok && typeof result.line === "string") {
              tell(playerId, result.line);
            } else if (
              !result.ok &&
              ["mine", "place", "pickup", "sell"].includes(String(message.type))
            ) {
              hostPeer.reply({
                type: `${message.type}-result`,
                reason: result.reason,
              });
            }
            publish();
          },
        );
        return;
      }
      const handler = typeof message.type === "string"
        ? hostMessages.get(message.type)
        : undefined;
      if (handler?.(hostPeer, message)) return;
      publish();
    }

    /** @param {{relay?:boolean,token?:string,attempt?:string,version?:number}} request */
    async function acceptJoin(request) {
      const token = typeof request.token === "string" ? request.token : "";
      const attempt = typeof request.attempt === "string"
        ? request.attempt
        : "";
      if (request.version !== PROTOCOL_VERSION) {
        await signaling.send(playerId, "incompatible", {
          attempt,
          version: PROTOCOL_VERSION,
        });
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
      lastMining =
        lastItems =
        lastInventory =
        lastHeld =
          "";
      stamina = createStamina();
      viewRevision = sightRevision = 0;
      lastSight = "";
      resendTerrain();
      try {
        const iceServers = await ice(session);
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
            ? {
              world: { tick: scene.world.tick, players: scene.world.players },
              visibility: null,
            }
            : entityView(
              scene.world,
              playerId,
              sight,
              rememberedTerrain,
              pendingReveal,
            );
          const player = scene.world.players[playerId];
          if (mode === "master" && player) {
            syncLoadedChunks(
              scene.world,
              masterTerrain,
              pendingReveal,
              chunkCoord(centerTile(player.x)),
              chunkCoord(centerTile(player.y)),
            );
          }
          // Drain here, not earlier: the sender may coalesce publishes.
          const reveal = drainReveal(guestTerrain(), pendingReveal);
          timing.filterMs += performance.now() - began;
          // The rest follows when the channel has room.
          if (pendingReveal.size) setTimeout(publishToPeer, 0);
          return {
            type: "state",
            ...stamp(),
            ...view,
            reveal,
            world: encodeWorld({
              ...view.world,
              shops: scene.world.shops,
              limits: scene.world.limits,
            }),
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
            : entityPlayers(
              scene.world,
              playerId,
              sight,
              rememberedTerrain,
              pendingReveal,
            );
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
          } else simulation.join(playerId);
          announce(
            `${scene.world.players[playerId]?.name || "A visitor"} ${
              rejoined ? "rejoined" : "joined"
            }`,
            playerId,
          );
          rememberedPlayer = null;
          if (musicCue) sendMusic(musicCue);
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
          await signaling.send(playerId, "offer", {
            description: nextPeer.localDescription,
            attempt,
            version: PROTOCOL_VERSION,
          });
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

    /** This peer's current sight, as the reach checks take it: its visible set, or everything in a master view. */
    function sees() {
      return seesFrom(sight.visible, mode === "master");
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
     * Tell the peer which dropped items lie on tiles it can see, and its own
     * inventory, when either changes. No other peer's inventory is sent.
     */
    function sendItems() {
      if (!joined || channel?.readyState !== "open") return;
      const player = scene.world.players[playerId];
      if (!player) return;
      const entries = droppedItems(scene.world).tiles.size
        ? droppedEntries(scene.world).filter((entry) =>
          mode === "master" || itemSeen(sight.visible, entry)
        )
        : [];
      const items = JSON.stringify(entries);
      if (items !== lastItems) {
        lastItems = items;
        channel.send(`{"type":"items","entries":${items}}`);
      }
      const stacks = JSON.stringify(inventoryOf(player));
      if (stacks !== lastInventory) {
        lastInventory = stacks;
        channel.send(`{"type":"inventory","stacks":${stacks}}`);
      }
      const held = heldItem(player);
      if (held !== lastHeld) {
        lastHeld = held;
        channel.send(JSON.stringify({ type: "held", kind: held }));
      }
    }

    /**
     * Add the changed tiles this peer can see to its pending reveal and publish
     * at once. Remembered terrain follows only what the peer sees; a tile out of
     * sight keeps its last observed state.
     * @param {import('../shared/terrain.js').TileChange[]} changes
     */
    function revealChanges(changes) {
      if (
        !joined || channel?.readyState !== "open" ||
        !scene.world.players[playerId]
      ) return;
      const revealed = addRevealedChanges({
        mode,
        sight,
        remembered: rememberedTerrain,
        master: masterTerrain,
        pending: pendingReveal,
      }, changes);
      if (!revealed) return;
      // Sight may now pass through the tile; the next snapshot recomputes it.
      if (mode === "entity") sight.sample = "";
      publishToPeer();
    }

    /** Tell the peer the sound events in its range, as the host's own player hears them. @param {import('../shared/sound.js').SoundEvent[]} events */
    function hear(events) {
      if (!joined || channel?.readyState !== "open") return;
      const list = soundsFor(scene.world, events, playerId, (event) => {
        if (mode === "master") return true;
        const tile = sourceTile(scene.world, event);
        return sight.visible.has(tileKey(tile.x, tile.y, tile.z));
      });
      if (list.length) channel.send(JSON.stringify({ type: "sounds", list }));
    }

    /** @param {import('../shared/wire.js').MusicCue} cue */
    function sendMusic(cue) {
      if (!joined || channel?.readyState !== "open") return;
      channel.send(JSON.stringify({ type: "music", ...cue }));
    }

    function tickPeer() {
      sendMining();
      sendItems();
      stamina = simulation.state(playerId).stamina;
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
        const originSeen = tileSeen(sight.visible, move.origin);
        const targetSeen = tileSeen(sight.visible, move.target);
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
      hear,
      music: sendMusic,
      sprinting: () => stamina.sprint,
      reveal: revealChanges,
      sees,
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
          rememberedChunks: guestTerrain().size,
          channels: {
            reliable: channel?.readyState,
            motion: motionChannel?.readyState,
          },
          bufferedAmount: channel?.bufferedAmount ?? 0,
        };
      },
    };
  }

  /** @param {Signal} message */
  const receiveSignal = (message) => {
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
        void signaling.send(playerId, "incompatible", {
          attempt: request.attempt,
          version: PROTOCOL_VERSION,
        }).catch(console.error);
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
  };
  let hostKey = "";
  const signaling = createSignaling({
    self: "host",
    receive: receiveSignal,
    credentials: async () => {
      const result = await ticket("sessions", {
        id: session,
        hostKey,
        ...build.identity,
      });
      hostKey = result.hostKey ?? hostKey;
      return result;
    },
  });
  /** Tell the shell this session is live, with its build and player count. The host key proves it. */
  const heartbeat = () => {
    if (!hostKey || ended) return;
    // The URL uses the shell-configured API origin. Session IDs affect only its path.
    // fallow-ignore-next-line security-sink
    void fetch(build.apiUrl(`sessions/${session}/heartbeat`), {
      method: "POST",
      headers: { "content-type": "application/json", "x-host-key": hostKey },
      body: JSON.stringify({
        players: Object.keys(scene.world.players).filter((id) =>
          !id.startsWith("npc-")
        ).length,
        ...build.identity,
      }),
    }).catch(() => {});
  };
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
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
  let ended = false;
  /** Tell each guest the host left, then delete the session channel. */
  function endSession() {
    if (ended) return;
    ended = true;
    for (const playerId of peers.keys()) {
      void signaling.send(playerId, "leave", {}).catch(() => {});
    }
    // The URL uses the shell-configured API origin. Session IDs affect only its path.
    // fallow-ignore-next-line security-sink
    void fetch(build.apiUrl("sessions/" + session), {
      method: "DELETE",
      headers: { "x-host-key": hostKey },
      keepalive: true,
    }).catch(() => {});
  }
  globalThis.addEventListener("pagehide", endSession, { once: true });
  return {
    publish,
    announce,
    tell,
    tick,
    /**
     * The conductor started a track: tell every guest, and each guest that joins.
     * @param {{key:string,hash:string}} track
     */
    cue(track) {
      musicCue = {
        key: track.key,
        hash: track.hash,
        startTick: scene.world.tick,
      };
      for (const connection of peers.values()) connection.music(musicCue);
    },
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
      endSession();
      signaling.close();
      for (const connection of peers.values()) connection.close();
    },
  };
}
