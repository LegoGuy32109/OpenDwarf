// @ts-check

/**
 * A build's service worker (ADR 0007, docs/features/offline.md). The shell serves a one-line
 * loader that imports this file, so a caching change is a push. It is a classic script, because
 * `importScripts` loads it. The rules that need no worker hang on `globalThis.odSw`, and a unit
 * test loads this same file outside a worker, where the worker half stays off.
 */
const rules = (function () {
  const BUILD_PREFIX = "od-build-";
  const MEDIA_CACHE = "od-media";
  const KEEP_BUILDS = 3;

  /** The cache that holds one build's files. @param {string} commit */
  function buildCacheName(commit) {
    return `${BUILD_PREFIX}${commit || "local"}`;
  }

  /**
   * The commit a jsDelivr build URL names, `local` for the local build's own paths, else null.
   * @param {string} url @param {string} origin the worker's own origin
   * @returns {string|null}
   */
  function buildCommitOf(url, origin) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.origin === origin) {
      return /^\/(js|src|assets|css)\//.test(parsed.pathname) ? "local" : null;
    }
    if (parsed.hostname !== "cdn.jsdelivr.net") return null;
    const match = /^\/gh\/[^/]+\/[^/@]+@([0-9a-f]{7,40})\//.exec(
      parsed.pathname,
    );
    return match ? match[1] : null;
  }

  /** Whether a URL is a media file. @param {string} url @param {string} origin */
  function isMedia(url, origin) {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && parsed.pathname.startsWith("/media/");
    } catch {
      return false;
    }
  }

  /**
   * Which `od-build-*` caches to delete: all but the newest `KEEP_BUILDS`, and never the one in
   * use. `recent` lists commits, newest first. A cache not in the list counts as oldest.
   * @param {string[]} names every cache name @param {string[]} recent commits, newest first
   * @param {string} current the commit this worker serves
   */
  function buildCachesToDelete(names, recent, current) {
    const builds = names.filter((name) => name.startsWith(BUILD_PREFIX));
    const order = [current, ...recent.filter((commit) => commit !== current)]
      .map(buildCacheName);
    const keep = new Set(order.slice(0, KEEP_BUILDS));
    return builds.filter((name) => !keep.has(name));
  }

  /**
   * Read a `Range` header against a body of `size` bytes.
   * @param {string|null} header @param {number} size
   * @returns {{start:number,end:number}|"unsatisfiable"|null} null when there is no usable range
   */
  function parseRange(header, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
    if (!match || (match[1] === "" && match[2] === "")) return null;
    let start;
    let end;
    if (match[1] === "") {
      const length = Number(match[2]);
      if (length === 0) return "unsatisfiable";
      start = Math.max(0, size - length);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (start >= size || start > end) return "unsatisfiable";
    return { start, end };
  }

  /**
   * Answer a request from a cached whole file. A `Range` request gets `206` with the bytes and
   * `Content-Range`; Safari's audio player needs that. No `Range` gets the file as it is.
   * @param {Response} cached @param {string|null} rangeHeader
   * @returns {Promise<Response>}
   */
  async function answerRange(cached, rangeHeader) {
    if (!rangeHeader) return cached;
    const body = await cached.arrayBuffer();
    const size = body.byteLength;
    const range = parseRange(rangeHeader, size);
    const headers = new Headers(cached.headers);
    headers.set("accept-ranges", "bytes");
    if (range === null) {
      headers.set("content-length", String(size));
      return new Response(body, { status: 200, headers });
    }
    if (range === "unsatisfiable") {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const slice = body.slice(range.start, range.end + 1);
    headers.set(
      "content-range",
      `bytes ${range.start}-${range.end}/${size}`,
    );
    headers.set("content-length", String(slice.byteLength));
    return new Response(slice, { status: 206, headers });
  }

  return {
    BUILD_PREFIX,
    MEDIA_CACHE,
    KEEP_BUILDS,
    buildCacheName,
    buildCommitOf,
    isMedia,
    buildCachesToDelete,
    parseRange,
    answerRange,
  };
})();
/** @type {Record<string, unknown>} */ (globalThis).odSw = rules;

/**
 * @typedef {{skipWaiting():Promise<void>,clients:{claim():Promise<void>},location:{origin:string},
 * addEventListener(type:string,listener:(event:WorkerEvent)=>void):void}} WorkerScope
 * @typedef {{request:Request,waitUntil(work:Promise<unknown>):void,
 * respondWith(response:Promise<Response>):void}} WorkerEvent
 */

const PAGE_TIMEOUT_MS = 3000;
/** The cache that lists the commits seen, newest first, for pruning. */
const INDEX_CACHE = "od-build-index";
/** Fixed key for the list inside `INDEX_CACHE`. */
const INDEX_KEY = "https://od.invalid/recent";

/** Keep the newest three build caches. @param {string} commit */
async function prune(commit) {
  const index = await caches.open(INDEX_CACHE);
  const stored = await index.match(INDEX_KEY);
  /** @type {string[]} */
  const recent = stored ? await stored.json().catch(() => []) : [];
  const next = [commit, ...recent.filter((entry) => entry !== commit)]
    .slice(0, rules.KEEP_BUILDS);
  await index.put(INDEX_KEY, Response.json(next));
  for (
    const name of rules.buildCachesToDelete(await caches.keys(), next, commit)
  ) await caches.delete(name);
}

/** A response worth keeping: a good one, or an opaque `no-cors` one such as a stylesheet. @param {Response} response */
const keepable = (response) => response.ok || response.type === "opaque";

/** Cache first for a build file; the local build goes network first so edits show. @param {Request} request @param {string} commit */
async function buildFile(request, commit) {
  const cache = await caches.open(rules.buildCacheName(commit));
  /** @param {Response} response */
  const store = (response) => {
    if (keepable(response)) void cache.put(request, response.clone());
    return response;
  };
  if (commit === "local") {
    try {
      return store(await fetch(request));
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  }
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = store(await fetch(request));
  void prune(commit).catch(() => {});
  return response;
}

/** Network first with a short timeout, then the last copy of this page. @param {Request} request */
async function page(request) {
  const cache = await caches.open("od-pages");
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("slow")), PAGE_TIMEOUT_MS)
      ),
    ]);
    if (response.ok) void cache.put(request.url, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request.url);
    return cached ?? fetch(request);
  }
}

/** Media: the cache first, filled on a miss, with a `206` for a `Range`. @param {Request} request */
async function media(request) {
  const cache = await caches.open(rules.MEDIA_CACHE);
  const range = request.headers.get("range");
  const cached = await cache.match(request.url);
  if (cached) return rules.answerRange(cached, range);
  // Fetch the whole file once, so later ranges come from the cache.
  const response = await fetch(request.url, { mode: "cors" });
  if (response.status !== 200) return response;
  await cache.put(request.url, response.clone());
  return rules.answerRange(response, range);
}

/** @param {WorkerScope} scope */
function listen(scope) {
  const own = scope.location.origin;
  scope.addEventListener("install", () => void scope.skipWaiting());
  scope.addEventListener(
    "activate",
    (event) => event.waitUntil(scope.clients.claim()),
  );
  scope.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin === own && url.pathname.startsWith("/api/")) return;
    if (rules.isMedia(request.url, own)) {
      event.respondWith(media(request));
    } else if (request.mode === "navigate") {
      event.respondWith(page(request));
    } else {
      const commit = rules.buildCommitOf(request.url, own);
      if (commit) event.respondWith(buildFile(request, commit));
    }
  });
}

if ("importScripts" in globalThis) {
  listen(/** @type {WorkerScope} */ (/** @type {unknown} */ (globalThis)));
}
