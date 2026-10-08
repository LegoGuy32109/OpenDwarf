// @ts-check

/**
 * The stick step rule the bag, the pickup grid, and the shop share. A stick
 * steps once when it leaves center. A new direction steps only `STEP_GAP_MS`
 * after the last step, so a sweep across a diagonal does not step twice. A held
 * direction repeats after `REPEAT_DELAY_MS`, then every `STEP_GAP_MS`. The
 * D-pad and IJKL do not use it.
 */

/** The least time between two steps. */
export const STEP_GAP_MS = 200;
/** How long a direction held after its first step waits before it repeats. */
export const REPEAT_DELAY_MS = 400;

/** @typedef {{x:number,y:number}} Direction */

export function createStickStepper() {
  let key = "";
  let lastStep = -Infinity;
  let nextAt = 0;
  let repeating = false;
  let waitForCenter = false;

  function reset() {
    key = "";
    lastStep = -Infinity;
    repeating = false;
  }

  return {
    /**
     * Feed the stick direction each frame. Returns the direction to step in, or
     * null when this frame does not step.
     * @param {Direction} direction @param {number} now
     * @returns {Direction|null}
     */
    update(direction, now) {
      const dx = Math.sign(direction.x);
      const dy = Math.sign(direction.y);
      if (!dx && !dy) {
        reset();
        waitForCenter = false;
        return null;
      }
      if (waitForCenter) return null;
      const next = `${dx},${dy}`;
      if (next !== key) {
        key = next;
        repeating = false;
        nextAt = lastStep + STEP_GAP_MS;
      }
      if (now < nextAt) return null;
      lastStep = now;
      nextAt = now + (repeating ? STEP_GAP_MS : REPEAT_DELAY_MS);
      repeating = true;
      return { x: dx, y: dy };
    },
    /** Ignore the stick until it returns to center, such as an aim that opened a panel. */
    releaseFirst() {
      reset();
      waitForCenter = true;
    },
  };
}
