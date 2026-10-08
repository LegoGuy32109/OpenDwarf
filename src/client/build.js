// @ts-check

/**
 * The build's own address. The shell fills a `<script id="od-build"
 * type="application/json">` in the page with these fields. Without it the
 * build lives at `/` and calls its own origin, as the Deno server serves it.
 * @typedef {{base:string,api:string,label:string,commit:string}} BuildConfig
 */

/** @type {BuildConfig} */
const DEFAULTS = { base: "/", api: "", label: "", commit: "" };

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ? value : "";
}

/**
 * Parse the build config JSON. A missing or invalid field falls back to the
 * default, so a broken page still loads as a build at `/`.
 * @param {string|null|undefined} source
 * @returns {BuildConfig}
 */
export function parseBuildConfig(source) {
  /** @type {Record<string, unknown>} */
  let raw = {};
  try {
    const parsed = source ? JSON.parse(source) : null;
    if (parsed && typeof parsed === "object") raw = parsed;
  } catch {
    // Keep the defaults.
  }
  let base = text(raw.base);
  // A base is a path on the page's own origin: "/", "/b/test", "/b/test/".
  if (!/^\/([a-zA-Z0-9._~-]+(\/[a-zA-Z0-9._~-]+)*\/?)?$/.test(base)) {
    base = DEFAULTS.base;
  }
  if (!base.endsWith("/")) base += "/";
  let api = DEFAULTS.api;
  try {
    const url = new URL(text(raw.api));
    if (url.protocol === "http:" || url.protocol === "https:") api = url.origin;
  } catch {
    // Same origin.
  }
  return { base, api, label: text(raw.label), commit: text(raw.commit) };
}

/** @param {{getElementById(id:string):{textContent:string|null}|null}|undefined} doc */
export function readBuildConfig(doc = globalThis.document) {
  return parseBuildConfig(doc?.getElementById("od-build")?.textContent);
}

const SESSION = "[a-zA-Z0-9_-]{8,80}";

/**
 * What a pathname asks for under `base`: the bare page starts a world host,
 * `host` lists worlds to join, and `join/<session>` joins one.
 * @param {string} pathname @param {string} base
 * @returns {{kind:"play"}|{kind:"host"}|{kind:"join",session:string}}
 */
export function routeOf(pathname, base) {
  if (!pathname.startsWith(base)) return { kind: "play" };
  const rest = pathname.slice(base.length);
  if (rest === "host") return { kind: "host" };
  const join = new RegExp(`^join/(${SESSION})$`).exec(rest);
  return join ? { kind: "join", session: join[1] } : { kind: "play" };
}

/** The commit the working tree reports: it has no commit of its own. */
export const LOCAL_COMMIT = "local";

/**
 * What a session's host reports about its build, and where a guest on another build goes.
 * @typedef {{commit:string,label:string|null,path:string}} SessionBuild
 */

/**
 * @param {BuildConfig} config
 * @param {string} [origin] the page's origin. A same-origin API must use it in full: the page's
 * `<base href>` points at the build's files on jsDelivr, so a path such as `/api/v1/...` would
 * resolve there.
 */
export function createBuild(
  config,
  origin = globalThis.location?.origin ?? "",
) {
  const commit = config.commit || LOCAL_COMMIT;
  const api = config.api || origin;
  return {
    ...config,
    /** What the F3 panel and the menu show: `Build <sha7> (<label>)`, `Build local` for the working tree. */
    line: `Build ${commit === LOCAL_COMMIT ? commit : commit.slice(0, 7)}${
      config.label && commit !== LOCAL_COMMIT ? ` (${config.label})` : ""
    }`,
    /** The build this page runs, as the shell records it for a session. */
    identity: { commit, label: config.label || null },
    /**
     * Where a guest should join `session`: null when the host runs this build (or the shell
     * named no build), else the join link on the host's build path.
     * @param {unknown} host the `build` of a join response @param {string} session @param {string} origin
     * @param {string} [search] the query to carry over, such as `?relay=1`
     * @returns {string|null}
     */
    joinRedirect: (host, session, origin, search = "") => {
      const target = /** @type {Partial<SessionBuild>|null} */ (host);
      if (
        !target || typeof target.commit !== "string" ||
        typeof target.path !== "string" || target.commit === commit ||
        !/^\/b\/[a-zA-Z0-9._-]+\/$/.test(target.path)
      ) return null;
      return new URL(`${target.path}join/${session}${search}`, origin).href;
    },
    /** @param {string} pathname */
    route: (pathname) => routeOf(pathname, config.base),
    /** The address of a world's join page. @param {string} session @param {string} origin */
    joinLink: (session, origin) =>
      new URL(`${config.base}join/${session}`, origin).href,
    /** An API URL. @param {string} path such as `sessions` or `sessions/<id>/ice` */
    apiUrl: (path) => `${api}/api/v1/${path}`,
    /**
     * A media object's URL on the shell (ADR 0007). The hash makes a changed file a new URL.
     * @param {string} key such as `music/ACelticTale.ogg` @param {string} [hash]
     */
    mediaUrl: (key, hash) =>
      `${api}/media/${key.split("/").map(encodeURIComponent).join("/")}${
        hash ? `?v=${encodeURIComponent(hash)}` : ""
      }`,
  };
}

export const build = createBuild(readBuildConfig());
