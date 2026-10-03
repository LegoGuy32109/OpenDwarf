import { assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../../src/server/app.ts";
import { createAdminApi } from "../../src/server/admin-api.ts";
import { createBuilds } from "../../src/server/builds.ts";
import { createMemoryStore } from "../../src/server/store.ts";
import { runOd } from "../../scripts/od-cli.ts";

const TOKEN = "owner-secret-token";
const OLD = "a".repeat(40);
const NEWER = "b".repeat(40);
const PINNED = "c0ffee0123456789abcdef0123456789abcdef01";
const PAGE =
  `<!doctype html><html><head><base href="/"></head><body></body></html>`;
const BASE = "http://shell.test";

/** A shell with the in-memory store and a stubbed GitHub and jsDelivr. */
function shell(options: { ownerToken?: string | null } = {}) {
  const refs: Record<string, string> = {
    "heads/feature": OLD,
    "heads/other": NEWER,
    [PINNED.slice(0, 7)]: PINNED,
    [PINNED]: PINNED,
  };
  let time = 0;
  const store = createMemoryStore({ now: () => time });
  const builds = createBuilds({
    store,
    now: () => time,
    fetch: ((input: Request | URL | string) => {
      const url = String(input);
      const ref = /\/commits\/(.+)$/.exec(url)?.[1];
      if (ref !== undefined) {
        return Promise.resolve(
          refs[ref]
            ? new Response(refs[ref])
            : new Response("{}", { status: 422 }),
        );
      }
      return Promise.resolve(new Response(PAGE));
    }) as typeof fetch,
  });
  const ownerToken = options.ownerToken === null
    ? undefined
    : options.ownerToken ?? TOKEN;
  const app = createApp(
    builds,
    createAdminApi({ store, builds, ownerToken }),
  );
  const request = (path: string, init?: RequestInit) =>
    app(new Request(`${BASE}${path}`, init));
  const lines: string[] = [];
  const errors: string[] = [];
  const od = (args: string[], ...override: [string?]) =>
    runOd(args, {
      fetch: (input, init) => app(new Request(input, init)),
      token: override.length ? override[0] : TOKEN,
      out: (line) => lines.push(line),
      err: (line) => errors.push(line),
    });
  return {
    store,
    builds,
    refs,
    request,
    od,
    lines,
    errors,
    advance: (ms: number) => time += ms,
  };
}

const withShell = (
  name: string,
  body: (s: Awaited<ReturnType<typeof shell>>) => Promise<void>,
) =>
  Deno.test(name, async () => {
    const s = shell();
    await body(s);
  });

const BASE_ARGS = ["--base-url", BASE];

withShell("label set creates a branch label and a commit label", async (s) => {
  assertEquals(
    await s.od([...BASE_ARGS, "label", "set", "demo", "feature"]),
    0,
  );
  assertEquals(s.lines.at(-1), `demo  branch feature  ->  ${OLD.slice(0, 7)}`);
  assertEquals(
    await s.od([...BASE_ARGS, "label", "set", "pin", PINNED.slice(0, 7)]),
    0,
  );
  // A commit label saves the full SHA.
  assertEquals((await s.store.getLabel("pin"))?.target, PINNED);
  assertEquals((await s.store.getLabel("demo"))?.kind, "branch");
  // Setting a label again moves it.
  assertEquals(await s.od([...BASE_ARGS, "label", "set", "demo", "other"]), 0);
  assertEquals((await s.store.getLabel("demo"))?.target, "other");
});

withShell(
  "label set refuses a branch or commit that does not exist",
  async (s) => {
    assertEquals(await s.od([...BASE_ARGS, "label", "set", "demo", "nope"]), 1);
    assertStringIncludes(s.errors.at(-1)!, "404");
    assertEquals(
      await s.od([...BASE_ARGS, "label", "set", "demo", "deadbee"]),
      1,
    );
    assertEquals(
      await s.od([...BASE_ARGS, "label", "set", "bad name", "feature"]),
      1,
    );
    assertEquals(await s.store.listLabels(), []);
  },
);

withShell("label rename and label rm", async (s) => {
  await s.od([...BASE_ARGS, "label", "set", "demo", "feature"]);
  await s.od([...BASE_ARGS, "label", "set", "taken", "other"]);
  assertEquals(
    await s.od([...BASE_ARGS, "label", "rename", "demo", "taken"]),
    1,
  );
  assertStringIncludes(s.errors.at(-1)!, "409");
  assertEquals(
    await s.od([...BASE_ARGS, "label", "rename", "missing", "x"]),
    1,
  );
  assertEquals(
    await s.od([...BASE_ARGS, "label", "rename", "demo", "renamed"]),
    0,
  );
  assertEquals(s.lines.at(-1), "Renamed demo to renamed");
  assertEquals(await s.store.getLabel("demo"), null);
  assertEquals((await s.store.getLabel("renamed"))?.target, "feature");
  assertEquals(await s.od([...BASE_ARGS, "label", "rm", "renamed"]), 0);
  assertEquals(await s.store.getLabel("renamed"), null);
  assertEquals(await s.od([...BASE_ARGS, "label", "rm", "renamed"]), 1);
});

withShell("labels lists each label with its resolved commit", async (s) => {
  assertEquals(await s.od([...BASE_ARGS, "labels"]), 0);
  assertEquals(s.lines.at(-1), "No labels.");
  await s.od([...BASE_ARGS, "label", "set", "demo", "feature"]);
  await s.od([...BASE_ARGS, "label", "set", "pin", PINNED]);
  s.lines.length = 0;
  assertEquals(await s.od([...BASE_ARGS, "labels"]), 0);
  assertEquals(s.lines, [
    `demo  branch feature  ->  ${OLD.slice(0, 7)}`,
    `pin  commit ${PINNED.slice(0, 7)}  ->  ${PINNED.slice(0, 7)}`,
  ]);
});

withShell(
  "promote saves the commit, so a later push does not change main",
  async (s) => {
    await s.od([...BASE_ARGS, "label", "set", "demo", "feature"]);
    assertEquals(
      await s.od([...BASE_ARGS, "promote", "demo", "--note", "first"]),
      0,
    );
    assertEquals(s.lines.at(-1), `Main is now ${OLD} (from demo)`);
    const mainCommit = async () =>
      JSON.parse(
        /<script id="od-build" type="application\/json">(.*?)<\/script>/.exec(
          await (await s.request("/")).text(),
        )![1],
      ).commit;
    assertEquals(await mainCommit(), OLD);
    // The branch moves on, and the label follows it, but main stays.
    s.refs["heads/feature"] = NEWER;
    s.advance(120_000);
    assertEquals(await s.builds.resolve("demo"), NEWER);
    assertEquals(await mainCommit(), OLD);
    assertEquals((await s.store.getMain())?.note, "first");
  },
);

withShell("promote takes a label, a branch, or a short SHA", async (s) => {
  assertEquals(await s.od([...BASE_ARGS, "promote", "other"]), 0);
  assertEquals((await s.store.getMain())?.commit, NEWER);
  assertEquals((await s.store.getMain())?.label, "other");
  assertEquals(await s.od([...BASE_ARGS, "promote", PINNED.slice(0, 7)]), 0);
  assertEquals((await s.store.getMain())?.commit, PINNED);
  assertEquals((await s.store.getMain())?.label, PINNED.slice(0, 7));
  assertEquals(await s.od([...BASE_ARGS, "promote", "nope"]), 1);
  assertEquals((await s.store.listPromotions()).length, 2);
});

withShell("promotions lists newest first", async (s) => {
  await s.od([...BASE_ARGS, "promotions"]);
  assertEquals(s.lines.at(-1), "No promotions.");
  await s.od([...BASE_ARGS, "promote", "feature"]);
  await s.advance(1000);
  await s.od([...BASE_ARGS, "promote", "other", "--note", "second"]);
  s.lines.length = 0;
  assertEquals(await s.od([...BASE_ARGS, "promotions"]), 0);
  assertEquals(s.lines.length, 2);
  assertStringIncludes(
    s.lines[0],
    `${NEWER.slice(0, 7)}  from other  "second"`,
  );
  assertStringIncludes(s.lines[1], `${OLD.slice(0, 7)}  from feature`);
});

withShell("status shows main, labels, and live sessions", async (s) => {
  await s.od([...BASE_ARGS, "status"]);
  assertEquals(s.lines.slice(0, 3), [
    "Main: none promoted yet",
    "Labels (0):",
    "Live sessions (0):",
  ]);
  await s.od([...BASE_ARGS, "label", "set", "demo", "feature"]);
  await s.od([...BASE_ARGS, "promote", "demo"]);
  await s.store.startSession({
    id: "session01",
    buildCommit: OLD,
    label: "demo",
    hostPeer: "host-secret-peer",
    playerCount: 3,
  });
  s.lines.length = 0;
  assertEquals(await s.od([...BASE_ARGS, "status"]), 0);
  assertStringIncludes(s.lines[0], `Main: ${OLD} (from demo`);
  assertEquals(s.lines[1], "Labels (1):");
  assertEquals(s.lines[2], `  demo  branch feature  ->  ${OLD.slice(0, 7)}`);
  assertEquals(s.lines[3], "Live sessions (1):");
  assertEquals(s.lines[4], `  session01  ${OLD.slice(0, 7)} (demo)  3 players`);
});

withShell(
  "write routes return 401 without the token; read routes stay public",
  async (s) => {
    const writes: [string, string, unknown][] = [
      ["PUT", "/api/v1/labels/demo", { target: "feature" }],
      ["POST", "/api/v1/labels/demo/rename", { to: "x" }],
      ["DELETE", "/api/v1/labels/demo", undefined],
      ["POST", "/api/v1/promotions", { target: "feature" }],
    ];
    for (const [method, path, body] of writes) {
      for (
        const authorization of [
          undefined,
          "Bearer wrong",
          "Basic abc",
          "Bearer",
        ]
      ) {
        const headers: Record<string, string> = {};
        if (authorization) headers.authorization = authorization;
        const response = await s.request(path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        assertEquals(
          response.status,
          401,
          `${method} ${path} ${authorization}`,
        );
        await response.body?.cancel();
      }
    }
    assertEquals(await s.store.listLabels(), []);
    assertEquals(await s.store.getMain(), null);
    for (const path of ["labels", "promotions", "status"]) {
      const response = await s.request(`/api/v1/${path}`);
      assertEquals(response.status, 200, path);
      assertEquals((await response.text()).includes(TOKEN), false);
    }
  },
);

Deno.test("without OD_OWNER_TOKEN set, write routes answer 403 even with a bearer token", async () => {
  const s = shell({ ownerToken: null });
  for (const token of [TOKEN, "", undefined]) {
    const response = await s.request("/api/v1/promotions", {
      method: "POST",
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      body: JSON.stringify({ target: "feature" }),
    });
    assertEquals(response.status, 403);
    await response.body?.cancel();
  }
  assertEquals(await s.store.getMain(), null);
  assertEquals((await s.request("/api/v1/status")).status, 200);
});

withShell(
  "the CLI refuses a write without a token and sends none on reads",
  async (s) => {
    assertEquals(
      await s.od([...BASE_ARGS, "promote", "feature"], undefined),
      1,
    );
    assertStringIncludes(s.errors.at(-1)!, "OD_OWNER_TOKEN is not set");
    assertEquals(await s.od([...BASE_ARGS, "promote", "feature"], "wrong"), 1);
    assertStringIncludes(s.errors.at(-1)!, "401");
    assertEquals(s.errors.join("\n").includes("wrong"), false);
    assertEquals(await s.od([...BASE_ARGS, "labels"], undefined), 0);
  },
);

withShell(
  "every command has --help, and bad input exits with usage",
  async (s) => {
    for (
      const args of [
        ["label", "set"],
        ["label", "rename"],
        ["label", "rm"],
        ["labels"],
        ["promote"],
        ["promotions"],
        ["status"],
      ]
    ) {
      s.lines.length = 0;
      assertEquals(await s.od([...args, "--help"]), 0);
      assertStringIncludes(s.lines.join("\n"), "Usage: deno task od");
    }
    assertEquals(await s.od(["--help"]), 0);
    assertStringIncludes(s.lines.at(-1)!, "Commands:");
    assertEquals(await s.od([]), 2);
    assertEquals(await s.od(["bogus"]), 2);
    assertEquals(await s.od(["label", "set", "only-one"]), 2);
    assertEquals(await s.od(["--prod", "--base-url", BASE, "labels"]), 2);
  },
);

Deno.test("--prod targets the production shell", async () => {
  const urls: string[] = [];
  const code = await runOd(["--prod", "labels"], {
    fetch: ((input: Request | URL | string) => {
      urls.push(String(input));
      return Promise.resolve(Response.json({ labels: [] }));
    }) as typeof fetch,
    out: () => {},
    err: () => {},
  });
  assertEquals(code, 0);
  assertEquals(urls, ["https://od.joshhale.me/api/v1/labels"]);
});
