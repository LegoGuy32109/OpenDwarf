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
   * Bootstrap only the sender's page and the loaded files of its build. A
   * remote base names one immutable CDN commit; local files use the existing
   * build-path allowlist. API, media and credential-bearing URLs never enter.
   * @param {string} clientUrl @param {unknown} message @param {string} origin
   * @returns {{pages:string[],files:{url:string,commit:string}[],base:string,commit:string}|null}
   */
  function bootstrapPlan(clientUrl, message, origin) {
    const data =
      /** @type {{type?:unknown,page?:unknown,base?:unknown,files?:unknown}|null} */ (message);
    if (
      data?.type !== "cache-build" || typeof data.page !== "string" ||
      typeof data.base !== "string" || !Array.isArray(data.files) ||
      data.files.length > 1024
    ) return null;
    try {
      const client = new URL(clientUrl);
      const page = new URL(data.page);
      const base = new URL(data.base);
      client.hash = page.hash = "";
      const canonical = new URL(client);
      if (/^\/b\/[A-Za-z0-9._~-]+$/.test(canonical.pathname)) {
        canonical.pathname += "/";
      }
      if (
        client.origin !== origin ||
        (page.href !== client.href && page.href !== canonical.href) ||
        page.username || page.password || base.username || base.password ||
        !/^\/(?:b\/[A-Za-z0-9._~-]+(?:\/(?:host|join\/[A-Za-z0-9_-]{8,80})?)?|host|join\/[A-Za-z0-9_-]{8,80})?$/
          .test(page.pathname) ||
        base.search || base.hash
      ) return null;
      const remote = /^\/gh\/[^/]+\/[^/@]+@([0-9a-f]{7,40})\/public\/$/.exec(
        base.pathname,
      );
      const local = base.origin === origin && base.pathname === "/";
      if (!local && (base.origin !== "https://cdn.jsdelivr.net" || !remote)) {
        return null;
      }
      const root = base.href.replace(/public\/$/, "");
      const files = [];
      for (const value of new Set(data.files)) {
        if (typeof value !== "string") continue;
        const url = new URL(value);
        if (url.username || url.password) continue;
        const commit = buildCommitOf(url.href, origin);
        if (
          !commit ||
          (local
            ? commit !== "local"
            : commit !== remote?.[1] || !url.href.startsWith(root) ||
              !/^(public\/(js|assets|css)|src)\//.test(
                url.href.slice(root.length),
              ))
        ) continue;
        files.push({ url: url.href, commit });
      }
      const resolved = new URL(page);
      resolved.searchParams.set("__od_page", "1");
      return {
        pages: [page.href, resolved.href],
        files,
        base: base.href,
        commit: remote?.[1] ?? "local",
      };
    } catch {
      return null;
    }
  }

  /** A mutable branch must still resolve to the build that requested caching. @param {string} html @param {string} base @param {string} commit */
  function matchesBuildPage(html, base, commit) {
    if (commit === "local") return true;
    const config =
      /<script\b[^>]*\bid=["']od-build["'][^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/
        .exec(html);
    const files = /<base\b[^>]*\bhref=["']([^"']+)["']/.exec(html);
    try {
      return !!config && !!files && JSON.parse(config[1]).commit === commit &&
        new URL(files[1]).href === base;
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
    bootstrapPlan,
    matchesBuildPage,
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
 * respondWith(response:Promise<Response>):void,data?:unknown,
 * source?:{url?:string}|null,ports?:MessagePort[]}} WorkerEvent
 */

const PAGE_TIMEOUT_MS = 3000;
/** The cache that lists the commits seen, newest first, for pruning. */
// Not `od-build-…`: pruning deletes every cache with that prefix.
const INDEX_CACHE = "od-recent-builds";
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
      // This browser worker forwards a GET already requested by its client. listen gates cached build/media URLs.
      // fallow-ignore-next-line security-sink
      return store(await fetch(request));
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  }
  const cached = await cache.match(request);
  if (cached) return cached;
  // This browser worker forwards a GET already requested by its client. listen gates cached build/media URLs.
  // fallow-ignore-next-line security-sink
  const response = store(await fetch(request));
  void prune(commit).catch(() => {});
  return response;
}

/** Network first with a short timeout, then the last copy of this page. @param {Request} request */
async function page(request) {
  const cache = await caches.open("od-pages");
  try {
    const response = await Promise.race([
      // This browser worker forwards a GET already requested by its client. listen gates cached build/media URLs.
      // fallow-ignore-next-line security-sink
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("slow")), PAGE_TIMEOUT_MS)
      ),
    ]);
    if (response.ok) void cache.put(request.url, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request.url);
    // This browser worker forwards a GET already requested by its client. listen gates cached build/media URLs.
    // fallow-ignore-next-line security-sink
    return cached ?? fetch(request);
  }
}

/**
 * Media with a `?v=<hash>` never changes: the cache first, filled on a miss, with a `206` for a
 * `Range`. Without a version (a media index) it can change: network first, the cache offline.
 * @param {Request} request
 */
async function media(request) {
  const cache = await caches.open(rules.MEDIA_CACHE);
  const range = request.headers.get("range");
  if (!new URL(request.url).searchParams.has("v")) {
    try {
      // This browser worker forwards a GET already requested by its client. listen gates cached build/media URLs.
      // fallow-ignore-next-line security-sink
      const fresh = await fetch(request);
      if (fresh.ok) void cache.put(request.url, fresh.clone());
      return fresh;
    } catch (error) {
      const kept = await cache.match(request.url);
      if (kept) return rules.answerRange(kept, range);
      throw error;
    }
  }
  const cached = await cache.match(request.url);
  if (cached) return rules.answerRange(cached, range);
  // Fetch the whole file once, so later ranges come from the cache.
  // This browser worker forwards a GET already requested by its client. listen gates cached build/media URLs.
  // fallow-ignore-next-line security-sink
  const response = await fetch(request.url, { mode: "cors" });
  if (response.status !== 200) return response;
  await cache.put(request.url, response.clone());
  return rules.answerRange(response, range);
}

/** Cache the completed first visit, including the remote loading shell's document. @param {NonNullable<ReturnType<typeof rules.bootstrapPlan>>} plan */
async function cacheBootstrap(plan) {
  /** @type {{url:string,response:Response}[]} */
  const documents = [];
  for (const url of plan.pages) {
    // bootstrapPlan restricts this to the sending client's page, with no credentials.
    // fallow-ignore-next-line security-sink
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error("Page unavailable");
    if (
      new URL(url).searchParams.get("__od_page") === "1" &&
      !rules.matchesBuildPage(
        await response.clone().text(),
        plan.base,
        plan.commit,
      )
    ) throw new Error("Build changed during offline preparation");
    documents.push({ url, response });
  }
  const commits = new Set();
  await Promise.all(plan.files.map(async ({ url, commit }) => {
    const cache = await caches.open(rules.buildCacheName(commit));
    if (commit !== "local" && await cache.match(url)) return;
    // bootstrapPlan allows only the sending build's static resource paths.
    // fallow-ignore-next-line security-sink
    const response = await fetch(url, { credentials: "omit" });
    if (!keepable(response)) throw new Error("Build file unavailable");
    await cache.put(url, response);
    commits.add(commit);
  }));
  for (const commit of commits) await prune(commit);
  // Publish pages only after the build they name is available offline.
  const pages = await caches.open("od-pages");
  for (const { url, response } of documents) await pages.put(url, response);
}

/** @param {WorkerScope} scope */
function listen(scope) {
  const own = scope.location.origin;
  scope.addEventListener("install", () => void scope.skipWaiting());
  scope.addEventListener(
    "activate",
    (event) => event.waitUntil(scope.clients.claim()),
  );
  scope.addEventListener("message", (event) => {
    const plan = rules.bootstrapPlan(event.source?.url ?? "", event.data, own);
    if (!plan) return;
    const reply = (/** @type {boolean} */ ok) =>
      event.ports?.[0]?.postMessage({ ok });
    event.waitUntil(
      cacheBootstrap(plan).then(() => reply(true), () => reply(false)),
    );
  });
  scope.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin === own && url.pathname.startsWith("/api/")) return;
    if (rules.isMedia(request.url, own)) {
      event.respondWith(media(request));
    } else if (
      request.mode === "navigate" ||
      (url.origin === own && url.searchParams.get("__od_page") === "1")
    ) {
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
