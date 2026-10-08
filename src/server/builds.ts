// The shell's build routes (ADR 0004). A build is the client at one commit. `/b/<name>` resolves
// <name> as a label, then a branch, then a commit SHA, fetches that commit's page from jsDelivr,
// and rewrites it to load the commit's files from jsDelivr. `/` serves main. The local build serves
// the working tree and exists only when the shell runs from `deno task dev`.
import type { Store } from "./store.ts";

const REPO = "LegoGuy32109/OpenDwarf";
const BRANCH_TTL_MS = 60_000;
/** A full commit SHA never changes, so what it names can stay cached much longer. */
const COMMIT_TTL_MS = 24 * 60 * 60_000;
const NAME = /^[a-zA-Z0-9._-]{1,100}$/;
const SHORT_SHA = /^[0-9a-f]{7,40}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const PAGE_PATH = /^(|host|join\/[a-zA-Z0-9_-]{8,80})$/;

export const LOCAL_BUILD = "local";

const REFS_URL =
  `https://github.com/${REPO}.git/info/refs?service=git-upload-pack`;
const PULLS_URL =
  `https://api.github.com/repos/${REPO}/pulls?state=open&per_page=100`;
const PULLS_TTL_MS = 5 * 60_000;
/** Branches that are listed nowhere: `evidence` holds only screenshots. */
const HIDDEN_BRANCHES = new Set(["evidence"]);

/** A branch and the commit at its head. */
export interface BranchHead {
  name: string;
  commit: string;
}

/** An open pull request from a branch of this repository. */
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  branch: string;
}

/**
 * Reads the branches from a git smart-HTTP ref advertisement (`info/refs?service=git-upload-pack`):
 * pkt-lines of a 4-digit hex length and a payload. Only `refs/heads/*` lines are kept; the service
 * line, HEAD, tags, and a line that does not parse are skipped. Hidden branches are left out.
 */
export function parseBranches(advertisement: Uint8Array): BranchHead[] {
  const decoder = new TextDecoder();
  const branches: BranchHead[] = [];
  let at = 0;
  while (at + 4 <= advertisement.length) {
    const length = parseInt(
      decoder.decode(advertisement.subarray(at, at + 4)),
      16,
    );
    // 0000 is a flush packet; anything under 4 is not a data packet.
    if (!(length >= 4)) {
      if (Number.isNaN(length)) break;
      at += 4;
      continue;
    }
    const line = decoder.decode(advertisement.subarray(at + 4, at + length));
    at += length;
    // The first ref line carries capabilities after a NUL.
    const [ref] = line.split("\0");
    const match = /^([0-9a-f]{40}) refs\/heads\/(.+?)\n?$/.exec(ref);
    if (match && !HIDDEN_BRANCHES.has(match[2])) {
      branches.push({ name: match[2], commit: match[1] });
    }
  }
  return branches;
}

export interface BuildOptions {
  store: Store;
  fetch?: typeof fetch;
  /** Sent to the GitHub API when set. */
  githubToken?: string;
  /** The clock, in milliseconds. Tests set it. */
  now?: () => number;
  /** Serve the working tree as the build `local`. */
  localBuild?: boolean;
  /** Reads `public/index.html` from disk for the local build. */
  readLocalPage?: () => Promise<string>;
}

/** What a build page is told about itself. */
export interface BuildConfig {
  base: string;
  api: string;
  label: string;
  commit: string;
}

export const cdnBase = (sha: string) =>
  `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/public/`;

const escapeJson = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

/**
 * Point a build page at where its files live and give it its config. `files` is the `<base href>`.
 * The page's own `<base>` is replaced, or added when an older commit has none.
 */
export function rewritePage(
  html: string,
  files: string,
  config: BuildConfig,
): string {
  const tags =
    `<base href="${files}">\n    <script id="od-build" type="application/json">${
      escapeJson(config)
    }</script>`;
  // The function form keeps `$` in the config from acting as a replacement pattern.
  if (/<base\s[^>]*>/i.test(html)) {
    return html.replace(/<base\s[^>]*>/i, () => tags);
  }
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n    ${tags}`);
}

function notice(title: string, message: string, status: number): Response {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Open Dwarf</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#17191c;color:#e8e6e1;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}main{max-width:32rem}a{color:#e0b45a}</style>
</head><body><main><h1>${title}</h1><p>${message}</p><p><a href="/admin">Open the admin page</a></p></main></body></html>`;
  return new Response(page, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const notFoundPage = (name: string) =>
  notice(
    "Build not found",
    `No label, branch, or commit is named <code>${
      name.replace(/[^a-zA-Z0-9._-]/g, "")
    }</code>.`,
    404,
  );

export const noMainPage = () =>
  notice(
    "No main build yet",
    "Nothing has been promoted to main. Open a build at <code>/b/&lt;name&gt;</code>, or promote one from the CLI.",
    200,
  );

export interface Builds {
  readonly store: Store;
  /** True when the working tree is a build, so the shell also serves its files from disk. */
  readonly local: boolean;
  /** True when the shell serves this path as a build page or a build error. */
  handles(path: string): boolean;
  /** Answers a GET for a path `handles` accepted. */
  serve(path: string): Promise<Response>;
  /**
   * The service worker loader for `/sw.js` (main) and `/b/<name>/sw.js` (ADR 0007): one line
   * that imports the build's `sw-main.js` from jsDelivr, with the commit in a comment. A `404`
   * for an unknown build, and null for any other path (the local build's loader is the app's).
   */
  worker(path: string): Promise<Response | null>;
  /**
   * Resolves a build name to a full commit SHA, or null when nothing has that name. With
   * `fresh`, a branch is looked up again instead of read from the 60 s cache: a promotion
   * right after a push must get the pushed commit.
   */
  resolve(name: string, options?: { fresh?: boolean }): Promise<string | null>;
  /** The latest commit of a branch, or null when the repository has no such branch. */
  branch(name: string, options?: { fresh?: boolean }): Promise<string | null>;
  /** The full SHA of a commit (full or short), or null when the repository has no such commit. */
  commit(sha: string): Promise<string | null>;
  /** Every branch with its head commit, from git's refs endpoint, cached for 60 s. Throws when GitHub fails. */
  branches(): Promise<BranchHead[]>;
  /** Open pull requests, cached for 5 minutes. Throws when GitHub fails; a failure is cached too. */
  pulls(): Promise<PullRequest[]>;
}

export function createBuilds(options: BuildOptions): Builds {
  const { store } = options;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const refs = new Map<string, { sha: string | null; expires: number }>();
  const pages = new Map<string, { html: string; expires: number }>();
  let branchList: { value: BranchHead[]; expires: number } | undefined;
  let pullList:
    | { value: PullRequest[] | Error; expires: number }
    | undefined;

  async function branches(): Promise<BranchHead[]> {
    if (branchList && branchList.expires > now()) return branchList.value;
    const response = await fetcher(REFS_URL, {
      headers: { "user-agent": "open-dwarf-shell" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub refs answered ${response.status}`);
    }
    const value = parseBranches(new Uint8Array(await response.arrayBuffer()));
    branchList = { value, expires: now() + BRANCH_TTL_MS };
    return value;
  }

  async function loadPulls(): Promise<PullRequest[]> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "open-dwarf-shell",
    };
    if (options.githubToken) {
      headers.authorization = `Bearer ${options.githubToken}`;
    }
    const response = await fetcher(PULLS_URL, { headers });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub pulls answered ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("GitHub pulls were not a list");
    const pulls: PullRequest[] = [];
    for (const item of data) {
      // A pull request from a fork names a branch that this repository does not have.
      if (item?.head?.repo?.full_name !== REPO) continue;
      if (
        typeof item.number === "number" && typeof item.title === "string" &&
        typeof item.html_url === "string" && typeof item.head.ref === "string"
      ) {
        pulls.push({
          number: item.number,
          title: item.title,
          url: item.html_url,
          branch: item.head.ref,
        });
      }
    }
    return pulls;
  }

  async function pulls(): Promise<PullRequest[]> {
    if (!pullList || pullList.expires <= now()) {
      let value: PullRequest[] | Error;
      try {
        value = await loadPulls();
      } catch (error) {
        value = error instanceof Error ? error : new Error(String(error));
      }
      // A failure is kept for a short time so a dashboard left open does not hammer GitHub.
      pullList = {
        value,
        expires: now() +
          (value instanceof Error ? BRANCH_TTL_MS : PULLS_TTL_MS),
      };
    }
    if (pullList.value instanceof Error) throw pullList.value;
    return pullList.value;
  }

  /** The commit a ref names on GitHub: a branch (`heads/<name>`) or a SHA. Null when unknown. */
  async function github(ref: string, fresh = false): Promise<string | null> {
    const cached = refs.get(ref);
    if (!fresh && cached && cached.expires > now()) return cached.sha;
    const headers: Record<string, string> = {
      accept: "application/vnd.github.sha",
      "user-agent": "open-dwarf-shell",
    };
    if (options.githubToken) {
      headers.authorization = `Bearer ${options.githubToken}`;
    }
    const response = await fetcher(
      `https://api.github.com/repos/${REPO}/commits/${ref}`,
      { headers },
    );
    let sha: string | null = null;
    if (response.ok) {
      const text = (await response.text()).trim();
      if (FULL_SHA.test(text)) sha = text;
    } else {
      await response.body?.cancel();
      // Only "no such ref" is an answer; a rate limit or outage must not look like one.
      if (response.status !== 404 && response.status !== 422) {
        throw new Error(`GitHub answered ${response.status}`);
      }
    }
    const immutable = sha !== null && !ref.startsWith("heads/");
    refs.set(ref, {
      sha,
      expires: now() + (immutable ? COMMIT_TTL_MS : BRANCH_TTL_MS),
    });
    return sha;
  }

  const branch = (name: string, { fresh = false } = {}) =>
    github(`heads/${name}`, fresh);
  const commit = (sha: string) =>
    FULL_SHA.test(sha) ? Promise.resolve(sha) : github(sha);

  async function resolve(
    name: string,
    { fresh = false } = {},
  ): Promise<string | null> {
    if (!NAME.test(name)) return null;
    const label = await store.getLabel(name);
    if (label) {
      return label.kind === "branch"
        ? branch(label.target, { fresh })
        : commit(label.target);
    }
    // A full SHA names itself; skip the branch lookup and the API.
    if (FULL_SHA.test(name)) return name;
    const head = await branch(name, { fresh });
    if (head) return head;
    return SHORT_SHA.test(name) ? commit(name) : null;
  }

  async function page(sha: string): Promise<string | null> {
    const cached = pages.get(sha);
    if (cached && cached.expires > now()) return cached.html;
    const response = await fetcher(`${cdnBase(sha)}index.html`);
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return null;
      throw new Error(`jsDelivr answered ${response.status}`);
    }
    const html = await response.text();
    pages.set(sha, { html, expires: now() + COMMIT_TTL_MS });
    return html;
  }

  const html = (body: string) =>
    new Response(body, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      },
    });

  async function remote(
    label: string,
    sha: string,
    base: string,
  ): Promise<Response> {
    const source = await page(sha);
    if (source === null) return notFoundPage(label);
    return html(
      rewritePage(source, cdnBase(sha), {
        base,
        api: "",
        label,
        commit: sha,
      }),
    );
  }

  /** Splits `/b/<name>/<rest>` or a root page path into the build name and the path under it. */
  function split(path: string): { name: string | null; rest: string } | null {
    const build = /^\/b\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (build) return { name: build[1], rest: build[2] ?? "" };
    const root = /^\/(|host|join\/[a-zA-Z0-9_-]{8,80})$/.exec(path);
    return root ? { name: null, rest: root[1] } : null;
  }

  return {
    store,
    local: options.localBuild === true,
    branch,
    commit,
    branches,
    pulls,
    handles: (path) => split(path) !== null,
    resolve,
    async worker(path) {
      const named = /^\/b\/([^/]+)\/sw\.js$/.exec(path);
      if (!named && path !== "/sw.js") return null;
      try {
        const sha = named
          ? await resolve(named[1])
          : (await store.getMain())?.commit ?? null;
        if (!sha) return new Response("Not found", { status: 404 });
        return new Response(
          `importScripts("${cdnBase(sha)}js/sw-main.js"); // build ${sha}\n`,
          {
            headers: {
              "content-type": "text/javascript; charset=utf-8",
              "cache-control": "no-cache",
              "x-content-type-options": "nosniff",
            },
          },
        );
      } catch (error) {
        console.error("Build worker failed", error);
        return new Response("Build unavailable", { status: 502 });
      }
    },
    async serve(path) {
      const target = split(path);
      if (!target) return new Response("Not found", { status: 404 });
      const { name, rest } = target;
      if (!PAGE_PATH.test(rest)) return notFoundPage(name ?? "");
      try {
        if (name === null) {
          if (options.localBuild) return local("/", "main");
          const main = await store.getMain();
          return main ? await remote("main", main.commit, "/") : noMainPage();
        }
        if (name === LOCAL_BUILD && options.localBuild) {
          return local(`/b/${LOCAL_BUILD}/`, LOCAL_BUILD);
        }
        const sha = await resolve(name);
        return sha
          ? await remote(name, sha, `/b/${name}/`)
          : notFoundPage(name);
      } catch (error) {
        console.error("Build page failed", error);
        return notice(
          "Build unavailable",
          "The build's files could not be fetched. Try again in a minute.",
          502,
        );
      }
    },
  };

  /** The working tree's page. Its files come from this server, so `<base>` stays `/`. */
  async function local(base: string, label: string): Promise<Response> {
    const source = await (options.readLocalPage ?? readWorkingTreePage)();
    if (base === "/") return html(source);
    return html(
      rewritePage(source, "/", { base, api: "", label, commit: "" }),
    );
  }
}

function readWorkingTreePage(): Promise<string> {
  return Deno.readTextFile(
    new URL("../../public/index.html", import.meta.url),
  );
}

/** The builds for this process: Turso or memory labels, GitHub, and `OD_LOCAL_BUILD` for the working tree. */
export function openBuilds(store: Store): Builds {
  return createBuilds({
    store,
    githubToken: Deno.env.get("GITHUB_TOKEN") || undefined,
    localBuild: Deno.env.get("OD_LOCAL_BUILD") === "1",
  });
}
