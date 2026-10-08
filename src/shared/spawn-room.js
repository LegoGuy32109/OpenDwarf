// @ts-check

import { createWorld, EXPANDED_WORLD_EDGE } from "./world.js";
import { COAL, GOLD_ORE, IRON_ORE } from "./materials.js";
import { generateChunkData, isCaveTile, WORLD_SEED } from "./generation.js";
import { CHUNK_EDGE, OPEN, setChunk, STONE, writeTile } from "./terrain.js";

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Tile} Tile */

/** The z level of the room floor. The floor stone lies at `ROOM_Z - 1`. */
export const ROOM_Z = 4;
/** Open interior of the spawn room, inclusive. The walls ring it. */
export const ROOM = { minX: 12, maxX: 20, minY: 12, maxY: 18 };
/** The one doorway, in the south wall. The tile beyond it is solid stone. */
export const DOORWAY = { x: 16, y: ROOM.maxY + 1, z: ROOM_Z };
/** Two stair tiles down from the room, then the tunnel level below them. */
export const STAIRS = [
  { x: 19, y: ROOM.minY, z: ROOM_Z - 1 },
  { x: 20, y: ROOM.minY, z: ROOM_Z - 2 },
];
/** The tunnel runs east from the foot of the stairs, through the east wall. */
export const TUNNEL = { y: ROOM.minY, z: ROOM_Z - 2, minX: 21, maxX: 26 };
/** Tile reserved for the shopkeeper, against the north wall. */
export const SHOPKEEPER_TILE = { x: 16, y: ROOM.minY, z: ROOM_Z };
/** Where the corner NPC starts; it walks a 2×2 square in the south west corner. */
export const NPC_ORIGIN = { x: ROOM.minX, y: ROOM.maxY - 1, z: ROOM_Z };
/** Tiles that joining players spawn on, centre first. Several may share one. */
const SPAWN_TILES = [
  { x: 16, y: 15, z: ROOM_Z },
  { x: 15, y: 15, z: ROOM_Z },
  { x: 17, y: 15, z: ROOM_Z },
  { x: 16, y: 16, z: ROOM_Z },
  { x: 15, y: 16, z: ROOM_Z },
  { x: 17, y: 16, z: ROOM_Z },
  { x: 16, y: 14, z: ROOM_Z },
  { x: 15, y: 14, z: ROOM_Z },
  { x: 17, y: 14, z: ROOM_Z },
];

/** @param {number} ordinal Zero for the host, then one more per joining player. @returns {Tile} */
export function roomSpawnTile(ordinal) {
  return { ...SPAWN_TILES[ordinal % SPAWN_TILES.length] };
}

/** `?layout=test` keeps the old pillar and staircase for specs. A harness page uses it unless `?layout=room` asks for the room. @param {URLSearchParams} params @returns {"room"|"test"} */
export function layoutFromParams(params) {
  const layout = params.get("layout");
  if (layout === "room" || layout === "test") return layout;
  return params.has("harness") ? "test" : "room";
}

/** Ore in the tunnel walls, so a new player finds some within a short dig. */
export const TUNNEL_ORES = [
  { x: 22, y: TUNNEL.y - 1, z: TUNNEL.z, material: COAL },
  { x: 24, y: TUNNEL.y + 1, z: TUNNEL.z, material: COAL },
  { x: 23, y: TUNNEL.y, z: TUNNEL.z - 1, material: COAL },
  { x: 25, y: TUNNEL.y - 1, z: TUNNEL.z, material: IRON_ORE },
  { x: 26, y: TUNNEL.y + 1, z: TUNNEL.z, material: IRON_ORE },
  { x: TUNNEL.maxX, y: TUNNEL.y - 1, z: TUNNEL.z, material: GOLD_ORE },
];

/**
 * Solid stone kept around the room, the stairs and the tunnel, so generated
 * caves never break into them: the walls stay whole and the doorway still
 * opens into stone. Inclusive bounds.
 */
export const SHELL = {
  minX: ROOM.minX - 2,
  maxX: TUNNEL.maxX + 1,
  minY: ROOM.minY - 2,
  maxY: ROOM.maxY + 2,
  minZ: TUNNEL.z - 1,
  maxZ: ROOM_Z + 1,
};

/**
 * The tunnel goes on east past the shell until it opens into a generated cave,
 * so the cave network under spawn is a walk from the room. It stays inside the
 * spawn chunks; `WORLD_SEED` puts a cave within reach.
 * @param {World} world @param {number} seed @returns {number} the last tile dug, or `TUNNEL.maxX`
 */
function carveConnector(world, seed) {
  const { y, z } = TUNNEL;
  for (let x = SHELL.maxX; x < EXPANDED_WORLD_EDGE; x++) {
    if (isCaveTile(seed, x, y, z)) return x - 1;
    writeTile(world, x, y, z, OPEN);
  }
  return EXPANDED_WORLD_EDGE - 1;
}

/** Dig the room, its doorway, the stairs and the tunnel out of the shell. @param {World} world */
function carveSpawnRoom(world) {
  for (let z = SHELL.minZ; z <= SHELL.maxZ; z++) {
    for (let y = SHELL.minY; y <= SHELL.maxY; y++) {
      for (let x = SHELL.minX; x <= SHELL.maxX; x++) {
        writeTile(world, x, y, z, STONE);
      }
    }
  }
  for (let y = ROOM.minY; y <= ROOM.maxY; y++) {
    for (let x = ROOM.minX; x <= ROOM.maxX; x++) {
      writeTile(world, x, y, ROOM_Z, OPEN);
    }
  }
  writeTile(world, DOORWAY.x, DOORWAY.y, DOORWAY.z, OPEN);
  const [top, bottom] = STAIRS;
  writeTile(world, top.x, top.y, top.z, OPEN);
  writeTile(world, bottom.x, bottom.y, bottom.z, OPEN);
  writeTile(world, bottom.x, bottom.y, bottom.z + 1, OPEN);
  for (let x = TUNNEL.minX; x <= TUNNEL.maxX; x++) {
    writeTile(world, x, TUNNEL.y, TUNNEL.z, OPEN);
  }
  for (const { x, y, z, material } of TUNNEL_ORES) {
    writeTile(world, x, y, z, material);
  }
}

/**
 * A host creates this world. The spawn chunks are generated from the seed like
 * any other, then the room is dug into a stone shell and its tunnel joined to
 * the caves.
 * @param {number} [seed]
 */
export function createSpawnRoomWorld(seed = WORLD_SEED) {
  const world = createWorld(EXPANDED_WORLD_EDGE);
  for (let cy = 0; cy < EXPANDED_WORLD_EDGE / CHUNK_EDGE; cy++) {
    for (let cx = 0; cx < EXPANDED_WORLD_EDGE / CHUNK_EDGE; cx++) {
      setChunk(world, cx, cy, generateChunkData(seed, cx, cy));
    }
  }
  carveSpawnRoom(world);
  carveConnector(world, seed);
  world.changes?.clear();
  return world;
}
