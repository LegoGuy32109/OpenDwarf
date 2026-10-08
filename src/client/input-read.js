// @ts-check

/**
 * Reads the current input as plain values: the walk direction, the look and aim
 * direction, and the shop panel's row direction. It owns no state and binds no
 * events (`input.js` does); `interact.js`, `panels.js`, and `loop.js` read here.
 */

/** @typedef {import('./context.js').Context} Context */

/** @param {number} x @param {number} y @param {number} deadzone */
export function stickDirection(x, y, deadzone) {
  if (Math.hypot(x, y) < deadzone) return { x: 0, y: 0 };
  const octant = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  const directions = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  const [dx, dy] = directions[(octant + 8) % 8];
  return { x: dx, y: dy };
}

/** The walk direction from the stick, the D-pad or left stick, or the keys. @param {Context} ctx @returns {{x:number,y:number}} */
export function inputDirection(ctx) {
  const { held, pressed } = ctx;
  if (ctx.joystick.x || ctx.joystick.y) return ctx.joystick;
  // The D-pad and left stick steer the open inventory panel instead of walking.
  if (!ctx.bag.isOpen && (ctx.gamepadDirection.x || ctx.gamepadDirection.y)) {
    return ctx.gamepadDirection;
  }
  return {
    x: Number(held.has("KeyF") || pressed.has("KeyF")) -
      Number(held.has("KeyS") || pressed.has("KeyS")),
    y: Number(held.has("KeyD") || pressed.has("KeyD")) -
      Number(held.has("KeyE") || pressed.has("KeyE")),
  };
}

/** The look stick, IJKL, and controller camera input combined. @param {Context} ctx */
export function lookInput(ctx) {
  const controllerCamera = ctx.scene.chatOpen || ctx.scene.menu
    ? { x: 0, y: 0 }
    : ctx.gamepadCamera;
  return {
    x: Number(ctx.held.has("KeyL")) - Number(ctx.held.has("KeyJ")) +
      ctx.cameraStick.x + controllerCamera.x,
    y: Number(ctx.held.has("KeyK")) - Number(ctx.held.has("KeyI")) +
      ctx.cameraStick.y + controllerCamera.y,
  };
}

/** IJKL and the on-screen look stick, without the gamepad sticks, which step the panels by the stick step rule. @param {Context} ctx */
export function panelLookInput(ctx) {
  return {
    x: Number(ctx.held.has("KeyL")) - Number(ctx.held.has("KeyJ")) +
      ctx.cameraStick.x,
    y: Number(ctx.held.has("KeyK")) - Number(ctx.held.has("KeyI")) +
      ctx.cameraStick.y,
  };
}

/** The aim input, held still while the shop panel uses the look controls. @param {Context} ctx */
export function cameraInput(ctx) {
  return ctx.shop.isOpen() ? { x: 0, y: 0 } : lookInput(ctx);
}

/** Up or down on the on-screen look stick or the D-pad, for the shop panel. IJKL act on key presses, and the gamepad sticks use `shop.steerStick`. @param {Context} ctx */
export function shopDirection(ctx) {
  return stickDirection(ctx.cameraStick.x, ctx.cameraStick.y, 0.18).y ||
    ctx.gamepadDpad.y;
}
