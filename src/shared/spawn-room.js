// @ts-check

import { buildWorld } from "./world-builder.js";
import { roomRecipe } from "./world-recipes.js";
import { COAL, GOLD_ORE, IRON_ORE } from "./materials.js";
import { WORLD_SEED } from "./generation.js";

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

/** Construct the standard room through the shared builder. @param {number} [seed] */
export function createSpawnRoomWorld(seed = WORLD_SEED) {
  return buildWorld(roomRecipe(seed, { npc: false })).world;
}
