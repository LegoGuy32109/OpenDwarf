// @ts-check

/**
 * The background clock. A hidden tab gets no animation frames, so the world
 * host would stop ticking and every guest would freeze. While the document is
 * hidden, this clock calls `onTick` every `intervalMs`. A dedicated Worker
 * keeps the time, because Worker timers are not slowed in hidden tabs the way
 * page timers are. The Worker comes from an inline Blob URL: the build's files
 * load from another origin, and a worker script must be same-origin.
 */

/** The longest step, in ms, a visible frame may spend on ticks. */
export const VISIBLE_CATCH_UP_MS = 250;
/** The longest step, in ms, a background tick may catch up. The rest is dropped. */
export const BACKGROUND_CATCH_UP_MS = 2000;

/**
 * The time a step may spend on ticks.
 * @param {number} elapsedMs Time since the last step.
 * @param {boolean} hidden
 */
export function catchUpMs(elapsedMs, hidden) {
  return Math.min(
    hidden ? BACKGROUND_CATCH_UP_MS : VISIBLE_CATCH_UP_MS,
    elapsedMs,
  );
}

/**
 * @typedef {object} ClockWorker
 * @property {(() => void)|null} onmessage
 * @property {(() => void)|null} onerror
 * @property {() => void} terminate
 */

/**
 * @typedef {object} ClockEnv
 * @property {{hidden: boolean, addEventListener: (type: string, fn: () => void) => void, removeEventListener: (type: string, fn: () => void) => void}} document
 * @property {(new (url: string) => ClockWorker)|undefined} [Worker] The Worker constructor, if the browser has one.
 * @property {{createObjectURL: (blob: unknown) => string, revokeObjectURL: (url: string) => void}} URL
 * @property {new (parts: string[], options: {type: string}) => unknown} Blob
 * @property {(fn: () => void, ms: number) => number} [setInterval]
 * @property {(id: number) => void} [clearInterval]
 */

/**
 * @param {() => void} onTick
 * @param {number} intervalMs
 * @param {ClockEnv} [env]
 */
export function createTickClock(
  onTick,
  intervalMs,
  env = /** @type {ClockEnv} */ (/** @type {unknown} */ (globalThis)),
) {
  /** @type {ClockWorker|null} */
  let worker = null;
  /** @type {number|null} */
  let timer = null;
  let running = false;

  /** Start the interval fallback when no Worker can be made. */
  function startInterval() {
    timer = (env.setInterval ?? globalThis.setInterval)(onTick, intervalMs);
  }

  function start() {
    if (running) return;
    running = true;
    try {
      if (typeof env.Worker !== "function") throw new Error("no Worker");
      const source = `setInterval(() => postMessage(0), ${
        Number(intervalMs)
      });`;
      const url = env.URL.createObjectURL(
        new env.Blob([source], { type: "text/javascript" }),
      );
      worker = new env.Worker(url);
      env.URL.revokeObjectURL(url);
      worker.onmessage = () => onTick();
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        if (running) startInterval();
      };
    } catch {
      worker = null;
      startInterval();
    }
  }

  function stop() {
    running = false;
    worker?.terminate();
    worker = null;
    if (timer !== null) (env.clearInterval ?? globalThis.clearInterval)(timer);
    timer = null;
  }

  function sync() {
    if (env.document.hidden) start();
    else stop();
  }

  env.document.addEventListener("visibilitychange", sync);
  sync();

  return {
    get running() {
      return running;
    },
    stop() {
      stop();
      env.document.removeEventListener("visibilitychange", sync);
    },
  };
}
