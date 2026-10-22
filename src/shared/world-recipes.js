// @ts-check
// Built-in recipes use the same declarative builder as custom worlds.
import { worldBuilder } from "./world-builder.js";
import { isCaveTile, WORLD_SEED } from "./generation.js";
import { OPEN, STONE, WORLD_TOP } from "./terrain.js";
import {
  COAL,
  DIAMOND,
  EMERALD,
  GOLD_ORE,
  IRON_ORE,
  LAPIS,
  REDSTONE,
} from "./materials.js";

/** @typedef {import('./world-builder.js').Structure} Structure */
/** @typedef {import('./world-builder.js').Box} Box */
/** @param {number} edge */
const bounds = (edge) => ({
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: edge - 1,
  maxY: edge - 1,
  maxZ: WORLD_TOP,
});
/** @param {{spawn:(at:import('./world.js').Tile)=>unknown}} b @param {number} edge */
function authoredSpawns(b, edge) {
  b.spawn({ x: 7, y: 7, z: 0 });
  if (edge === 16) { for (let x = 8; x < 16; x++) b.spawn({ x, y: 7, z: 0 }); }
  else {for (let y = 3; y <= 11; y++) {
      for (let x = 3; x <= 12; x++) {
        if (x !== 8 || y !== 8) b.spawn({ x, y, z: 0 });
      }
    }}
}

/** @param {number} [edge] @param {{npc?:boolean,generator?:boolean,seed?:number}} [options] */
export function authoredRecipe(edge = 16, options = {}) {
  if (edge !== 16 && edge !== 32) {
    throw new RangeError("unsupported authored area size");
  }
  const b = worldBuilder().bounds(bounds(edge)).base(OPEN);
  b.fill({ minX: 8, maxX: 8, minY: 8, maxY: 8, minZ: 0, maxZ: 7 }, STONE);
  for (let x = 2; x <= 8; x++) {
    b.fill(
      { minX: x, maxX: x, minY: 13, maxY: 13, minZ: 0, maxZ: x - 2 },
      STONE,
    );
  }
  b.fill({ minX: 9, maxX: 12, minY: 13, maxY: 14, minZ: 0, maxZ: 6 }, STONE);
  if (edge === 32) {
    b.fill({ minX: 23, maxX: 23, minY: 23, maxY: 23, minZ: 0, maxZ: 7 }, STONE);
  }
  [STONE, COAL, IRON_ORE, GOLD_ORE, LAPIS, REDSTONE, DIAMOND, EMERALD].forEach((
    m,
    i,
  ) => b.tile({ x: i + 2, y: 1, z: 0 }, m));
  authoredSpawns(b, edge);
  if (options.npc) {
    b.entity({
      id: "npc-corner",
      at: { x: 2, y: 2, z: 0 },
      behavior: {
        id: "patrol",
        params: {
          waypoints: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, {
            x: 0,
            y: 0,
          }],
          pauseEvery: 8,
          pauseTicks: 20,
        },
      },
    });
  }
  if (options.generator) {
    // Keep the authored area as overlays over the selected cave generator.
    b.seed(options.seed ?? WORLD_SEED).generator("caves");
    const d = b.definition();
    d.paints.unshift({ bounds: bounds(edge), material: OPEN });
    for (let cy = 0; cy < edge / 16; cy++) {
      for (let cx = 0; cx < edge / 16; cx++) {
        d.pinned.push({ cx, cy });
      }
    }
    return d;
  }
  return b.definition();
}
/** The spawn room's local terrain and session contributions. @param {number} [seed] @param {{npc?:boolean}} [options] */
export function roomRecipe(seed = WORLD_SEED, options = { npc: true }) {
  const b = worldBuilder().bounds(bounds(32)).seed(seed).generator("caves").pin(
    0,
    0,
  ).pin(1, 0).pin(0, 1).pin(1, 1);
  /** @type {Structure} */
  const room = {
    paints: [
      {
        bounds: { minX: 10, maxX: 27, minY: 10, maxY: 20, minZ: 1, maxZ: 5 },
        material: STONE,
      },
      {
        bounds: { minX: 12, maxX: 20, minY: 12, maxY: 18, minZ: 4, maxZ: 4 },
        material: OPEN,
      },
    ],
    entities: [{
      id: "npc-ulgar",
      name: "Ulgar",
      role: "trader",
      at: { x: 16, y: 12, z: 4 },
      behavior: { id: "still" },
    }],
    spawns: [
      { x: 16, y: 15, z: 4 },
      { x: 15, y: 15, z: 4 },
      { x: 17, y: 15, z: 4 },
      { x: 16, y: 16, z: 4 },
      { x: 15, y: 16, z: 4 },
      { x: 17, y: 16, z: 4 },
      { x: 16, y: 14, z: 4 },
      { x: 15, y: 14, z: 4 },
      { x: 17, y: 14, z: 4 },
    ],
  };
  if (options.npc) {
    room.entities?.push({
      id: "npc-corner",
      at: { x: 12, y: 17, z: 4 },
      behavior: {
        id: "patrol",
        params: {
          waypoints: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, {
            x: 0,
            y: 0,
          }],
          pauseEvery: 8,
          pauseTicks: 20,
        },
      },
    });
  }
  b.place(room, { x: 0, y: 0, z: 0 });
  b.tile({ x: 16, y: 19, z: 4 }, OPEN).tile({ x: 19, y: 12, z: 3 }, OPEN).tile({
    x: 20,
    y: 12,
    z: 2,
  }, OPEN).tile({ x: 20, y: 12, z: 3 }, OPEN);
  b.fill({ minX: 21, maxX: 26, minY: 12, maxY: 12, minZ: 2, maxZ: 2 }, OPEN);
  for (
    const [x, y, z, m] of [
      [22, 11, 2, COAL],
      [24, 13, 2, COAL],
      [23, 12, 1, COAL],
      [25, 11, 2, IRON_ORE],
      [26, 13, 2, IRON_ORE],
      [26, 11, 2, GOLD_ORE],
    ]
  ) b.tile({ x, y, z }, m);
  for (let x = 27; x < 32; x++) {
    if (isCaveTile(seed, x, 12, 2)) break;
    b.tile({ x, y: 12, z: 2 }, OPEN);
  }
  return b.definition();
}
