// @ts-check
// Independent schemas for player control commands.
import {
  counter,
  finite,
  identifier,
  MAX_COORD,
  record,
} from "./wire-parse.js";
import { WORLD_TOP } from "./terrain.js";
import { isItemKind } from "./items.js";

/** @param {unknown} value @param {number} min @param {number} max */
const integer = (value, min, max) =>
  Number.isInteger(value) && finite(value, min, max);
/** @param {Record<string,unknown>} value */
function coordinates(value) {
  return integer(value.x, -MAX_COORD, MAX_COORD) &&
    integer(value.y, -MAX_COORD, MAX_COORD) && integer(value.z, 0, WORLD_TOP);
}
/** @param {Record<string,unknown>} value */
function move(value) {
  return counter(value.sequence) && integer(value.dx, -1, 1) &&
    integer(value.dy, -1, 1);
}
/** @param {unknown} value @param {number} length */
const text = (value, length) =>
  typeof value === "string" && value.length <= length;
/** A spoken sale names one ore kind or all ore. @param {unknown} value */
const saleRequest = (value) =>
  record(value) && (value.all === true || identifier(value.kind, 24));
/** @type {Record<string,(value:Record<string,unknown>)=>boolean>} */
const RULES = {
  input: (value) =>
    move(value) &&
    (value.sprint === undefined || typeof value.sprint === "boolean"),
  move,
  cancel: (value) => counter(value.sequence),
  mine: coordinates,
  place: coordinates,
  "mine-cancel": () => true,
  pickup: (value) => text(value.kind, 24) && coordinates(value),
  hold: (value) => isItemKind(value.kind),
  talk: (value) =>
    identifier(value.npc) && identifier(value.choice, 24) &&
    (value.sale === undefined || saleRequest(value.sale)),
  mode: (value) => value.mode === "entity" || value.mode === "master",
  typing: (value) => typeof value.typing === "boolean",
  message: (value) => text(value.text, 120),
  nick: (value) => text(value.name, 24),
  ping: (value) => identifier(value.id),
  pong: (value) => identifier(value.id),
  resync: () => true,
};
/** Control commands have small, independent schemas. No number coercion.
 * @param {unknown} value @returns {Record<string,unknown>|null}
 */
export function decodeControl(value) {
  if (
    !record(value) || typeof value.type !== "string" ||
    !Object.hasOwn(RULES, value.type)
  ) return null;
  return RULES[value.type](value) ? value : null;
}
