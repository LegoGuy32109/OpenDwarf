// @ts-check

/** How often a host on main reads the shell's status. */
export const CHECK_MS = 120_000;

/**
 * Tell a world host that main has moved on. Only a host whose page was served as
 * `main` checks: a guest follows the host's build, and a branch or commit preview is
 * pinned on purpose. The clock, `fetch`, and the document come in so a test can fake them.
 * @param {object} options
 * @param {boolean} options.host this tab hosts the world
 * @param {{label:string|null,commit:string}} options.build the build this page runs
 * @param {string} options.url the shell's status address
 * @param {()=>void} options.onNewer called once, when main's commit differs
 * @param {typeof fetch} [options.fetch]
 * @param {{hidden:boolean,addEventListener:Function,removeEventListener:Function}} [options.document]
 * @param {(fn:()=>void,ms:number)=>ReturnType<typeof setInterval>} [options.setInterval]
 * @param {(id:ReturnType<typeof setInterval>)=>void} [options.clearInterval]
 * @returns {{stop:()=>void,check:()=>Promise<boolean>}}
 */
export function startUpdateCheck(options) {
  const doc = options.document ?? globalThis.document;
  const load = options.fetch ?? globalThis.fetch.bind(globalThis);
  const every = options.setInterval ?? globalThis.setInterval.bind(globalThis);
  const cancel = options.clearInterval ??
    globalThis.clearInterval.bind(globalThis);
  if (
    !options.host || options.build.label !== "main" || !options.build.commit
  ) {
    return { stop() {}, check: () => Promise.resolve(false) };
  }
  let found = false;
  /** @type {ReturnType<typeof setInterval>|undefined} */
  let timer;

  /** Read the status once. A failed request, or a reply with no commit, changes nothing. */
  async function check() {
    if (found) return true;
    try {
      const response = await load(options.url, { cache: "no-store" });
      if (!response.ok) return false;
      const status = await response.json();
      const commit = status?.main?.commit;
      if (
        typeof commit !== "string" || !commit || commit === options.build.commit
      ) {
        return false;
      }
      found = true;
      options.onNewer();
      stop();
      return true;
    } catch {
      return false;
    }
  }

  const onVisible = () => {
    if (!doc.hidden) void check();
  };

  function stop() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    doc.removeEventListener("visibilitychange", onVisible);
  }

  timer = every(() => void check(), CHECK_MS);
  doc.addEventListener("visibilitychange", onVisible);
  return { stop, check };
}
