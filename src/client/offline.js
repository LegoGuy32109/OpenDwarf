// @ts-check

/**
 * Offline play (docs/features/offline.md): whether the browser has a network, and the build's
 * service worker. The worker caches the build, so one earlier visit lets the page load with no
 * network, and the world host then runs as a single-player world.
 */

/**
 * Whether the browser says it has no network. A failed request is still handled where it is made;
 * this decides only what to skip and what the menu shows.
 * @param {{onLine?:boolean}|undefined} [nav]
 */
export function isOffline(nav = globalThis.navigator) {
  return nav?.onLine === false;
}

/**
 * Register the build's service worker at `<base>sw.js` with scope `<base>`. `?sw=0` skips it.
 * Call it after the game starts, so it never delays the first frame. A failure is not an error:
 * the game runs without the worker.
 * @param {{base:string}} build
 * @param {{search?:string,serviceWorker?:Pick<ServiceWorkerContainer,"register">}} [options]
 * @returns {Promise<boolean>} whether a worker was registered
 */
export async function registerWorker(build, options = {}) {
  const container = options.serviceWorker ??
    globalThis.navigator?.serviceWorker;
  const search = options.search ?? globalThis.location?.search ?? "";
  if (!container || new URLSearchParams(search).get("sw") === "0") return false;
  try {
    await container.register(`${build.base}sw.js`, { scope: build.base });
    return true;
  } catch {
    return false;
  }
}
