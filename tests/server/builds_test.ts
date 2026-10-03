import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type BuildOptions,
  cdnBase,
  createBuilds,
  rewritePage,
} from "../../src/server/builds.ts";
import { createApp, joinLink } from "../../src/server/app.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const MAIN = "a".repeat(40);
const FEATURE = "b".repeat(40);
const PUSHED = "c0ffee0123456789abcdef0123456789abcdef01";
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
    <base href="/">
    <title>Open Dwarf</title></head><body></body></html>`;

/** A stubbed network: GitHub knows a few refs, jsDelivr has a page for some commits. */
function network(
  refs: Record<string, string>,
  pages: Record<string, string> = {},
) {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  const stub = ((input: Request | URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    headers.push(Object.fromEntries(new Headers(init?.headers)));
    const ref = /\/commits\/(.+)$/.exec(url)?.[1];
    if (ref !== undefined) {
      return Promise.resolve(
        refs[ref]
          ? new Response(refs[ref])
          : new Response("{}", { status: 422 }),
      );
    }
    const sha = /@([0-9a-f]{40})\/public\/index\.html$/.exec(url)?.[1];
    return Promise.resolve(
      sha && pages[sha]
        ? new Response(pages[sha])
        : new Response("", { status: 404 }),
    );
  }) as typeof fetch;
  return { stub, calls, headers };
}

function setup(
  refs: Record<string, string>,
  pages: Record<string, string> = {},
  options: Partial<BuildOptions> = {},
) {
  const store = createMemoryStore();
  const net = network(refs, pages);
  let time = 0;
  const builds = createBuilds({
    store,
    fetch: net.stub,
    now: () => time,
    ...options,
  });
  return { store, net, builds, advance: (ms: number) => time += ms };
}

async function configOf(response: Response) {
  const html = await response.text();
  const match = /<script id="od-build" type="application\/json">(.*?)<\/script>/
    .exec(html);
  return { html, config: match ? JSON.parse(match[1]) : null };
}

Deno.test("resolution tries a label, then a branch, then a commit SHA", async () => {
  const { store, builds } = setup({
    "heads/feature": FEATURE,
    "heads/main-label": MAIN,
    "heads/deadbee": MAIN,
    [PUSHED.slice(0, 7)]: PUSHED,
  });
  // A label wins over a branch of the same name.
  await store.setLabel({ name: "feature", kind: "commit", target: PUSHED });
  assertEquals(await builds.resolve("feature"), PUSHED);
  // A label can name a branch.
  await store.setLabel({ name: "demo", kind: "branch", target: "main-label" });
  assertEquals(await builds.resolve("demo"), MAIN);
  // A branch wins over a commit SHA that looks the same.
  assertEquals(await builds.resolve("deadbee"), MAIN);
  // A short SHA resolves to the full one.
  assertEquals(await builds.resolve(PUSHED.slice(0, 7)), PUSHED);
  // A full SHA names itself.
  assertEquals(await builds.resolve(FEATURE), FEATURE);
  // An unknown name, and a name that is no ref at all, resolve to nothing.
  assertEquals(await builds.resolve("nope"), null);
  assertEquals(await builds.resolve("a b"), null);
  assertEquals(await builds.resolve("../x"), null);
});

Deno.test("a branch's commit is cached about 60 seconds, a commit longer", async () => {
  const { net, builds, advance } = setup({
    "heads/feature": FEATURE,
    [PUSHED.slice(0, 7)]: PUSHED,
  });
  await builds.resolve("feature");
  await builds.resolve("feature");
  assertEquals(net.calls.length, 1);
  advance(59_000);
  await builds.resolve("feature");
  assertEquals(net.calls.length, 1);
  advance(2_000);
  await builds.resolve("feature");
  assertEquals(net.calls.length, 2);
  // A short SHA costs a branch lookup and a commit lookup. The branch miss expires with the
  // branch cache; the commit does not.
  net.calls.length = 0;
  await builds.resolve(PUSHED.slice(0, 7));
  assertEquals(net.calls.length, 2);
  advance(60 * 60_000);
  net.calls.length = 0;
  await builds.resolve(PUSHED.slice(0, 7));
  assertEquals(net.calls.map((url) => url.split("/commits/")[1]), [
    `heads/${PUSHED.slice(0, 7)}`,
  ]);
  // A full SHA never asks GitHub.
  net.calls.length = 0;
  await builds.resolve(FEATURE);
  assertEquals(net.calls, []);
});

Deno.test("GitHub requests carry GITHUB_TOKEN only when one is set", async () => {
  const without = setup({ "heads/x": MAIN });
  await without.builds.resolve("x");
  assertEquals(without.net.headers[0].authorization, undefined);
  assertEquals(
    without.net.headers[0].accept,
    "application/vnd.github.sha",
  );
  const withToken = setup({ "heads/x": MAIN }, {}, { githubToken: "t0ken" });
  await withToken.builds.resolve("x");
  assertEquals(withToken.net.headers[0].authorization, "Bearer t0ken");
});

Deno.test("a GitHub outage is an error page, not an unknown name", async () => {
  const store = createMemoryStore();
  const builds = createBuilds({
    store,
    fetch: (() =>
      Promise.resolve(new Response("", { status: 403 }))) as typeof fetch,
  });
  const response = await builds.serve("/b/feature");
  assertEquals(response.status, 502);
  await response.body?.cancel();
});

Deno.test("the page rewrite sets the file origin and the build config", () => {
  const html = rewritePage(PAGE, cdnBase(FEATURE), {
    base: "/b/feature/",
    api: "",
    label: "feature",
    commit: FEATURE,
  });
  assertStringIncludes(
    html,
    `<base href="https://cdn.jsdelivr.net/gh/LegoGuy32109/OpenDwarf@${FEATURE}/public/">`,
  );
  assertEquals(html.includes('<base href="/">'), false);
  const config = JSON.parse(
    /<script id="od-build" type="application\/json">(.*?)<\/script>/.exec(
      html,
    )![1],
  );
  assertEquals(config, {
    base: "/b/feature/",
    api: "",
    label: "feature",
    commit: FEATURE,
  });
  // A page with no base tag gets one, and a label cannot close the script tag.
  const bare = rewritePage("<html><head></head></html>", "/", {
    base: "/",
    api: "",
    label: "</script><b>$&",
    commit: "",
  });
  assertStringIncludes(bare, '<head>\n    <base href="/">');
  assertEquals(bare.includes("</script><b>"), false);
  assertStringIncludes(bare, "$&");
});

Deno.test("a build page is served at /b/<name> and under it", async () => {
  const { builds, net } = setup({ "heads/feature": FEATURE }, {
    [FEATURE]: PAGE,
  });
  const response = await builds.serve("/b/feature");
  assertEquals(response.status, 200);
  assertStringIncludes(response.headers.get("content-type")!, "text/html");
  const { config } = await configOf(response);
  assertEquals(config.base, "/b/feature/");
  assertEquals(config.commit, FEATURE);
  assertEquals(config.label, "feature");
  for (
    const path of ["/b/feature/", "/b/feature/host", "/b/feature/join/abcd1234"]
  ) {
    assertEquals((await builds.serve(path)).status, 200);
  }
  // The page is fetched once per commit.
  assertEquals(net.calls.filter((url) => url.endsWith("index.html")).length, 1);
  // Other paths under a build are not pages.
  assertEquals((await builds.serve("/b/feature/js/app.js")).status, 404);
});

Deno.test("an unknown name gets a 404 page that links to /admin", async () => {
  const { builds } = setup({});
  const response = await builds.serve("/b/nope");
  assertEquals(response.status, 404);
  assertStringIncludes(await response.text(), 'href="/admin"');
  // A commit that is not on jsDelivr is also unknown.
  assertEquals((await builds.serve(`/b/${PUSHED}`)).status, 404);
});

Deno.test("/ serves main, or a clear message before the first promotion", async () => {
  const { store, builds } = setup({}, { [MAIN]: PAGE });
  const before = await builds.serve("/");
  assertEquals(before.status, 200);
  assertStringIncludes(await before.text(), "No main build yet");
  await store.promote({ commit: MAIN, label: "feature" });
  const { config } = await configOf(await builds.serve("/"));
  assertEquals(config, { base: "/", api: "", label: "main", commit: MAIN });
  assertEquals((await builds.serve("/host")).status, 200);
  assertEquals((await builds.serve("/join/abcd1234")).status, 200);
});

Deno.test("the local build serves the working tree only when enabled", async () => {
  const readLocalPage = () => Promise.resolve(PAGE);
  const on = setup({}, {}, { localBuild: true, readLocalPage });
  assertEquals(on.builds.local, true);
  // `/` is the local build as it is on disk.
  assertEquals(await (await on.builds.serve("/")).text(), PAGE);
  // `/b/local` runs under its own base with files from this server.
  const { html, config } = await configOf(await on.builds.serve("/b/local"));
  assertStringIncludes(html, '<base href="/">');
  assertEquals(config.base, "/b/local/");
  assertEquals(config.label, "local");
  assertEquals(on.net.calls, []);
  // Without it, `local` is a label like any other, and unknown here.
  const off = setup({}, {}, { readLocalPage });
  assertEquals(off.builds.local, false);
  assertEquals((await off.builds.serve("/b/local")).status, 404);
});

Deno.test("only the shell's own origin may set a join link", () => {
  const request = new Request("https://shell.example/api/v1/qr/abcd1234");
  assertEquals(
    joinLink(request, "abcd1234", "https://shell.example/b/x/join/abcd1234"),
    "https://shell.example/b/x/join/abcd1234",
  );
  assertEquals(
    joinLink(request, "abcd1234", "https://evil.example/join/abcd1234"),
    "https://shell.example/join/abcd1234",
  );
});

Deno.test("the app serves build pages, and disk files only for the local build", async () => {
  const shell = setup({}, {}, { localBuild: false });
  const app = createApp(shell.builds);
  assertEquals(
    (await app(new Request("https://x.example/js/app.js"))).status,
    404,
  );
  assertEquals(
    (await app(new Request("https://x.example/src/client/app.js"))).status,
    404,
  );
  const nope = await app(new Request("https://x.example/b/nope"));
  assertEquals(nope.status, 404);
  await nope.body?.cancel();
  const local = createApp(setup({}, {}, { localBuild: true }).builds);
  const script = await local(new Request("https://x.example/js/app.js"));
  assertEquals(script.status, 200);
  await script.body?.cancel();
});
