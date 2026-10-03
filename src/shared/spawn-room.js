// @ts-check

import { createWorld, EXPANDED_WORLD_EDGE } from "./world.js";
import {
  CHUNK_EDGE,
  createChunkData,
  OPEN,
  setChunk,
  STONE,
  writeTile,
} from "./terrain.js";

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

/** Dig the room, its doorway, the stairs and the tunnel out of solid stone. @param {World} world */
function carveSpawnRoom(world) {
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
}

/** A host creates this world. Everything is solid stone except the carved spaces. */
export function createSpawnRoomWorld() {
  const world = createWorld(EXPANDED_WORLD_EDGE);
  for (let cy = 0; cy < EXPANDED_WORLD_EDGE / CHUNK_EDGE; cy++) {
    for (let cx = 0; cx < EXPANDED_WORLD_EDGE / CHUNK_EDGE; cx++) {
      setChunk(world, cx, cy, createChunkData(STONE));
    }
  }
  carveSpawnRoom(world);
  world.changes?.clear();
  return world;
}
