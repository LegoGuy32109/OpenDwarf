// @ts-check

import { TICK_MS } from "./world.js";

/** Sprint empties a full stamina reserve in this many seconds. */
export const SPRINT_SECONDS = 6;
/** A reserve refills from empty in this many seconds while not sprinting. */
export const REFILL_SECONDS = 12;

/**
 * @typedef {object} Stamina
 * @property {number} value reserve from 0 to 1
 * @property {boolean} sprint whether the entity is sprinting now
 * @property {boolean} locked sprint stays off until the reserve is full again
 */

/** @returns {Stamina} */
export function createStamina() {
  return { value: 1, sprint: false, locked: false };
}

/** Turn sprint on or off. Sprint cannot start without stamina or while locked. */
/** @param {Stamina} stamina @param {boolean} on */
export function setSprint(stamina, on) {
  stamina.sprint = on && !stamina.locked && stamina.value > 0;
}

/** Advance the reserve by one simulation tick. */
/** @param {Stamina} stamina @param {number} [seconds] */
export function stepStamina(stamina, seconds = TICK_MS / 1000) {
  if (stamina.sprint) {
    stamina.value = Math.max(0, stamina.value - seconds / SPRINT_SECONDS);
    if (stamina.value === 0) {
      stamina.sprint = false;
      stamina.locked = true;
    }
    return;
  }
  stamina.value = Math.min(1, stamina.value + seconds / REFILL_SECONDS);
  if (stamina.value === 1) stamina.locked = false;
}
