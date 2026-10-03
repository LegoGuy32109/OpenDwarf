// The admin dashboard: a read-only view of the shell. It only reads `/api/v1` and holds no
// credential, so it works when every build is broken. Terms follow CONTEXT.md.
/**
 * @typedef {{ id: string, buildCommit: string, label: string | null, started: number,
 *   playerCount: number }} LiveSession
 * @typedef {{ id: string }} SessionId
 * @typedef {{ name: string, kind: string, target: string, commit: string | null }} LabelRow
 * @typedef {{ name: string, commit: string, main: boolean, labels: string[],
 *   pull: { number: number, title: string, url: string } | null }} BranchRow
 * @typedef {{ branches: BranchRow[], pullsAvailable: boolean }} BuildIndex
 * @typedef {{ commit: string, label: string, at: number, note: string }} PromotionRow
 * @typedef {{ commit: string, denoRevision: string, at: number, note: string }} DeployRow
 * @typedef {{ promotions: PromotionRow[] }} Promotions
 * @typedef {{ deploys: DeployRow[] }} Deploys
 * @typedef {{ sessions: LiveSession[] }} Sessions
 * @typedef {{ telemetry: TelemetryRow[] }} Telemetry
 * @typedef {{ main: PromotionRow | null, labels: LabelRow[], sessions: LiveSession[] }} Status
 * @typedef {{ at: number, role: string, route: string, players: number | null,
 *   frameMeanMs: number | null, frameMaxMs: number | null, rttMs: number | null,
 *   test: boolean }} TelemetryRow
 */

const REFRESH_MS = 15_000;
const TELEMETRY_SESSIONS = 8;
const TELEMETRY_ROWS = 24;

/**
 * @param {string} path
 * @template T
 * @returns {Promise<T>}
 */
async function read(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return /** @type {Promise<T>} */ (response.json());
}

/**
 * @param {string} tag
 * @param {Record<string, string>} [attributes]
 * @param {(string | Node)[]} [children]
 */
function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/** @param {string} text @param {string} href */
const link = (text, href) => el("a", { href }, [text]);

/** @param {number | null | undefined} at */
function when(at) {
  return at
    ? new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "";
}

/** @param {number} ms */
function age(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48
    ? `${hours}h ${minutes % 60}m`
    : `${Math.floor(hours / 24)}d`;
}

/** @param {number | null | undefined} value @param {string} [unit] */
const measure = (value, unit = "") =>
  value === null || value === undefined ? "–" : `${value}${unit}`;

/**
 * A table whose cells carry their column name for the phone layout.
 * @param {string[]} columns
 * @param {(string | Node)[][]} rows
 */
function table(columns, rows) {
  const head = el("tr", {}, columns.map((name) => el("th", {}, [name])));
  const body = rows.map((cells) =>
    el(
      "tr",
      {},
      cells.map((cell, index) =>
        el("td", { "data-label": columns[index] }, [cell])
      ),
    )
  );
  return el("div", { class: "scroll" }, [
    el("table", {}, [el("thead", {}, [head]), el("tbody", {}, body)]),
  ]);
}

/**
 * Fill one section: its rows, an empty state, or the error that stopped it.
 * @param {string} id
 * @param {unknown} value A table node, or null for the empty state.
 * @param {string} empty
 */
function show(id, value, empty) {
  const target = /** @type {HTMLElement} */ (document.getElementById(id));
  if (value instanceof Error) {
    target.replaceChildren(
      el("p", { class: "error" }, [`Could not load: ${value.message}`]),
    );
  } else if (value) {
    target.replaceChildren(/** @type {Node} */ (value));
  } else {
    target.replaceChildren(el("p", { class: "empty" }, [empty]));
  }
}

/** The short form of a commit, or the build name `local`. */
/** @param {string} commit */
const short = (commit) => commit.length > 12 ? commit.slice(0, 7) : commit;

/** @param {string} name */
const buildPath = (name) => `/b/${encodeURIComponent(name)}/`;

/** The join link of a live session: the build path it records. */
/** @param {LiveSession} session */
const joinPath = (session) =>
  `/b/${encodeURIComponent(session.buildCommit)}/join/${session.id}`;

/** @param {LiveSession[]} sessions @param {number} now */
function liveSessions(sessions, now) {
  if (!sessions.length) return null;
  return table(
    ["Label", "Commit", "Players", "Age", "Join link"],
    sessions.map((session) => [
      session.label ?? "–",
      short(session.buildCommit),
      String(session.playerCount),
      age(now - session.started),
      link(joinPath(session), joinPath(session)),
    ]),
  );
}

/** The build names the shell can serve: no slash, as in the shell's own check. */
const SERVABLE = /^[a-zA-Z0-9._-]{1,100}$/;

/** @param {BuildIndex} index */
function buildIndex(index) {
  if (!index.branches.length) return null;
  const list = table(
    ["Branch", "Commit", "Pull request", "Labels"],
    index.branches.map((branch) => [
      el("span", { class: "wrap" }, [
        SERVABLE.test(branch.name)
          ? link(branch.name, buildPath(branch.name))
          : branch.name,
        ...(branch.main ? [el("span", { class: "tag" }, ["main"])] : []),
      ]),
      el("span", { class: "sha" }, [
        link(short(branch.commit), buildPath(short(branch.commit))),
      ]),
      branch.pull
        ? link(`#${branch.pull.number} ${branch.pull.title}`, branch.pull.url)
        : "–",
      branch.labels.length ? branch.labels.join(", ") : "–",
    ]),
  );
  if (index.pullsAvailable) return list;
  return el("div", {}, [
    el("p", { class: "error" }, [
      "Pull requests could not be loaded; the branches are still listed.",
    ]),
    list,
  ]);
}

/** @param {LabelRow[]} labels */
function labelList(labels) {
  // Labels on a branch show on its row above; these point at one commit.
  const commits = labels.filter((label) => label.kind === "commit");
  if (!commits.length) return null;
  return table(
    ["Label", "Points to", "Commit", "Build"],
    commits.map((label) => [
      el("span", { class: "wrap" }, [label.name]),
      el("span", { class: "wrap" }, [`${label.kind} ${short(label.target)}`]),
      label.commit ? short(label.commit) : "unresolved",
      link(`/b/${label.name}`, buildPath(label.name)),
    ]),
  );
}

/** @param {PromotionRow | null} main @param {PromotionRow[]} promotions */
function mainAndPromotions(main, promotions) {
  if (!main) return null;
  const wrap = el("div", {}, [
    el("p", {}, [
      "Main is ",
      el("strong", {}, [short(main.commit)]),
      ` from ${main.label}, promoted ${when(main.at)}. `,
      link("Open main", "/"),
    ]),
    table(
      ["Promoted", "Commit", "Label", "Note"],
      promotions.map((promotion) => [
        when(promotion.at),
        short(promotion.commit),
        promotion.label,
        promotion.note || "–",
      ]),
    ),
  ]);
  return wrap;
}

/** @param {DeployRow[]} deploys */
function shellDeploys(deploys) {
  if (!deploys.length) return null;
  return table(
    ["Deployed", "Commit", "Revision", "Note"],
    deploys.map((deploy) => [
      when(deploy.at),
      short(deploy.commit),
      deploy.denoRevision,
      deploy.note || "–",
    ]),
  );
}

/** @param {{ session: SessionId, row: TelemetryRow }[]} rows */
function telemetryList(rows) {
  if (!rows.length) return null;
  return table(
    [
      "Recorded",
      "Session",
      "Role",
      "Route",
      "Players",
      "Frame mean",
      "Frame max",
      "RTT",
    ],
    rows.map(({ session, row }) => [
      when(row.at),
      el("span", {}, [
        session.id.slice(0, 8),
        ...(row.test ? [el("span", { class: "tag" }, ["test"])] : []),
      ]),
      row.role,
      row.route,
      measure(row.players),
      measure(row.frameMeanMs, " ms"),
      measure(row.frameMaxMs, " ms"),
      measure(row.rttMs, " ms"),
    ]),
  );
}

/** Telemetry of the live and the most recent ended sessions, newest first. */
/** @param {LiveSession[]} live */
async function recentTelemetry(live) {
  const ended =
    (/** @type {Sessions} */ (await read("/api/v1/sessions/recent?limit=10")))
      .sessions;
  const sessions = [...live, ...ended].slice(0, TELEMETRY_SESSIONS);
  const perSession = await Promise.all(
    sessions.map(async (session) => {
      const rows = (/** @type {Telemetry} */ (
        await read(`/api/v1/sessions/${session.id}/telemetry`)
      )).telemetry;
      return rows.map((row) => ({ session, row }));
    }),
  );
  return perSession.flat().sort((a, b) => b.row.at - a.row.at).slice(
    0,
    TELEMETRY_ROWS,
  );
}

/** Run one section's load; an error shows in that section and leaves the others alone. */
/**
 * @param {string} id
 * @param {string} empty
 * @param {() => Promise<Node | null>} load
 */
async function section(id, empty, load) {
  try {
    show(id, await load(), empty);
    return true;
  } catch (error) {
    show(id, error instanceof Error ? error : new Error(String(error)), empty);
    return false;
  }
}

async function refresh() {
  const status = /** @type {Promise<Status>} */ (read("/api/v1/status"));
  const live = status.then((s) => s.sessions);
  const results = await Promise.all([
    section(
      "live",
      "No live sessions.",
      async () => liveSessions(await live, Date.now()),
    ),
    section(
      "builds",
      "No branches found.",
      async () =>
        buildIndex(/** @type {BuildIndex} */ (await read("/api/v1/builds"))),
    ),
    section(
      "labels",
      "No labels on commits.",
      async () => labelList((await status).labels),
    ),
    section("main", "Nothing is promoted yet, so main is empty.", async () => {
      const [{ main }, { promotions }] = await Promise.all([
        status,
        /** @type {Promise<Promotions>} */ (read("/api/v1/promotions")),
      ]);
      return mainAndPromotions(main, promotions);
    }),
    section(
      "deploys",
      "No shell deploys recorded.",
      async () =>
        shellDeploys(
          (/** @type {Deploys} */ (await read("/api/v1/shell-deploys")))
            .deploys,
        ),
    ),
    section(
      "telemetry",
      "No session telemetry recorded.",
      async () => telemetryList(await recentTelemetry(await live)),
    ),
  ]);
  const note =
    /** @type {HTMLElement} */ (document.getElementById("refreshed"));
  note.classList.toggle("stale", results.includes(false));
  note.textContent = results.every(Boolean)
    ? `Updated ${new Date().toLocaleTimeString()} · refreshes every 15 s`
    : "Some sections failed to load · retrying every 15 s";
}

await refresh();
setInterval(refresh, REFRESH_MS);
