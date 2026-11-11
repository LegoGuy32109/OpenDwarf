// @ts-check
// The action lifecycle is shared by pointer, keyboard, and controller input.
import {
  createActionGesture,
  MINING_REFRESH_TICKS,
} from "../shared/single-plane.js";
import { OPEN, readTile } from "../shared/terrain.js";
import { highlightedTile } from "../shared/target.js";
import { inReach } from "../shared/reach.js";
import { COIN, STONE_ITEM } from "../shared/items.js";
import { registerActionCancellation } from "./action-cancellation.js";
import { heldDisplay } from "./display.js";
import {
  actionDirection,
  cameraInput,
  openLevel,
  stickDirection,
} from "./input-values.js";
import { interact, placeAt, stopMining } from "./interact.js";
import {
  aimGesture,
  armGesture,
  cancelGesture,
  dragGesture,
  releaseGesture,
} from "./action-gesture.js";

/** @typedef {import('./client-context.js').Context} Context */
/** @typedef {import('../shared/world.js').Tile} Tile */
/** @typedef {{source:string,item:string,target:Tile|null,facing:{x:number,y:number},tick:number}} ActionState */
/** @type {WeakMap<Context,ActionState>} */
const states = new WeakMap();

/** Local capability adapter until the host capability helper is integrated. @param {string} kind */
export function actionCapabilities(kind) {
  return {
    aim: kind === STONE_ITEM || kind === COIN,
    place: kind === STONE_ITEM,
    mine: kind === "pickaxe",
  };
}

/** @param {Context} ctx */
function gestureOf(ctx) {
  return ctx.scene.actionGesture ??= createActionGesture();
}

/** @param {Context} ctx @param {Record<string,unknown>} message */
function sendAction(ctx, message) {
  if (ctx.isAdmin) return ctx.guest?.send(message) ?? false;
  ctx.simulation?.enqueue(ctx.scene.localId, message);
  return Boolean(ctx.simulation);
}

/** Current adjacent movement-facing tile. @param {Context} ctx */
function targetOf(ctx) {
  const { scene } = ctx;
  const player = scene.world.players[scene.localId];
  scene.aim = actionDirection(ctx);
  return player
    ? highlightedTile(player, scene.aim, player.z, scene.world)
    : null;
}

/** A press may be consumed by an explicit pickup or panel interaction. @param {Context} ctx @param {string} source @param {number} [x] @param {number} [y] */
export function pressAction(ctx, source, x = 0, y = 0) {
  if (states.has(ctx) || ctx.scene.chatOpen || ctx.scene.menu) return;
  if (interact(ctx)) return;
  if (
    ctx.scene.viewMode !== "entity" ||
    !ctx.scene.world.players[ctx.scene.localId]
  ) return;
  registerActionCancellation(ctx, () => cancelAction(ctx));
  armGesture(gestureOf(ctx), x, y);
  states.set(ctx, {
    source,
    item: heldDisplay(ctx),
    target: null,
    facing: actionDirection(ctx),
    tick: -Infinity,
  });
  updateAction(ctx);
}

/** Interruptions consume the armed action without placing or throwing. @param {Context} ctx */
export function cancelAction(ctx) {
  const state = states.get(ctx);
  states.delete(ctx);
  cancelGesture(gestureOf(ctx));
  if (state && actionCapabilities(state.item).mine) stopMining(ctx);
  ctx.scene.aim = actionDirection(ctx);
}

/** Called before release too, so item changes and panel openings cannot leak an action. @param {Context} ctx */
function validAction(ctx) {
  const state = states.get(ctx);
  if (!state) return null;
  if (
    ctx.scene.chatOpen || openLevel(ctx) !== null ||
    ctx.scene.viewMode !== "entity" ||
    heldDisplay(ctx) !== state.item ||
    !ctx.scene.world.players[ctx.scene.localId]
  ) {
    cancelAction(ctx);
    return null;
  }
  return state;
}

/** Poll aim each frame, refresh mining in world ticks, and retarget immediately on turns. @param {Context} ctx */
export function updateAction(ctx) {
  const state = validAction(ctx);
  if (!state) return;
  const capabilities = actionCapabilities(state.item);
  const gesture = gestureOf(ctx);
  if (capabilities.aim && state.source !== "pointer") {
    const aim = cameraInput(ctx);
    aimGesture(gesture, stickDirection(aim.x, aim.y, 0.18));
  }
  ctx.scene.aim = actionDirection(ctx);
  if (!capabilities.mine) return;
  const { world, localId, visibility } = ctx.scene;
  const player = world.players[localId];
  const facing = actionDirection(ctx);
  const turned = facing.x !== state.facing.x || facing.y !== state.facing.y;
  if (turned) {
    stopMining(ctx);
    state.target = null;
    state.tick = -Infinity;
    state.facing = facing;
  }
  if (
    state.target &&
    (readTile(world, state.target.x, state.target.y, state.target.z) === OPEN ||
      !inReach(
        world,
        player,
        state.target,
        (tile) => visibility.visible.has(`${tile.x},${tile.y},${tile.z}`),
      ))
  ) {
    stopMining(ctx);
    state.target = null;
    state.tick = -Infinity;
  }
  const candidate = state.target ?? targetOf(ctx);
  if (
    !candidate ||
    readTile(world, candidate.x, candidate.y, candidate.z) === OPEN ||
    !inReach(
      world,
      player,
      candidate,
      (tile) => visibility.visible.has(`${tile.x},${tile.y},${tile.z}`),
    )
  ) return;
  state.target = candidate;
  if (world.tick - state.tick >= MINING_REFRESH_TICKS) {
    if (!sendAction(ctx, { type: "mine-hold", ...candidate })) {
      cancelAction(ctx);
      return;
    }
    state.tick = world.tick;
  }
}

/** @param {Context} ctx @param {string} source */
export function releaseAction(ctx, source) {
  const state = validAction(ctx);
  if (!state || state.source !== source) return;
  updateAction(ctx);
  if (!states.has(ctx)) return;
  const capabilities = actionCapabilities(state.item);
  const release = releaseGesture(gestureOf(ctx));
  states.delete(ctx);
  if (capabilities.mine) stopMining(ctx);
  else if (release.result === "throw" && capabilities.aim) {
    sendAction(ctx, {
      type: "throw",
      dx: release.direction.x,
      dy: release.direction.y,
    });
  } else if (release.result === "tap" && capabilities.place) {
    const target = targetOf(ctx);
    if (target) placeAt(ctx, target);
  }
  ctx.scene.aim = actionDirection(ctx);
}

/** @param {Context} ctx @param {import('../shared/single-plane.js').ActionPointerEvent} event @param {()=>void} confirm */
export function actionPointer(ctx, event, confirm) {
  if (event.phase === "press") {
    if (openLevel(ctx) !== null) confirm();
    else pressAction(ctx, "pointer", event.originX, event.originY);
    return;
  }
  const state = validAction(ctx);
  if (!state || state.source !== "pointer") return;
  if (event.phase === "cancel") return cancelAction(ctx);
  if (actionCapabilities(state.item).aim) {
    dragGesture(gestureOf(ctx), event.x, event.y);
  }
  if (event.phase === "release") releaseAction(ctx, "pointer");
  else updateAction(ctx);
}
