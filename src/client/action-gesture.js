// @ts-check
import {
  ACTION_DEADZONE_PX,
  createActionGesture,
} from "../shared/single-plane.js";
import { stickDirection } from "./input-values.js";

/** @typedef {import('../shared/single-plane.js').ActionGesture} Gesture */

/** Start a fresh press. @param {Gesture} gesture @param {number} [x] @param {number} [y] */
export function armGesture(gesture, x = 0, y = 0) {
  Object.assign(gesture, createActionGesture(), {
    down: true,
    originX: x,
    originY: y,
  });
}

/** Aim from the press origin in CSS pixels. @param {Gesture} gesture @param {number} x @param {number} y */
export function dragGesture(gesture, x, y) {
  const dx = x - gesture.originX;
  const dy = y - gesture.originY;
  aimGesture(
    gesture,
    Math.hypot(dx, dy) <= ACTION_DEADZONE_PX
      ? { x: 0, y: 0 }
      : stickDirection(dx, dy, ACTION_DEADZONE_PX),
  );
  gesture.knobX = dx;
  gesture.knobY = dy;
}

/** Neutral after aiming remembers cancellation; leaving center may aim again. @param {Gesture} gesture @param {{x:number,y:number}} direction */
export function aimGesture(gesture, direction) {
  if (!gesture.down) return;
  gesture.x = direction.x;
  gesture.y = direction.y;
  gesture.aiming = Boolean(direction.x || direction.y);
  gesture.everAimed ||= gesture.aiming;
}

/** Release consumes the gesture exactly once. @param {Gesture} gesture */
export function releaseGesture(gesture) {
  const result = !gesture.down
    ? "none"
    : gesture.aiming
    ? "throw"
    : gesture.everAimed
    ? "cancel"
    : "tap";
  const direction = { x: gesture.x, y: gesture.y };
  Object.assign(gesture, createActionGesture());
  return { result, direction };
}

/** Interruptions never execute a release action. @param {Gesture} gesture */
export function cancelGesture(gesture) {
  Object.assign(gesture, createActionGesture());
}
