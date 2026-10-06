// @ts-check

/**
 * Terrain lines for the host diagnostics panel (ADR 0005). Each line has one
 * owner, so the chunk unloading and the terrain sync work stay apart.
 */

/**
 * World chunks the host holds. Loaded chunks, pinned chunks, and edit diff
 * totals (ADR 0005).
 * @param {import('../shared/terrain.js').TerrainStore} world
 */
export function worldTerrainLine(world) {
  let editTiles = 0;
  for (const diff of world.edits?.values() ?? []) editTiles += diff.size;
  return `Chunks ${world.chunks.size}  pinned ${world.pinned?.size ?? 0}` +
    `  edits ${world.edits?.size ?? 0} chunks ${editTiles} tiles`;
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
