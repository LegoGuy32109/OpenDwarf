import { assertEquals, assertRejects } from "@std/assert";
import {
  type BuildOptions,
  createBuilds,
  parseBranches,
} from "../../src/server/builds.ts";
import { createAdminApi } from "../../src/server/admin-api.ts";
import { createMemoryStore } from "../../src/server/store.ts";

// A response recorded from the repository's refs endpoint: the service line, HEAD with its
// capabilities, and the branches of that day plus `evidence`.
const RECORDED = await Deno.readFile(
  new URL("./fixtures/info-refs.bin", import.meta.url),
);
const MAIN = "f8bdeb5238ae4308f41cc3d89b1b5dd07e9121d2";

const pull = (
  number: number,
  ref: string,
  repo = "LegoGuy32109/OpenDwarf",
) => ({
  number,
  title: `Pull ${number}`,
  html_url: `https://github.com/LegoGuy32109/OpenDwarf/pull/${number}`,
  head: { ref, repo: { full_name: repo } },
});

/** GitHub stubbed: the refs advertisement and the pull request list, counted. */
function github(pulls: () => Response = () => Response.json([])) {
  const calls = { refs: 0, pulls: 0 };
  const headers: Record<string, string>[] = [];
  const stub = ((input: Request | URL | string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/info/refs?service=git-upload-pack")) {
      calls.refs++;
      return Promise.resolve(new Response(RECORDED));
    }
    if (url.includes("/pulls?state=open")) {
      calls.pulls++;
      headers.push(Object.fromEntries(new Headers(init?.headers)));
      return Promise.resolve(pulls());
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;
  return { stub, calls, headers };
}

function setup(
  pulls?: () => Response,
  options: Partial<BuildOptions> = {},
) {
  const net = github(pulls);
  const store = createMemoryStore();
  let time = 0;
  const builds = createBuilds({
    store,
    fetch: net.stub,
    now: () => time,
    ...options,
  });
  return { ...net, store, builds, advance: (ms: number) => time += ms };
}

Deno.test("parseBranches reads the heads from a recorded refs response and skips evidence", () => {
  const branches = parseBranches(RECORDED);
  assertEquals(branches.map((branch) => branch.name), [
    "bevy-version",
    "client-first-deno",
    "main",
    "t22-ios-chat-bar",
    "t60-webgl-ui",
    "webgl-version",
    "worker-thread-split",
  ]);
  assertEquals(branches[1].commit, MAIN);
});

Deno.test("parseBranches keeps only branches and survives odd input", () => {
  const pkt = (text: string) =>
    `${
      (new TextEncoder().encode(text).length + 4).toString(16).padStart(4, "0")
    }${text}`;
  const sha = (digit: string) => digit.repeat(40);
  const text = pkt("# service=git-upload-pack\n") + "0000" +
    pkt(`${sha("a")} HEAD\0multi_ack symref=HEAD:refs/heads/main\n`) +
    pkt(`${sha("b")} refs/heads/main\0multi_ack\n`) +
    pkt(`${sha("c")} refs/heads/feature/ünï\n`) +
    pkt(`${sha("d")} refs/tags/v1\n`) +
    pkt(`${sha("e")} refs/tags/v1^{}\n`) +
    pkt(`${sha("f")} refs/pull/3/head\n`) +
    "0000";
  assertEquals(parseBranches(new TextEncoder().encode(text)), [
    { name: "main", commit: sha("b") },
    { name: "feature/ünï", commit: sha("c") },
  ]);
  assertEquals(parseBranches(new Uint8Array()), []);
  assertEquals(parseBranches(new TextEncoder().encode("not git at all")), []);
});

Deno.test("branches are cached for 60 s, then fetched again", async () => {
  const { builds, calls, advance } = setup();
  await builds.branches();
  await builds.branches();
  assertEquals(calls.refs, 1);
  advance(59_000);
  await builds.branches();
  assertEquals(calls.refs, 1);
  advance(2_000);
  await builds.branches();
  assertEquals(calls.refs, 2);
});

Deno.test("a refs failure throws and is not cached", async () => {
  let fail = true;
  const store = createMemoryStore();
  let calls = 0;
  const builds = createBuilds({
    store,
    fetch: (() => {
      calls++;
      return Promise.resolve(
        fail ? new Response("", { status: 503 }) : new Response(RECORDED),
      );
    }) as typeof fetch,
  });
  await assertRejects(() => builds.branches(), Error, "503");
  fail = false;
  assertEquals((await builds.branches()).length, 7);
  assertEquals(calls, 2);
});

Deno.test("pull requests keep this repository's branches, are cached for 5 minutes, and send the token", async () => {
  const { builds, calls, headers, advance } = setup(
    () =>
      Response.json([
        pull(7, "client-first-deno"),
        pull(8, "from-a-fork", "someone/OpenDwarf"),
      ]),
    { githubToken: "secret-token" },
  );
  assertEquals((await builds.pulls()).map((item) => item.number), [7]);
  assertEquals(headers[0].authorization, "Bearer secret-token");
  advance(4 * 60_000);
  await builds.pulls();
  assertEquals(calls.pulls, 1);
  advance(2 * 60_000);
  await builds.pulls();
  assertEquals(calls.pulls, 2);
});

Deno.test("a pull request failure is cached briefly and throws each time", async () => {
  const { builds, calls, advance } = setup(
    () => new Response("rate limited", { status: 403 }),
  );
  await assertRejects(() => builds.pulls(), Error, "403");
  await assertRejects(() => builds.pulls(), Error, "403");
  assertEquals(calls.pulls, 1);
  advance(61_000);
  await assertRejects(() => builds.pulls(), Error, "403");
  assertEquals(calls.pulls, 2);
});

Deno.test("GET /api/v1/builds lists every branch with its pull request, labels, and main marker", async () => {
  const { builds, store } = setup(() =>
    Response.json([pull(9, "bevy-version")])
  );
  await store.setLabel({
    name: "old-bevy",
    kind: "branch",
    target: "bevy-version",
  });
  await store.setLabel({ name: "pinned", kind: "commit", target: MAIN });
  await store.promote({ commit: MAIN, label: "client-first-deno", note: "" });
  const api = createAdminApi({ store, builds });
  const response = await api.handle(
    new Request("http://shell/api/v1/builds"),
  );
  assertEquals(response?.status, 200);
  const body = await response?.json();
  assertEquals(body.pullsAvailable, true);
  assertEquals(body.branches.length, 7);
  // The integration branch is first, and main is at its head.
  assertEquals(body.branches[0], {
    name: "client-first-deno",
    commit: MAIN,
    pull: null,
    labels: [],
    main: true,
  });
  assertEquals(
    body.branches.find((row: { name: string }) => row.name === "bevy-version"),
    {
      name: "bevy-version",
      commit: "9c10b8d6a9a35d606770ba12f85f6aa7671355df",
      pull: {
        number: 9,
        title: "Pull 9",
        url: "https://github.com/LegoGuy32109/OpenDwarf/pull/9",
      },
      labels: ["old-bevy"],
      main: false,
    },
  );
  // A label on a commit stays out of the branch rows.
  assertEquals(
    body.branches.some((row: { labels: string[] }) =>
      row.labels.includes("pinned")
    ),
    false,
  );
});

Deno.test("a pull request failure does not hide the branch list", async () => {
  const { builds, store } = setup(() => new Response("", { status: 500 }));
  const api = createAdminApi({ store, builds });
  const response = await api.handle(new Request("http://shell/api/v1/builds"));
  const body = await response?.json();
  assertEquals(response?.status, 200);
  assertEquals(body.pullsAvailable, false);
  assertEquals(body.branches.length, 7);
});

Deno.test("a refs failure answers 502 and leaks nothing", async () => {
  const store = createMemoryStore();
  const builds = createBuilds({
    store,
    fetch: (() =>
      Promise.resolve(new Response("", { status: 500 }))) as typeof fetch,
  });
  const response = await createAdminApi({ store, builds }).handle(
    new Request("http://shell/api/v1/builds"),
  );
  assertEquals(response?.status, 502);
});
