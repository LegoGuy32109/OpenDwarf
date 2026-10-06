// @ts-check

/**
 * Terrain lines for the host diagnostics panel (ADR 0005). Each line has one
 * owner, so the chunk unloading and the terrain sync work stay apart.
 */

/**
 * World chunks the host holds. Chunk unloading adds pinned chunks and edit
 * diff totals here.
 * @param {import('../shared/terrain.js').TerrainStore} world
 */
export function worldTerrainLine(world) {
  return `Chunks ${world.chunks.size}`;
}

/**
 * Remembered terrain the host keeps for each joining player, as chunk counts.
 * Empty without joining players.
 * @param {{rememberedChunks:number}[]} connections
 */
export function rememberedLine(connections) {
  if (!connections.length) return "";
  return `Remembered ${
    connections.map((connection) => connection.rememberedChunks).join(" ")
  }`;
}
