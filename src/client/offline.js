// @ts-check

/**
 * Offline play (docs/features/offline.md): whether the browser has a network, and the build's
 * service worker. The worker caches the build, so one earlier visit lets the page load with no
 * network, and the world host then runs as a single-player world.
 */

/** Retain completed URLs even if later audio requests fill the timing buffer. */
const loadedResources = new Set(
  globalThis.performance?.getEntriesByType("resource").map((entry) =>
    entry.name
  ),
);
/** @type {PerformanceObserver|null} */
let resourceObserver = null;
try {
  if (
    globalThis.document && typeof PerformanceObserver === "function" &&
    PerformanceObserver.supportedEntryTypes?.includes("resource")
  ) {
    resourceObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) loadedResources.add(entry.name);
    });
    resourceObserver.observe({ type: "resource", buffered: true });
  }
} catch {
  resourceObserver?.disconnect();
  resourceObserver = null;
}

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
 * @returns {Promise<boolean>} whether registration and first-visit preparation succeeded
 */
export async function registerWorker(build, options = {}) {
  const container = options.serviceWorker ??
    globalThis.navigator?.serviceWorker;
  const search = options.search ?? globalThis.location?.search ?? "";
  if (!container || new URLSearchParams(search).get("sw") === "0") {
    resourceObserver?.disconnect();
    loadedResources.clear();
    return false;
  }
  try {
    // A bare preview entry is outside its worker's slash-terminated scope.
    // Canonicalize before registration so activation can claim this client.
    if (
      build.base !== "/" &&
      globalThis.location?.pathname === build.base.slice(0, -1)
    ) {
      const page = new URL(location.href);
      page.pathname = build.base;
      history.replaceState(history.state, "", page.href);
    }
    const registration = await container.register(`${build.base}sw.js`, {
      scope: build.base,
    });
    await cacheFirstVisit(registration);
    return true;
  } catch {
    return false;
  } finally {
    resourceObserver?.disconnect();
    loadedResources.clear();
  }
}

/** Wait for the textures and the first world frame without delaying either. */
async function worldReady() {
  const doc = globalThis.document;
  if (!doc) return;
  const ready = () => doc.querySelector("canvas[data-ready=true]") !== null;
  if (ready()) return;
  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!ready()) return;
      observer.disconnect();
      resolve(undefined);
    });
    observer.observe(doc.documentElement, { attributes: true, subtree: true });
  });
}

/** The registered worker, including the first installation before it is active. @param {ServiceWorkerRegistration} registration */
async function activeWorker(registration) {
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return registration.active;
  await new Promise((resolve, reject) => {
    const changed = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        worker.removeEventListener("statechange", changed);
        if (worker.state === "redundant") reject(new Error("Worker discarded"));
        else resolve(undefined);
      }
    };
    worker.addEventListener("statechange", changed);
    changed();
  });
  return worker;
}

/**
 * The first navigation and module/texture requests precede worker control.
 * Ask the worker to keep them too, so the next load can be offline.
 * @param {ServiceWorkerRegistration} registration
 */
async function cacheFirstVisit(registration) {
  if (!globalThis.document) return;
  const [worker] = await Promise.all([
    activeWorker(registration),
    worldReady(),
  ]);
  if (!worker) return;
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (/** @type {Error|undefined} */ error) => {
      clearTimeout(timer);
      channel.port1.close();
      if (error) reject(error);
      else resolve(undefined);
    };
    const timer = setTimeout(
      () => finish(new Error("Offline cache timed out")),
      30_000,
    );
    channel.port1.onmessage = (event) =>
      finish(
        event.data?.ok === true
          ? undefined
          : new Error("Offline cache incomplete"),
      );
    channel.port1.onmessageerror = () =>
      finish(new Error("Invalid offline cache reply"));
    for (const entry of resourceObserver?.takeRecords() ?? []) {
      loadedResources.add(entry.name);
    }
    for (const entry of performance.getEntriesByType("resource")) {
      loadedResources.add(entry.name);
    }
    try {
      worker.postMessage({
        type: "cache-build",
        page: location.href,
        base: document.baseURI,
        files: [...loadedResources],
      }, [channel.port2]);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      channel.port2.close();
    }
  });
}
