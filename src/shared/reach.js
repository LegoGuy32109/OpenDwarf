// @ts-check
// Reach for mining and placing: the 3x3x3 around an entity, open path and
// sight (ADR 0009). The contract commit leaves these permissive or empty; the
// reach ticket fills them in.

/** @typedef {import('./world.js').World} World */
/** @typedef {import('./world.js').Player} Player */
/** @typedef {{x:number,y:number,z:number}} Tile */
/** @typedef {"mine"|"place"|"pickup"|"shop"|null} InteractAction */

/** The cursor outline color and opacity, and the dimmed icon's opacity. */
export const CURSOR_COLOR = "#ffb833";
export const CURSOR_OPACITY = 0.6;
export const CURSOR_ICON_DIM = 0.35;

/**
 * The path rule alone: `tile` lies in the 3x3x3 around the entity's center
 * tile and an open path leads to it (ADR 0009). No sight check.
 * @param {World} _world @param {Player} _player @param {Tile} _tile
 * @returns {boolean}
 */
export function pathReach(_world, _player, _tile) {
  return false;
}

/**
 * The full rule: in the path rule and seen now. `sees` answers for the
 * entity's current sight (the host's per-peer visible set, or the host's own
 * `scene.visibility`).
 * @param {World} world @param {Player} player @param {Tile} tile
 * @param {(tile:Tile) => boolean} sees
 * @returns {boolean}
 */
export function inReach(world, player, tile, sees) {
  return pathReach(world, player, tile) && sees(tile);
}

/**
 * What interact would do on `tile` for this entity now, or null when it would
 * do nothing: the order is pickup, shop, place, mine, as in placing.md.
 * @param {World} _world @param {Player} _player @param {Tile} _tile
 * @param {(tile:Tile) => boolean} _sees
 * @returns {InteractAction}
 */
export function interactPreview(_world, _player, _tile, _sees) {
  return null;
}
