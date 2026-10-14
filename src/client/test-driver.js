// @ts-check
// Test automation binds here. __od remains an independent manual inspection tool.
import { addStack, dropItem, inventoryOf } from "../shared/items.js";
import { setHeldItem } from "../shared/held-item.js";
import * as materials from "../shared/terrain.js";
import * as items from "../shared/items.js";
import { writeTile } from "../shared/terrain.js";

/** @typedef {import('../shared/world.js').Tile} Tile */
/** @typedef {{world:()=>import('../shared/world.js').World,isGuest:boolean,invalidate:()=>void,publish:()=>void}} FixtureServices */
/** @typedef {{players?:{id:string,at?:Tile,inventory?:import('../shared/items.js').Stack[],held?:string}[],tiles?:import('../shared/world-builder.js').Paint[],drops?:{at:Tile,kind:string,count:number}[]}} WorldPatch */
/** @type {ReturnType<typeof createTestDriver>|undefined} */
let driver;
/** @param {import('../shared/world.js').World} world @param {NonNullable<WorldPatch['tiles']>} tiles */
function editTiles(world, tiles) {
  for (const { bounds: b, material } of tiles) {
    for (let z = b.minZ; z <= b.maxZ; z++) {
      for (let y = b.minY; y <= b.maxY; y++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          writeTile(world, x, y, z, material);
        }
      }
    }
  }
}

/** @param {import('../shared/world.js').World} world @param {NonNullable<WorldPatch['players']>} players */
function editPlayers(world, players) {
  for (const entry of players) {
    const player = world.players[entry.id];
    if (!player) throw new Error(`Unknown fixture entity: ${entry.id}`);
    if (entry.at) {
      Object.assign(player, entry.at, {
        previousX: entry.at.x,
        previousY: entry.at.y,
        move: null,
        vx: 0,
        vy: 0,
      });
    }
    for (const stack of entry.inventory ?? []) {
      if (!addStack(inventoryOf(player), stack.kind, stack.count)) {
        throw new Error("Invalid fixture stack");
      }
    }
    if (
      entry.held && !setHeldItem(world, entry.id, entry.held).ok
    ) throw new Error("Invalid fixture held item");
  }
}

/** @param {import('../shared/world.js').World} world @param {NonNullable<WorldPatch['drops']>} drops */
function editDrops(world, drops) {
  for (const drop of drops) {
    if (!dropItem(world, drop.at, drop.kind, drop.count)) {
      throw new Error("Invalid fixture drop");
    }
  }
}

/** @template {object} Api @param {Api} api @param {FixtureServices} services */
function createTestDriver(api, services) {
  // Dynamic test fixtures use the same tile API and shared inventory rules.
  return {
    ...api,
    materials,
    items,
    /** @param {WorldPatch} patch */
    edit(patch) {
      if (services.isGuest) throw new Error("World setup belongs to the host");
      const world = services.world();
      editTiles(world, patch.tiles ?? []);
      editPlayers(world, patch.players ?? []);
      editDrops(world, patch.drops ?? []);
      services.invalidate();
      services.publish();
    },
  };
}
/** Bind only for harness pages. @template {object} Api @param {Api} api @param {FixtureServices} services */
export function bindTestDriver(api, services) {
  if (new URL(location.href).searchParams.has("harness")) {
    const bound = createTestDriver(api, services);
    driver = bound;
    return bound;
  }
}
/** Read by the shared Playwright driver, never through globalThis.__od. */
export function inspectWorld() {
  return driver;
}
