// @ts-check

/**
 * The test hooks. With `?harness=1` the page exposes `globalThis.__od`, which
 * the e2e specs use to read the scene, tap UI elements, and send guest
 * messages. Nothing in the game reads it.
 */

import {
  renderPosition,
  startMove,
  TICK_MS,
  Z_LEVELS_BELOW,
} from "../shared/world.js";
import { entityOpacity, tileVisibility } from "../shared/visibility.js";
import { playerOccluded } from "../shared/surface.js";
import { viewMotionOpacity } from "../shared/view.js";
import { openChat } from "./chat-input.js";
import { joinSession } from "./session.js";
import { currentLayout } from "./ui-view.js";

/** @typedef {import('./context.js').Context} Context */

/** Expose `globalThis.__od` when the page loads with `?harness`. @param {Context} ctx */
export function exposeHarness(ctx) {
  if (!new URL(location.href).searchParams.has("harness")) return;
  const { scene, ui, frameMs } = ctx;
  /** @type {{__od?:unknown}} */ (globalThis).__od = {
    scene,
    /** Chatter that started (ADR 0006), so specs can check it without listening. */
    chatter: {
      log: ctx.chatter.log,
      level: () => ctx.chatter.level,
    },
    /** The music player's state and a few hooks (ADR 0007). */
    music: {
      state: () => ctx.music.state(),
      /** @param {string[]} tags */
      setMood: (tags) => ctx.music.setMood(tags),
      /** @param {() => number} source */
      setRandom: (source) => ctx.music.setRandom(source),
    },
    /** The effects player's state, plays and a fixed pick (ADR 0008). */
    sfx: {
      state: () => ctx.sfx.state(),
      log: ctx.sfx.log,
      /** @param {() => number} source */
      setRandom: (source) => ctx.sfx.setRandom(source),
    },
    /** @param {string} [prefill] */
    openChat: (prefill) => openChat(ctx, prefill),
    stamina: ctx.stamina,
    /** @param {string} id */
    join: (id) => joinSession(ctx, id),
    /** The UI layer's current layout, for specs that tap elements. */
    ui: {
      layout: () => currentLayout(ctx),
      /** @param {string} id */
      rect: (id) => currentLayout(ctx).byId.get(id)?.rect ?? null,
      ids: () => [...currentLayout(ctx).byId.keys()],
      state: ui,
      qrUrl: () => ui.qrUrl,
    },
    /** @param {Record<string,unknown>} message */
    send: (message) => ctx.guest?.send(message) ?? false,
    hostStats: () => ctx.host?.diagnostics() ?? null,
    wireDebug: () => ctx.guest?.wireDebug() ?? null,
    dropSignaling: () => ctx.guest?.dropSignaling(),
    resetNetworkStats: () => ctx.guest?.resetDiagnostics(),
    /** @param {unknown} value @param {boolean} [replaceable] */
    injectPacket: (value, replaceable = false) =>
      ctx.guest?.injectPacket(value, replaceable),
    frameStats: () => ({
      samples: frameMs.length,
      meanMs: frameMs.length
        ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
        : 0,
      maxMs: Math.max(0, ...frameMs),
    }),
    /** @param {number} dx @param {number} dy */
    startMove: (dx, dy) =>
      startMove(scene.world, scene.localId, dx, dy, ++ctx.sequence),
    /** @param {string} id */
    visualPosition: (id) => {
      const player = scene.world.players[id];
      if (!player) return null;
      const tick = scene.world.tick + ctx.accumulator / TICK_MS;
      const pos = scene.presentation.positionAt(
        player,
        tick,
        id === scene.localId,
      );
      return { tick, ...pos };
    },
    /** @param {string} id */
    visualSample: (id) => {
      const player = scene.world.players[id];
      if (!player) return null;
      const tick = scene.world.tick + ctx.accumulator / TICK_MS;
      const position = scene.presentation.positionAt(
        player,
        tick,
        id === scene.localId,
      );
      let opacity = scene.viewMode === "master"
        ? 1
        : player.viewMotion
        ? viewMotionOpacity(player.viewMotion, tick)
        : entityOpacity(player, tick, (x, y, z) =>
          tileVisibility(scene.visibility, x, y, z) === "visible", position);
      if (
        playerOccluded(scene.world, player, scene.viewZ) ||
        player.z < scene.viewZ - Z_LEVELS_BELOW
      ) opacity = 0;
      return {
        tick,
        ...position,
        opacity,
        typing: player.typing,
        hasMessage: Boolean(player.message),
        moveSequence: player.move?.sequence ?? null,
        sight: scene.visibility.sample,
      };
    },
    /** @param {string} id */
    authoritativePosition: (id) => {
      const player = scene.world.players[id];
      return player
        ? renderPosition(player, scene.world.tick + ctx.accumulator / TICK_MS)
        : null;
    },
    /** @param {string} id */
    authoritativeSample: (id) => {
      const player = scene.world.players[id];
      const tick = scene.world.tick + ctx.accumulator / TICK_MS;
      return player
        ? {
          ...renderPosition(player, tick),
          tick,
          motion: player.move
            ? {
              startPosition: player.move.startPosition,
              target: player.move.target,
              startTick: player.move.startTick,
              durationTicks: player.move.durationTicks,
            }
            : null,
          moveSequence: player.move?.sequence ?? null,
          typing: player.typing,
          hasMessage: Boolean(player.message),
        }
        : null;
    },
  };
}
