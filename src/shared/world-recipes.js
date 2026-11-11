// @ts-check
// Built-in recipes use the same declarative builder as custom worlds.
import { PLAY_Z } from "./single-plane.js";
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
  b.spawn({ x: 7, y: 7, z: PLAY_Z });
  if (edge === 16) {
    for (let x = 8; x < 16; x++) b.spawn({ x, y: 7, z: PLAY_Z });
  } else {
    for (let y = 3; y <= 11; y++) {
      for (let x = 3; x <= 12; x++) {
        if (x !== 8 || y !== 8) b.spawn({ x, y, z: PLAY_Z });
      }
    }
  }
}

/** @param {number} [edge] @param {{npc?:boolean,generator?:boolean,seed?:number}} [options] */
export function authoredRecipe(edge = 16, options = {}) {
  if (edge !== 16 && edge !== 32) {
    throw new RangeError("unsupported authored area size");
  }
  const b = worldBuilder().planar().bounds(bounds(edge)).base(OPEN);
  b.tile({ x: 8, y: 8, z: PLAY_Z }, STONE);
  b.fill(
    { minX: 2, maxX: 12, minY: 13, maxY: 14, minZ: PLAY_Z, maxZ: PLAY_Z },
    STONE,
  );
  if (edge === 32) b.tile({ x: 23, y: 23, z: PLAY_Z }, STONE);
  [STONE, COAL, IRON_ORE, GOLD_ORE, LAPIS, REDSTONE, DIAMOND, EMERALD].forEach((
    m,
    i,
  ) => b.tile({ x: i + 2, y: 1, z: PLAY_Z }, m));
  authoredSpawns(b, edge);
  if (options.npc) {
    b.entity({
      id: "npc-corner",
      at: { x: 2, y: 2, z: PLAY_Z },
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
  const b = worldBuilder().planar().bounds(bounds(32)).seed(seed).generator(
    "caves",
  ).pin(
    0,
    0,
  ).pin(1, 0).pin(0, 1).pin(1, 1);
  /** @type {Structure} */
  const room = {
    paints: [
      {
        bounds: {
          minX: 10,
          maxX: 27,
          minY: 10,
          maxY: 20,
          minZ: PLAY_Z,
          maxZ: PLAY_Z,
        },
        material: STONE,
      },
      {
        bounds: {
          minX: 12,
          maxX: 20,
          minY: 12,
          maxY: 18,
          minZ: PLAY_Z,
          maxZ: PLAY_Z,
        },
        material: OPEN,
      },
    ],
    entities: [{
      id: "npc-ulgar",
      name: "Ulgar",
      role: "trader",
      at: { x: 16, y: 12, z: PLAY_Z },
      behavior: { id: "still" },
    }],
    spawns: [
      { x: 16, y: 15, z: PLAY_Z },
      { x: 15, y: 15, z: PLAY_Z },
      { x: 17, y: 15, z: PLAY_Z },
      { x: 16, y: 16, z: PLAY_Z },
      { x: 15, y: 16, z: PLAY_Z },
      { x: 17, y: 16, z: PLAY_Z },
      { x: 16, y: 14, z: PLAY_Z },
      { x: 15, y: 14, z: PLAY_Z },
      { x: 17, y: 14, z: PLAY_Z },
    ],
  };
  if (options.npc) {
    room.entities?.push({
      id: "npc-corner",
      at: { x: 12, y: 17, z: PLAY_Z },
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
  b.tile({ x: 16, y: 19, z: PLAY_Z }, OPEN);
  b.fill(
    { minX: 20, maxX: 27, minY: 12, maxY: 12, minZ: PLAY_Z, maxZ: PLAY_Z },
    OPEN,
  );
  for (
    const [x, y, m] of [
      [22, 11, COAL],
      [24, 13, COAL],
      [23, 11, COAL],
      [25, 11, IRON_ORE],
      [26, 13, IRON_ORE],
      [26, 11, GOLD_ORE],
    ]
  ) b.tile({ x, y, z: PLAY_Z }, m);
  const exit = caveExit(seed);
  b.fill({
    minX: 27,
    maxX: exit.x,
    minY: 12,
    maxY: 12,
    minZ: PLAY_Z,
    maxZ: PLAY_Z,
  }, OPEN);
  b.fill({
    minX: exit.x,
    maxX: exit.x,
    minY: Math.min(12, exit.y),
    maxY: Math.max(12, exit.y),
    minZ: PLAY_Z,
    maxZ: PLAY_Z,
  }, OPEN);
  if (exit.gallery) {
    b.fill({
      minX: exit.x,
      maxX: exit.x + 11,
      minY: exit.y - 4,
      maxY: exit.y + 4,
      minZ: PLAY_Z,
      maxZ: PLAY_Z,
    }, OPEN);
  }
  return b.definition();
}

/** Find a natural cave with at least 96 connected cells, beyond the room shell.
 * The bounded search and fallback gallery keep arbitrary seeds playable.
 * @param {number} seed
 */
function caveExit(seed) {
  const visited = new Set();
  for (let x = 28; x <= 96; x++) {
    for (let y = -32; y <= 64; y++) {
      const key = `${x},${y}`;
      if (visited.has(key) || !isCaveTile(seed, x, y, PLAY_Z)) continue;
      const queue = [{ x, y }];
      visited.add(key);
      for (let i = 0; i < queue.length && queue.length < 96; i++) {
        const at = queue[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = at.x + dx, ny = at.y + dy;
          const next = `${nx},${ny}`;
          if (
            nx < 28 || nx > 112 || ny < -48 || ny > 80 || visited.has(next) ||
            !isCaveTile(seed, nx, ny, PLAY_Z)
          ) continue;
          visited.add(next);
          queue.push({ x: nx, y: ny });
        }
      }
      if (queue.length >= 96) return { x, y, gallery: false };
    }
  }
  return { x: 96, y: 12, gallery: true };
}
