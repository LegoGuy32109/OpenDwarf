// @ts-check
// Serializable world construction, shared by browser and headless sessions.
import { MAX_MATERIAL } from "./materials.js";
import { identifier } from "./wire-parse.js";
import { addPlayer } from "./world.js";
import { enableLocomotion } from "./locomotion.js";
import { addStack, dropItem, inventoryOf } from "./items.js";
import { setHeldItem } from "./held-item.js";
import { createChunkGenerator } from "./generation.js";
import {
  chunkCoord,
  chunkIndex,
  createChunkData,
  localCoord,
  setChunk,
  STONE,
  WORLD_TOP,
} from "./terrain.js";

/** @typedef {import('./world.js').Tile} Tile */
/** @typedef {{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}} Box */
/** @typedef {{id:string,params?:Record<string,unknown>}} Component */
/** @typedef {{id:string,at:Tile,name?:string,role?:'trader',behavior?:Component,inventory?:import('./items.js').Stack[],held?:string,free?:boolean}} EntityDefinition */
/** @typedef {{bounds:Box,material:number}} Paint */
/** @typedef {{version:1,seed:number,base:number,bounds:Box,generator:Component|null,paints:Paint[],entities:EntityDefinition[],spawns:Tile[],drops:{at:Tile,kind:string,count:number}[],pinned:{cx:number,cy:number}[],unloadGraceTicks:number}} WorldDefinition */
/** @typedef {{paints?:Paint[],entities?:EntityDefinition[],spawns?:Tile[]}} Structure */
/** @typedef {(seed:number,params:Record<string,unknown>) => (cx:number,cy:number)=>Uint8Array} GeneratorFactory */
/** @type {Map<string,GeneratorFactory>} */
const generators = new Map();
generators.set("caves", (seed) => createChunkGenerator(seed));
generators.set(
  "solid",
  (_seed, params) => () => createChunkData(Number(params.material ?? STONE)),
);
/** Register an alternative generator before loading definitions that name it. @param {string} id @param {GeneratorFactory} factory */
export function registerWorldGenerator(id, factory) {
  if (!id || generators.has(id)) {
    throw new Error(`Generator already registered: ${id}`);
  }
  generators.set(id, factory);
}
/** @param {unknown} value */
function serializable(value) {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach(serializable);
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    Object.values(value).forEach(serializable);
    return;
  }
  throw new TypeError("World definitions require finite JSON values");
}
/** Freeze plain definition data so a runtime cannot change its regeneration recipe. @param {unknown} value */
function freeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
}
/** @param {Tile} at */
function tile(at) {
  if (
    ![at.x, at.y, at.z].every(Number.isInteger) || at.z < 0 || at.z > WORLD_TOP
  ) throw new RangeError("Invalid world tile");
}
/** @param {Box} bounds */
function box(bounds) {
  tile({ x: bounds.minX, y: bounds.minY, z: bounds.minZ });
  tile({ x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ });
  if (
    bounds.minX > bounds.maxX || bounds.minY > bounds.maxY ||
    bounds.minZ > bounds.maxZ
  ) throw new RangeError("Reversed world bounds");
}
/** @param {number} material */
function material(material) {
  if (!Number.isInteger(material) || material < 0 || material > MAX_MATERIAL) {
    throw new RangeError("Invalid terrain material");
  }
}
/** @param {EntityDefinition[]} entities */
function validateEntities(entities) {
  const ids = new Set();
  for (const entity of entities) {
    tile(entity.at);
    if (!identifier(entity.id) || ids.has(entity.id)) {
      throw new Error(`Duplicate or empty entity ID: ${entity.id}`);
    }
    ids.add(entity.id);
  }
}

/** @param {WorldDefinition} definition */
function validateWorldDefinition(definition) {
  serializable(definition);
  if (definition.version !== 1) {
    throw new Error("Unsupported world definition version");
  }
  if (!Number.isSafeInteger(definition.seed)) {
    throw new RangeError("Invalid world seed");
  }
  box(definition.bounds);
  material(definition.base);
  if (definition.generator && !generators.has(definition.generator.id)) {
    throw new Error(`Unknown generator: ${definition.generator.id}`);
  }
  validateEntities(definition.entities);
  definition.spawns.forEach(tile);
  for (const paint of definition.paints) {
    box(paint.bounds);
    material(paint.material);
  }
  for (const drop of definition.drops) tile(drop.at);
  for (const p of definition.pinned) {
    if (![p.cx, p.cy].every(Number.isInteger)) {
      throw new RangeError("Invalid pinned chunk");
    }
  }
  if (
    !Number.isInteger(definition.unloadGraceTicks) ||
    definition.unloadGraceTicks < 0
  ) throw new RangeError("Invalid unload grace");
}
/** A reusable builder produces a fresh JSON definition on every call to definition(). */
export function worldBuilder() {
  /** @type {WorldDefinition} */
  const definition = {
    version: 1,
    seed: 1,
    base: STONE,
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 15, maxY: 15, maxZ: 7 },
    generator: null,
    paints: [],
    entities: [],
    spawns: [],
    drops: [],
    pinned: [],
    unloadGraceTicks: 600,
  };
  const api = {
    /** @param {number} value */
    seed(value) {
      definition.seed = value;
      return api;
    },
    /** Inclusive tile bounds. @param {Box} value */
    bounds(value) {
      definition.bounds = { ...value };
      return api;
    },
    /** @param {number} value */
    base(value) {
      definition.base = value;
      return api;
    },
    /** @param {string} id @param {Record<string,unknown>} [params] */
    generator(id, params = {}) {
      definition.generator = { id, params };
      return api;
    },
    /** @param {Box} bounds @param {number} material */
    fill(bounds, material) {
      definition.paints.push({ bounds: { ...bounds }, material });
      return api;
    },
    /** @param {Tile} at @param {number} material */
    tile(at, material) {
      return api.fill({
        minX: at.x,
        maxX: at.x,
        minY: at.y,
        maxY: at.y,
        minZ: at.z,
        maxZ: at.z,
      }, material);
    },
    /** @param {EntityDefinition} value */
    entity(value) {
      definition.entities.push(structuredClone(value));
      return api;
    },
    /** @param {Tile} at */
    spawn(at) {
      definition.spawns.push({ ...at });
      return api;
    },
    /** @param {Tile} at @param {string} kind @param {number} [count] */
    drop(at, kind, count = 1) {
      definition.drops.push({ at: { ...at }, kind, count });
      return api;
    },
    /** @param {number} cx @param {number} cy */
    pin(cx, cy) {
      definition.pinned.push({ cx, cy });
      return api;
    },
    /** @param {number} ticks */
    unloadGrace(ticks) {
      definition.unloadGraceTicks = ticks;
      return api;
    },
    /** Structure entities have names scoped by the placement ID. @param {Structure} structure @param {Tile} at @param {{id?:string,entities?:boolean,spawns?:boolean}} [options] */
    place(structure, at, options = {}) {
      const shift = (/** @type {Tile} */ t) => ({
        x: t.x + at.x,
        y: t.y + at.y,
        z: t.z + at.z,
      });
      for (const p of structure.paints ?? []) {
        api.fill({
          minX: p.bounds.minX + at.x,
          maxX: p.bounds.maxX + at.x,
          minY: p.bounds.minY + at.y,
          maxY: p.bounds.maxY + at.y,
          minZ: p.bounds.minZ + at.z,
          maxZ: p.bounds.maxZ + at.z,
        }, p.material);
      }
      if (options.entities !== false) {
        for (const e of structure.entities ?? []) {
          const entity = structuredClone(e);
          entity.id = options.id ? `${options.id}:${e.id}` : e.id;
          entity.at = shift(e.at);
          // Patrol waypoints are relative to the entity, so placing moves them too.
          api.entity(entity);
        }
      }
      if (options.spawns !== false) {
        for (const t of structure.spawns ?? []) api.spawn(shift(t));
      }
      return api;
    },
    definition() {
      validateWorldDefinition(definition);
      return structuredClone(definition);
    },
    build() {
      return buildWorld(api.definition());
    },
  };
  return api;
}
/** @param {Box} b @param {number} x @param {number} y @param {number} z */
function outsideBounds(b, x, y, z) {
  return x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ ||
    z > b.maxZ;
}
/** @param {Uint8Array} data @param {number} cx @param {number} cy @param {WorldDefinition} definition */
function clipChunk(data, cx, cy, definition) {
  for (let z = 0; z <= WORLD_TOP; z++) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (outsideBounds(definition.bounds, cx * 16 + x, cy * 16 + y, z)) {
          data[chunkIndex(x, y, z)] = STONE;
        }
      }
    }
  }
}

/** @param {Uint8Array} data @param {number} cx @param {number} cy @param {WorldDefinition} definition @param {Paint} paint */
function paintChunk(data, cx, cy, definition, { bounds: b, material: m }) {
  for (let z = b.minZ; z <= b.maxZ; z++) {
    for (
      let y = Math.max(b.minY, cy * 16);
      y <= Math.min(b.maxY, cy * 16 + 15);
      y++
    ) {
      for (
        let x = Math.max(b.minX, cx * 16);
        x <= Math.min(b.maxX, cx * 16 + 15);
        x++
      ) {
        if (
          !definition.generator && outsideBounds(definition.bounds, x, y, z)
        ) continue;
        data[chunkIndex(localCoord(x), localCoord(y), z)] = m;
      }
    }
  }
}

/** @param {WorldDefinition} definition */
function terrainGenerator(definition) {
  const base = definition.generator
    ? generators.get(definition.generator.id)?.(
      definition.seed,
      definition.generator.params ?? {},
    )
    : null;
  return (/** @type {number} */ cx, /** @type {number} */ cy) => {
    const data = base
      ? new Uint8Array(base(cx, cy))
      : createChunkData(definition.base);
    if (data.length !== 2048) {
      throw new RangeError("Generator returned an invalid chunk");
    }
    if (!definition.generator) clipChunk(data, cx, cy, definition);
    for (const paint of definition.paints) {
      paintChunk(data, cx, cy, definition, paint);
    }
    return data;
  };
}

/** @param {import('./world.js').World} world @param {WorldDefinition} definition @param {(cx:number,cy:number)=>Uint8Array} generate */
function seedTerrain(world, definition, generate) {
  for (
    let cy = chunkCoord(definition.bounds.minY);
    cy <= chunkCoord(definition.bounds.maxY);
    cy++
  ) {
    for (
      let cx = chunkCoord(definition.bounds.minX);
      cx <= chunkCoord(definition.bounds.maxX);
      cx++
    ) setChunk(world, cx, cy, generate(cx, cy));
  }
}

/** @param {import('./world.js').World} world @param {WorldDefinition} definition */
function seedEntities(world, definition) {
  for (const entity of definition.entities) {
    const player = addPlayer(world, entity.id, entity.at);
    player.name = entity.name ?? "";
    player.npc = true;
    if (entity.role) player.role = entity.role;
    if (entity.free !== false) enableLocomotion(player);
    for (const stack of entity.inventory ?? []) {
      if (!addStack(inventoryOf(player), stack.kind, stack.count)) {
        throw new Error("Invalid initial inventory");
      }
    }
    if (entity.held && !setHeldItem(world, entity.id, entity.held).ok) {
      throw new Error("Invalid initial held item");
    }
  }
}

/** @param {import('./world.js').World} world @param {WorldDefinition} definition */
function seedDrops(world, definition) {
  for (const drop of definition.drops) {
    if (!dropItem(world, drop.at, drop.kind, drop.count)) {
      throw new Error("Invalid initial drop");
    }
  }
}

/** Construct terrain first, then entities once. @param {WorldDefinition} input */
export function buildWorld(input) {
  validateWorldDefinition(input);
  const definition = structuredClone(input);
  freeze(definition);
  /** @type {import('./world.js').World} */
  const world = { tick: 0, chunks: new Map(), players: {} };
  if (!definition.generator) world.limits = { ...definition.bounds };
  const generate = terrainGenerator(definition);
  seedTerrain(world, definition, generate);
  if (definition.generator) world.generateChunk = generate;
  world.pinned = new Set(definition.pinned.map((p) => `${p.cx},${p.cy}`));
  seedEntities(world, definition);
  seedDrops(world, definition);
  let ordinal = 0;
  return {
    world,
    definition,
    spawn() {
      const points = definition.spawns;
      return { ...(points[ordinal++ % points.length] ?? { x: 7, y: 7, z: 0 }) };
    },
  };
}
/** Empty unknown terrain for low-level unit fixtures. @param {number} [edge] */
export function createFixtureWorld(edge = 16) {
  if (edge !== 16 && edge !== 32) {
    throw new RangeError("unsupported authored area size");
  }
  const world = worldBuilder().base(0).bounds({
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: edge - 1,
    maxY: edge - 1,
    maxZ: 7,
  }).build().world;
  // Low-level storage fixtures can still exercise arbitrary chunk coordinates.
  delete world.limits;
  return world;
}
