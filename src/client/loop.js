// @ts-check

/**
 * The frame loop and the camera. Each frame it polls the gamepad, runs the
 * fixed world ticks (the host tick, the local move, the NPC, terrain
 * generation), steers the zoom, aim, and camera, derives what the renderer
 * draws, lays out the UI, and renders. `ctx.accumulator` holds the time not yet
 * spent on ticks; the renderer and the harness read it to interpolate.
 */

import {
  advanceTicks,
  renderPosition,
  TICK_MS,
  WORLD_TOP,
} from "../shared/world.js";
import {
  recomputeVisibility,
  visibilityPosition,
} from "../shared/visibility.js";
import {
  clampCameraAxis,
  masterPanStep,
  masterViewTiles,
} from "../shared/surface.js";
import { terrainExtent } from "../shared/terrain.js";
import { chatView, receiveChat } from "../shared/chat.js";
import { hearChat } from "../shared/hearing-log.js";
import {
  centerTile,
  moveEntity,
  speedTilesPerSecond,
} from "../shared/locomotion.js";
import { stepStamina } from "../shared/stamina.js";
import { isPickupGridOpen } from "./pickup-grid.js";
import { clamp } from "./context.js";
import {
  heldDisplay,
  inventoryDisplay,
  itemsDisplay,
  miningDisplay,
} from "./display.js";
import {
  cameraInput,
  inputDirection,
  panelLookInput,
  shopDirection,
  stickDirection,
} from "./input-values.js";
import { updatePickupGrid } from "./panels.js";
import { playPanelSounds } from "./ui-sounds.js";
import { currentLayout } from "./ui-view.js";
import { catchUpMs, createTickClock } from "./tick-clock.js";

/** @typedef {import('./client-context.js').Context} Context */

/** @param {Context} ctx @param {string} id */
function speakerName(ctx, id) {
  const name = ctx.scene.world.players[id]?.name;
  if (id === ctx.scene.localId) return name || "You";
  return name || "Visitor";
}

/** @param {Context} ctx @param {{x:number,y:number}} direction @param {boolean} changed */
function sendDirection(ctx, direction, changed) {
  const { scene, stamina } = ctx;
  if (ctx.isAdmin && (changed || scene.world.tick - ctx.lastInputSent >= 4)) {
    if (changed) ctx.sequence++;
    ctx.guest?.send({
      type: "input",
      dx: direction.x,
      dy: direction.y,
      sequence: ctx.sequence,
      sprint: stamina.sprint,
    });
    ctx.lastInputSent = scene.world.tick;
  }
}

/** @param {import('../shared/world.js').Player} player @param {import('../shared/world.js').Tile|null} before */
function movedTile(player, before) {
  return !!player.move || before?.x !== centerTile(player.x) ||
    before.y !== centerTile(player.y) || before.z !== player.z;
}

/** One world tick of the local player's movement: send the input if a guest, then move. @param {Context} ctx */
function move(ctx) {
  const { scene, stamina } = ctx;
  const direction = scene.chatOpen ? { x: 0, y: 0 } : inputDirection(ctx);
  ctx.pressed.clear();
  const changed = direction.x !== ctx.lastInputDirection.x ||
    direction.y !== ctx.lastInputDirection.y;
  ctx.lastInputDirection = direction;
  const speed = speedTilesPerSecond(stamina.sprint);
  sendDirection(ctx, direction, changed);
  const player = scene.world.players[scene.localId];
  const before = player
    ? { x: centerTile(player.x), y: centerTile(player.y), z: player.z }
    : null;
  const moved = moveEntity(
    scene.world,
    scene.localId,
    direction.x,
    direction.y,
    speed,
  );
  ctx.sounds.ownSteps(stamina.sprint);
  stepStamina(stamina);
  if (
    !ctx.isAdmin && moved && player &&
    movedTile(player, before)
  ) {
    ctx.host?.publish();
  }
}

/** Per-context pacing state: the time of the last step. */
const stepState = new WeakMap();

/** @param {Context} ctx */
function stepStateOf(ctx) {
  let state = stepState.get(ctx);
  if (!state) {
    state = { last: performance.now() };
    stepState.set(ctx, state);
  }
  return state;
}

/** @param {Context} ctx @param {NonNullable<Context['simulation']>} simulation */
function simulationStep(ctx, simulation) {
  const { scene, canvas } = ctx;
  const direction = scene.chatOpen ? { x: 0, y: 0 } : inputDirection(ctx);
  ctx.pressed.clear();
  simulation.input(scene.localId, direction, ctx.stamina.sprint);
  const view = scene.viewMode === "master" && canvas.clientWidth > 0
    ? masterViewTiles(
      scene.camera,
      canvas.clientWidth,
      canvas.clientHeight,
      scene.zoom,
    )
    : null;
  simulation.interest(view ? [view] : []);
  simulation.state(scene.localId).master = scene.viewMode === "master";
  const local = scene.world.players[scene.localId];
  const before = local
    ? { x: centerTile(local.x), y: centerTile(local.y), z: local.z }
    : null;
  simulation.advanceTicks();
  ctx.sounds.ownSteps(ctx.stamina.sprint);
  ctx.host?.tick();
  if (
    local && before &&
    movedTile(local, before)
  ) ctx.host?.publish();
}

/**
 * Run the fixed world ticks that are due at `now`: the host tick, the local
 * move, the NPC, terrain generation, and the chunk unloader. The frame calls
 * this before it draws; the background clock calls it while the tab is hidden.
 * A visible step spends at most 250 ms on ticks, a hidden one at most 2 s.
 * @param {Context} ctx
 * @param {number} now
 */
function stepWorld(ctx, now) {
  const { scene } = ctx;
  const state = stepStateOf(ctx);
  ctx.accumulator += catchUpMs(now - state.last, document.hidden);
  state.last = now;
  while (ctx.accumulator >= TICK_MS) {
    if (ctx.simulation) simulationStep(ctx, ctx.simulation);
    else {
      advanceTicks(scene.world);
      move(ctx);
    }
    if (!ctx.isAdmin) {
      for (const player of Object.values(scene.world.players)) {
        scene.presentation.observe(player, scene.world.tick);
      }
    }
    ctx.accumulator -= TICK_MS;
  }
}

/** @param {Context} ctx @param {import('../shared/world.js').Player|undefined} local */
function localVisibility(ctx, local) {
  const { scene, frameStats } = ctx;
  if (local) {
    if (!ctx.isAdmin && scene.viewMode === "entity") {
      frameStats.mark("visibility");
      recomputeVisibility(
        scene.world,
        scene.visibility,
        visibilityPosition(
          local,
          scene.world.tick + ctx.accumulator / TICK_MS,
        ),
      );
      frameStats.end();
    }
    if (local.z !== ctx.lastPlayerZ) {
      ctx.lastPlayerZ = local.z;
      scene.viewZ = clamp(local.z, 0, WORLD_TOP);
      scene.hudUntil = performance.now() + 500;
    }
  }
}

/** @param {Context} ctx @param {number} dt */
function steerZoom(ctx, dt) {
  const { scene } = ctx;
  if (!scene.chatOpen && !scene.menu) {
    const zoomDirection = Number(ctx.held.has("KeyN")) -
      Number(ctx.held.has("KeyU")) + ctx.gamepadZoom;
    if (zoomDirection) {
      scene.zoomTarget = clamp(
        scene.zoomTarget * Math.exp(zoomDirection * dt * 0.001),
        0.25,
        2,
      );
      scene.hudUntil = performance.now() + 500;
    }
  }
  scene.zoom += (scene.zoomTarget - scene.zoom) * (1 - Math.exp(-dt * 0.012));
  const correctionDecay = Math.exp(-dt / 140);
  scene.renderOffset.x *= correctionDecay;
  scene.renderOffset.y *= correctionDecay;
  scene.renderOffset.z *= correctionDecay;
}

/** @param {Context} ctx @param {import('../shared/world.js').Player|undefined} local @param {number} now @param {number} dt */
function steerCamera(ctx, local, now, dt) {
  const { scene, bag, canvas } = ctx;
  const look = cameraInput(ctx);
  // The look control steers the open inventory panel, not the aim or camera.
  const panelLook = panelLookInput(ctx);
  bag.steer(stickDirection(panelLook.x, panelLook.y, 0.18), now);
  const { x: cameraX, y: cameraY } = bag.isOpen ? { x: 0, y: 0 } : look;
  if (scene.viewMode === "master") {
    scene.camera.x += masterPanStep(cameraX, dt, scene.zoom);
    scene.camera.y += masterPanStep(cameraY, dt, scene.zoom);
  } else {
    // While the pickup grid is open the look control moves its selector.
    scene.aim = isPickupGridOpen(ctx.pickupGrid)
      ? { x: 0, y: 0 }
      : stickDirection(cameraX, cameraY, 0.18);
    const pos = local
      ? renderPosition(local, scene.world.tick + ctx.accumulator / TICK_MS)
      : { x: 7, y: 7, z: 0 };
    const targetX = (pos.x + scene.renderOffset.x + 0.5) * 64;
    const targetY = (pos.y + scene.renderOffset.y + 0.5) * 64;
    scene.camera.x = targetX;
    scene.camera.y = targetY;
  }
  if (scene.viewMode === "master") {
    const zoom = scene.zoom;
    const extent = terrainExtent(scene.world);
    scene.camera.x = clampCameraAxis(
      scene.camera.x,
      canvas.clientWidth,
      zoom,
      extent.maxX,
      extent.minX,
    );
    scene.camera.y = clampCameraAxis(
      scene.camera.y,
      canvas.clientHeight,
      zoom,
      extent.maxY,
      extent.minY,
    );
  }
}

/** @param {Context} ctx @param {number} now */
function updateChat(ctx, now) {
  const { scene } = ctx;
  if (!ctx.isAdmin) {
    scene.chatFeed = receiveChat(
      scene.chatFeed,
      chatView(scene.world, scene.localId, ctx.localChatBands),
      scene.world.tick,
    );
  }
  hearChat(scene.hearingLog, scene.chatFeed, (id) => speakerName(ctx, id));
  ctx.chatter.update(
    scene.chatFeed,
    scene.localId,
    scene.world.players[scene.localId],
    now,
  );
}

/** @param {Context} ctx @param {number} now */
function updateDisplay(ctx, now) {
  const { scene, bag, shop, frameStats } = ctx;
  frameStats.mark("display");
  scene.mining = miningDisplay(ctx, ctx.accumulator / TICK_MS);
  ctx.sounds.frame(now, ctx.accumulator / TICK_MS);
  scene.items = itemsDisplay(ctx);
  updatePickupGrid(ctx);
  playPanelSounds(ctx);
  scene.inventory = inventoryDisplay(ctx);
  bag.update(scene.inventory, heldDisplay(ctx));
  shop.update(scene.inventory);
  shop.steer(shopDirection(ctx), now);
  shop.steerStick(ctx.gamepadStick.y, now);
}

/** @param {Context} ctx @param {ReturnType<typeof import('./input.js').createInput>} input @param {number} now */
function updateLayout(ctx, input, now) {
  const { scene, shop, frameStats } = ctx;
  frameStats.mark("layout");
  scene.ui = {
    layout: currentLayout(ctx),
    state: { pressed: input.router.pressed(), sticks: ctx.ui.sticks, now },
  };
  frameStats.end();
  shop.fit(scene.ui.layout.shopList?.capacity ?? 1);
}

/**
 * Start the frame loop.
 * @param {Context} ctx
 * @param {Awaited<ReturnType<typeof import('./render.js').createRenderer>>|null} renderer
 * @param {ReturnType<typeof import('./input.js').createInput>} input
 * @param {()=>void} [onFirstDraw]
 */
export function startLoop(ctx, renderer, input, onFirstDraw) {
  const { scene, frameStats, frameInfo } = ctx;
  let last = performance.now();
  /** @param {number} now */
  const frame = (now) => {
    const elapsed = now - last;
    const dt = Math.min(250, elapsed);
    last = now;
    frameInfo.viewMode = scene.viewMode;
    frameInfo.zoom = scene.zoom;
    frameInfo.chunks = scene.world.chunks.size;
    // The renderer sets `stats` after each render; it may not yet (or at all).
    const drawn = /** @type {{stats?:{quads?:number,tiles?:number}}|null} */ (
      renderer
    )?.stats;
    frameInfo.quads = drawn?.quads;
    frameInfo.tiles = drawn?.tiles;
    frameStats.frame(now, frameInfo);
    input.poll();
    frameStats.mark("step");
    stepWorld(ctx, now);
    frameStats.end();
    const local = scene.world.players[scene.localId];
    localVisibility(ctx, local);
    steerZoom(ctx, dt);
    steerCamera(ctx, local, now, dt);
    input.steerMenu(now);
    updateChat(ctx, now);
    updateDisplay(ctx, now);
    updateLayout(ctx, input, now);
    const liveText = [
      scene.notice && now < scene.notice.until
        ? scene.notice.text
        : scene.status,
      scene.displayStatus,
    ].filter(Boolean).join("\n");
    if (ctx.liveStatus.textContent !== liveText) {
      ctx.liveStatus.textContent = liveText;
    }
    frameStats.mark("render");
    const worldDrawn = renderer
      ? renderer.render(scene, ctx.accumulator / TICK_MS)
      : true;
    if (worldDrawn && onFirstDraw) {
      onFirstDraw();
      onFirstDraw = undefined;
    }
    frameStats.end();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // The gap while a tab was hidden is not a lag spike.
  document.addEventListener("visibilitychange", () => frameStats.skipGap());
  // A hidden tab gets no frames; the clock keeps the world stepping.
  createTickClock(() => stepWorld(ctx, performance.now()), TICK_MS);
}
