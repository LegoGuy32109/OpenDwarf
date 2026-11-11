// @ts-check
// Shared constants and shapes for the single-plane implementation tickets.

export const PLAY_Z = 1;
export const FLOOR_Z = 0;
/** The authored room floor alone keeps its tiled/brick appearance. */
export const SPAWN_FLOOR = { minX: 12, maxX: 20, minY: 12, maxY: 18 };
export const THROW_RANGE = 4;
export const THROW_SPEED = 10;
export const ACTION_DEADZONE_PX = 16;
export const MINING_LEASE_TICKS = 10;
export const MINING_REFRESH_TICKS = 4;

/** @typedef {{x:number,y:number}} Direction */
/** @typedef {{down:boolean,aiming:boolean,everAimed:boolean,x:number,y:number,originX:number,originY:number,knobX:number,knobY:number}} ActionGesture */
/** @typedef {{phase:'press'|'move'|'release'|'cancel',x:number,y:number,originX:number,originY:number}} ActionPointerEvent */
/** @typedef {{id:string,kind:string,owner:string,x:number,y:number,z:number,dx:number,dy:number,remaining:number}} ThrownItem */

/** Retained movement-facing, defaulting south for older state. @param {{facing?:Direction}} player @returns {Direction} */
export function facingOf(player) {
  return player.facing ?? { x: 0, y: 1 };
}

/** @returns {ActionGesture} */
export function createActionGesture() {
  return {
    down: false,
    aiming: false,
    everAimed: false,
    x: 0,
    y: 0,
    originX: 0,
    originY: 0,
    knobX: 0,
    knobY: 0,
  };
}
