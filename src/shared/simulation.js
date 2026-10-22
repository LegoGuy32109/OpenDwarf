// @ts-check
// Authoritative fixed ticks. No DOM, networking, scheduling, or renderer.
import { acceptMoveIntent } from "./protocol.js";
import { buildWorld } from "./world-builder.js";
import {
  addPlayer,
  advanceTicks,
  removePlayer,
  setNickname,
  setTyping,
  startMove,
  submitMessage,
  TICK_MS,
} from "./world.js";
import {
  enableLocomotion,
  moveEntity,
  speedTilesPerSecond,
} from "./locomotion.js";
import { cancelMining, startMining, stepMining } from "./mining.js";
import { placeStone } from "./placing.js";
import { pickUp, pickupLine } from "./items.js";
import { setHeldItem } from "./held-item.js";
import { sellItems } from "./shop.js";
import { createConversations } from "./npc-conversation.js";
import {
  createVisibility,
  recomputeVisibility,
  visibilityPosition,
} from "./visibility.js";
import { seesFrom } from "./reach.js";
import { createStamina, setSprint, stepStamina } from "./stamina.js";
import { generateAround, generateInView } from "./generation.js";
import { createChunkUnloader } from "./chunk-unload.js";
import { recordSteps } from "./sound.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world-builder.js').WorldDefinition} WorldDefinition */
/** @typedef {(world:World,id:string,params:Record<string,unknown>)=>()=>void} BehaviorFactory */
/** @type {Map<string,BehaviorFactory>} */
const behaviors = new Map();
behaviors.set("still", () => () => {});
behaviors.set("patrol", (world, id, params) => {
  const start = { ...world.players[id] };
  let sequence = 0;
  const points = /** @type {{x:number,y:number}[]} */ (params.waypoints ?? []);
  let index = 0, visits = 0, pauseUntil = 0;
  /** @param {import('./world.js').Player} player */
  function tilePatrol(player) {
    if (player.move) return;
    const point = points[index];
    const dx = Math.sign(start.x + point.x - player.x),
      dy = Math.sign(start.y + point.y - player.y);
    if (!dx && !dy) {
      index = (index + 1) % points.length;
      return;
    }
    const moved = startMove(world, id, dx, dy, ++sequence);
    if (moved.ok) {
      index = (index + 1) % points.length;
      visits++;
      if (visits % Number(params.pauseEvery ?? 8) === 0) {
        pauseUntil = world.tick + (moved.move?.durationTicks ?? 0) +
          Number(params.pauseTicks ?? 20);
      }
    }
    return;
  }

  /** @param {import('./world.js').Player} player */
  function freePatrol(player) {
    const target = points[index];
    if (
      Math.hypot(player.x - start.x - target.x, player.y - start.y - target.y) <
        0.11
    ) {
      index = (index + 1) % points.length;
      visits++;
      if (visits % Number(params.pauseEvery ?? 8) === 0) {
        pauseUntil = world.tick + Number(params.pauseTicks ?? 20);
      }
    }
    const next = points[index];
    moveEntity(
      world,
      id,
      Math.abs(start.x + next.x - player.x) > 0.1
        ? Math.sign(start.x + next.x - player.x)
        : 0,
      Math.abs(start.y + next.y - player.y) > 0.1
        ? Math.sign(start.y + next.y - player.y)
        : 0,
    );
  }

  return () => {
    const player = world.players[id];
    if (!player || !points.length) return;
    if (world.tick < pauseUntil) {
      moveEntity(world, id, 0, 0);
      return;
    }
    if (player.free) freePatrol(player);
    else tilePatrol(player);
  };
});
/** @param {string} id @param {BehaviorFactory} factory */
export function registerWorldBehavior(id, factory) {
  if (!id || behaviors.has(id)) {
    throw new Error(`Behavior already registered: ${id}`);
  }
  behaviors.set(id, factory);
}
/** @param {WorldDefinition} definition @param {{random?:()=>number}} [options] `random` picks NPC replies and thinking jitter */
export function createSimulation(definition, options = {}) {
  const built = buildWorld(definition);
  const { world } = built;
  definition = built.definition;
  const conversations = createConversations(world, options.random);
  /** @type {Map<string,{direction:{x:number,y:number},stamina:ReturnType<typeof createStamina>,visibility:ReturnType<typeof createVisibility>,master:boolean,sequence:number}>} */
  const actors = new Map();
  /** @type {(()=>void)[]} */
  const npcs = [];
  for (const entity of definition.entities) {
    if (!entity.behavior) continue;
    const factory = behaviors.get(entity.behavior.id);
    if (!factory) throw new Error(`Unknown behavior: ${entity.behavior.id}`);
    npcs.push(factory(world, entity.id, entity.behavior.params ?? {}));
  }
  /** @type {{id:string,message:Record<string,unknown>,done?:(result:Record<string,unknown>)=>void}[]} */
  let actions = [];
  /** @type {{minX:number,minY:number,maxX:number,maxY:number}[]} */
  let views = [];
  const unloader = createChunkUnloader({
    graceMs: definition.unloadGraceTicks * TICK_MS,
  });
  /** @param {string} id */
  function actor(id) {
    let state = actors.get(id);
    if (!state) {
      state = {
        direction: { x: 0, y: 0 },
        stamina: createStamina(),
        visibility: createVisibility(),
        master: false,
        sequence: 0,
      };
      actors.set(id, state);
    }
    return state;
  }
  /** @param {string} id */
  function sees(id) {
    const state = actor(id), player = world.players[id];
    if (player) {
      state.visibility.sample = "";
      recomputeVisibility(
        world,
        state.visibility,
        visibilityPosition(player, world.tick),
      );
    }
    return seesFrom(state.visibility.visible, state.master);
  }
  /** @type {Record<string,(id:string,message:Record<string,unknown>,tile:import('./world.js').Tile)=>Record<string,unknown>>} */
  const actionsByType = {
    "move": (id, message) => {
      const state = actor(id);
      const result = acceptMoveIntent(world, id, {
        dx: Number(message.dx),
        dy: Number(message.dy),
        sequence: Number(message.sequence),
      }, state.sequence);
      state.sequence = result.sequence;
      return result;
    },
    "cancel": (id, message) => {
      actor(id).sequence = Number(message.sequence);
      return { ok: true };
    },
    "input": (id, message) => {
      const state = actor(id);
      const dx = Number(message.dx), dy = Number(message.dy);
      if (
        !Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 1 ||
        Math.abs(dy) > 1
      ) return { ok: false, reason: "invalid input" };
      state.direction = { x: dx, y: dy };
      setSprint(state.stamina, message.sprint === true);
      return { ok: true };
    },
    "mode": (id, message) => {
      actor(id).master = message.mode === "master";
      return { ok: true };
    },
    "mine": (id, _message, tile) => {
      return startMining(world, id, tile, sees(id));
    },
    "mine-cancel": (id, _message) => {
      cancelMining(world, id);
      return { ok: true };
    },
    "place": (id, _message, tile) => {
      return placeStone(world, id, tile, sees(id));
    },
    "hold": (id, message) => {
      return setHeldItem(world, id, String(message.kind));
    },
    "pickup": (id, message, tile) => {
      const result = pickUp(world, id, tile, message.kind);
      return result.ok
        ? { ...result, line: pickupLine(result.kind, result.count) }
        : result;
    },
    "sell": (id, message) => {
      return sellItems(world, id, message);
    },
    "talk": (id, message) => {
      return conversations.ask(id, message.npc, message.choice, message.sale);
    },
    "typing": (id, message) => {
      setTyping(world, id, message.typing === true);
      return { ok: true };
    },
    "message": (id, message) => {
      return { ok: submitMessage(world, id, String(message.text)) };
    },
    "nick": (id, message) => {
      return setNickname(world, id, String(message.name));
    },
  };

  /** @param {string} id @param {Record<string,unknown>} message @returns {Record<string,unknown>} */
  function apply(id, message) {
    const player = Object.hasOwn(world.players, id)
      ? world.players[id]
      : undefined;
    if (!player) return { ok: false, reason: "unknown player" };
    const tile = {
      x: Number(message.x),
      y: Number(message.y),
      z: Number(message.z),
    };
    if (
      typeof message.type !== "string" ||
      !Object.hasOwn(actionsByType, message.type)
    ) {
      return { ok: false, reason: "unknown action" };
    }
    return actionsByType[message.type](id, message, tile);
  }
  const api = {
    world,
    definition: built.definition,
    /** Permissive player spawn. @param {string} id */
    join(id) {
      const p = enableLocomotion(addPlayer(world, id, built.spawn()));
      p.npc = false;
      actor(id);
      return p;
    },
    /** @param {string} id */
    leave(id) {
      removePlayer(world, id);
      actors.delete(id);
      cancelMining(world, id);
    },
    /** @param {string} id */
    state(id) {
      return actor(id);
    },
    sees,
    /** @param {string} id @param {Record<string,unknown>} message @param {(result:Record<string,unknown>)=>void} [done] */
    enqueue(id, message, done) {
      actions.push({ id, message: structuredClone(message), done });
    },
    /** Hold a direction read by each tick. Browser local input and headless fixtures use this. @param {string} id @param {{x:number,y:number}} direction @param {boolean} [sprint] */
    input(id, direction, sprint = false) {
      if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) {
        throw new RangeError("Invalid input direction");
      }
      const state = actor(id);
      state.direction = { ...direction };
      setSprint(state.stamina, sprint);
    },
    /** Explicit camera interest supplied by an adapter. @param {typeof views} next */
    interest(next) {
      views = next.map((v) => ({ ...v }));
    },
    /** @param {number} [count] */
    advanceTicks(count = 1) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError("Invalid tick count");
      }
      for (let i = 0; i < count; i++) {
        advanceTicks(world);
        // Read sight at the action boundary, including any earlier action's edits.
        const pending = actions;
        actions = [];
        for (const action of pending) {
          const result = apply(action.id, action.message);
          action.done?.(result);
        }
        for (const tick of npcs) tick();
        conversations.step();
        for (const [id, state] of actors) {
          if (!world.players[id]) continue;
          moveEntity(
            world,
            id,
            state.direction.x,
            state.direction.y,
            speedTilesPerSecond(state.stamina.sprint),
          );
          stepStamina(state.stamina);
        }
        stepMining(world, sees);
        const made = generateAround(world, Object.values(world.players));
        let remaining = 2 - made;
        for (const view of views) {
          remaining -= generateInView(world, view, remaining);
        }
        if (world.tick % 20 === 0) {
          unloader.update(
            world,
            Object.values(world.players),
            world.tick * TICK_MS,
            views,
          );
        }
        recordSteps(world, (id) => actors.get(id)?.stamina.sprint ?? false);
      }
    },
  };
  return api;
}
