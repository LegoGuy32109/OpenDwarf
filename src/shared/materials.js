// @ts-check

import { OPEN, STONE, UNKNOWN } from "./terrain.js";

/**
 * Terrain tile materials. The ids are stored in chunk data and sent on the
 * wire, so they never change. Add new materials at the end. Every material
 * above `OPEN` is solid and blocks movement like stone.
 */
export const COAL = 3;
export const IRON_ORE = 4;
export const GOLD_ORE = 5;
export const LAPIS = 6;
export const REDSTONE = 7;
export const DIAMOND = 8;
export const EMERALD = 9;
/** The largest material id the wire accepts. */
export const MAX_MATERIAL = EMERALD;

/**
 * @typedef {{id:number,name:string,itemKind:string|null,oreFrame:number|null}} MaterialInfo
 * `itemKind` is what mining the tile leaves behind; later tickets map it to
 * the item kind. `oreFrame` is the row in `public/assets/ores.png`, or null
 * when the material is drawn from the floor atlas.
 */

/** @type {readonly MaterialInfo[]} */
export const MATERIALS = Object.freeze([
  { id: UNKNOWN, name: "unknown", itemKind: null, oreFrame: null },
  { id: OPEN, name: "air", itemKind: null, oreFrame: null },
  { id: STONE, name: "stone", itemKind: "stone", oreFrame: null },
  { id: COAL, name: "coal", itemKind: "coal", oreFrame: 0 },
  { id: IRON_ORE, name: "iron ore", itemKind: "iron ore", oreFrame: 3 },
  { id: GOLD_ORE, name: "gold ore", itemKind: "gold ore", oreFrame: 2 },
  { id: LAPIS, name: "lapis", itemKind: "lapis", oreFrame: 6 },
  { id: REDSTONE, name: "redstone", itemKind: "redstone", oreFrame: 7 },
  { id: DIAMOND, name: "diamond", itemKind: "diamond", oreFrame: 1 },
  { id: EMERALD, name: "emerald", itemKind: "emerald", oreFrame: 4 },
]);

/** Number of 16×16 frames in the ore atlas. */
export const ORE_FRAMES = 8;

/** The seven ore materials, in id order. */
export const ORE_MATERIALS = Object.freeze(
  MATERIALS.filter((info) => info.oreFrame !== null).map((info) => info.id),
);

/** @param {number} material @returns {MaterialInfo|null} */
export function materialInfo(material) {
  return MATERIALS[material] ?? null;
}

/** True for an id a chunk may hold. */
/** @param {number} material */
export function isMaterial(material) {
  return Number.isInteger(material) && material >= 0 &&
    material <= MAX_MATERIAL;
}
