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

/** @param {BuildConfig} config */
export function createBuild(config) {
  return {
    ...config,
    /** @param {string} pathname */
    route: (pathname) => routeOf(pathname, config.base),
    /** The address of a world's join page. @param {string} session @param {string} origin */
    joinLink: (session, origin) =>
      new URL(`${config.base}join/${session}`, origin).href,
    /** An API URL. @param {string} path such as `presence` or `signal/<id>/host` */
    apiUrl: (path) => `${config.api}/api/v1/${path}`,
  };
}

export const build = createBuild(readBuildConfig());
