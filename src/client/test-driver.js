// @ts-check
// Test automation binds here. __od remains an independent manual inspection tool.
import { createHarnessApi } from "./harness.js";
import { addStack, dropItem, inventoryOf } from "../shared/items.js";
import { setHeldItem } from "../shared/held-item.js";
import * as materials from "../shared/terrain.js";
import * as items from "../shared/items.js";
import { writeTile } from "../shared/terrain.js";

/** @typedef {import('./context.js').Context} Context */
/** @typedef {import('../shared/world.js').Tile} Tile */
/** @typedef {{players?:{id:string,at?:Tile,inventory?:import('../shared/items.js').Stack[],held?:string}[],tiles?:import('../shared/world-builder.js').Paint[],drops?:{at:Tile,kind:string,count:number}[]}} WorldPatch */
/** @type {ReturnType<typeof createTestDriver>|undefined} */
let driver;
/** @param {Context} ctx @param {Parameters<typeof createHarnessApi>[1]} renderer */
function createTestDriver(ctx, renderer) {
  const api = createHarnessApi(ctx, renderer);
  // Dynamic test fixtures use the same tile API and shared inventory rules.
  return {
    ...api,
    materials,
    items,
    /** @param {WorldPatch} patch */
    edit(patch) {
      if (ctx.isAdmin) throw new Error("World setup belongs to the host");
      for (const { bounds: b, material } of patch.tiles ?? []) {
        for (let z = b.minZ; z <= b.maxZ; z++) {
          for (let y = b.minY; y <= b.maxY; y++) {
            for (let x = b.minX; x <= b.maxX; x++) {
              writeTile(ctx.scene.world, x, y, z, material);
            }
          }
        }
      }
      for (const entry of patch.players ?? []) {
        const player = ctx.scene.world.players[entry.id];
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
          entry.held && !setHeldItem(ctx.scene.world, entry.id, entry.held).ok
        ) throw new Error("Invalid fixture held item");
      }
      for (const drop of patch.drops ?? []) {
        if (!dropItem(ctx.scene.world, drop.at, drop.kind, drop.count)) {
          throw new Error("Invalid fixture drop");
        }
      }
      ctx.scene.visibility.sample = "";
      ctx.host?.publish();
    },
  };
}
/** Bind only for harness pages. @param {Context} ctx @param {Parameters<typeof createHarnessApi>[1]} renderer */
export function bindTestDriver(ctx, renderer) {
  if (new URL(location.href).searchParams.has("harness")) {
    driver = createTestDriver(ctx, renderer);
  }
}
/** Read by the shared Playwright driver, never through globalThis.__od. */
export function inspectWorld() {
  return driver;
}
