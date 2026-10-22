import { assertEquals, assertRejects } from "@std/assert";
import { createFakeCache } from "./media_fakes.ts";
import { withGlobals } from "../support/globals.ts";

type WorkerEvent = {
  request: Request;
  waitUntil: (work: Promise<unknown>) => void;
  respondWith: (response: Promise<Response>) => void;
};

Deno.test("bootstrap acknowledges completed page/build writes and reports partial failure", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, ReturnType<typeof createFakeCache>>();
  const writes: (() => void)[] = [];
  const requests: { url: string; credentials: string | undefined }[] = [];
  let fail = false;
  let defer = true;
  let body = "body";
  let resolvedDocument: string | null = null;
  const open = (name: string) => {
    let cache = stores.get(name);
    if (!cache) {
      cache = createFakeCache();
      const put = cache.put.bind(cache);
      cache.put = (url, response) =>
        defer
          ? new Promise<undefined>((resolve) =>
            writes.push(() => void put(url, response).then(resolve))
          )
          : put(url, response);
      stores.set(name, cache);
    }
    return Promise.resolve(cache);
  };
  await withGlobals({
    importScripts: () => {},
    location: { origin: "https://od.test" },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (kind: string, listener: (event: unknown) => void) =>
      handlers.set(kind, listener),
    caches: {
      open,
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name: string) => Promise.resolve(stores.delete(name)),
    },
    fetch: (url: string, options: RequestInit) => {
      requests.push({ url, credentials: options.credentials });
      return Promise.resolve(
        new Response(
          fail
            ? "failed"
            : url.includes("__od_page") && resolvedDocument !== null
            ? resolvedDocument
            : body,
          { status: fail ? 503 : 200 },
        ),
      );
    },
  }, async () => {
    await import("../../public/js/sw-main.js?bootstrap");
    const page = "https://od.test/b/demo/";
    const data = {
      type: "cache-build",
      page,
      base: "https://od.test/",
      files: ["https://od.test/js/app.js", "https://od.test/api/v1/status"],
    };
    const replies: unknown[] = [];
    let work: Promise<unknown> | undefined;
    const dispatch = (source: string) =>
      handlers.get("message")!({
        data,
        source: { url: source },
        ports: [{ postMessage: (reply: unknown) => replies.push(reply) }],
        waitUntil: (pending: Promise<unknown>) => work = pending,
      });
    dispatch("https://foreign.test/");
    assertEquals(work, undefined);
    assertEquals(requests, []);
    dispatch(page);
    // Pause the first cache write. No ready acknowledgment may precede it.
    for (let turn = 0; turn < 10 && writes.length === 0; turn++) {
      await Promise.resolve();
    }
    assertEquals(writes.length, 1);
    assertEquals(replies, []);
    assertEquals(stores.get("od-pages")?.store.size ?? 0, 0);
    defer = false;
    writes.shift()!();
    await work;
    assertEquals(replies, [{ ok: true }]);
    assertEquals([...stores.get("od-pages")!.store.keys()], [
      page,
      `${page}?__od_page=1`,
    ]);
    assertEquals(
      [...stores.get("od-build-local")!.store.keys()],
      data.files.slice(0, 1),
    );
    assertEquals(
      requests.every((request) => request.credentials === "omit"),
      true,
    );
    fail = true;
    dispatch(page);
    await work;
    assertEquals(replies, [{ ok: true }, { ok: false }]);
    fail = false;
    body = "new-page-must-not-replace-prior-copy";
    const root = `https://cdn.jsdelivr.net/gh/LegoGuy32109/OpenDwarf@${
      "a".repeat(40)
    }/`;
    data.base = `${root}public/`;
    data.files = [`${root}src/client/app.js`];
    resolvedDocument = `<base href="${root}public/"><script id="od-build">` +
      JSON.stringify({ commit: "b".repeat(40) }) + "</script>";
    dispatch(page);
    await work;
    assertEquals(replies.at(-1), { ok: false });
    assertEquals(
      await (await stores.get("od-pages")!.match(page))!.text(),
      "body",
    );
  });
});
Deno.test("worker media routing handles network, cached ranges, offline fallback and rejected requests", async () => {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const cache = createFakeCache();
  let network: Response | Error = new Response("network");
  const fetched: string[] = [];
  await withGlobals({
    importScripts: () => {},
    location: { origin: "https://od.test" },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (kind: string, listener: (event: WorkerEvent) => void) =>
      handlers.set(kind, listener),
    caches: { open: () => Promise.resolve(cache) },
    fetch: (input: Request | string) => {
      fetched.push(typeof input === "string" ? input : input.url);
      return network instanceof Error
        ? Promise.reject(network)
        : Promise.resolve(network.clone());
    },
  }, async () => {
    await import("../../public/js/sw-main.js");
    const dispatch = (path: string, options: RequestInit = {}) => {
      let response: Promise<Response> | undefined;
      const event: WorkerEvent = {
        request: new Request(`https://od.test${path}`, options),
        waitUntil: () => {},
        respondWith: (value) => {
          response = value;
        },
      };
      handlers.get("fetch")!(event);
      return response;
    };
    assertEquals(dispatch("/api/sessions"), undefined);
    assertEquals(dispatch("/media/song?v=1", { method: "POST" }), undefined);
    assertEquals(
      await (await dispatch("/media/index.json")!).text(),
      "network",
    );
    cache.store.set("https://od.test/media/index.json", "cached-index");
    network = new Error("offline");
    assertEquals(
      await (await dispatch("/media/index.json")!).text(),
      "cached-index",
    );
    await assertRejects(
      () => dispatch("/media/missing.json")!,
      Error,
      "offline",
    );
    cache.store.set("https://od.test/media/song?v=1", "abcdef");
    const ranged = await dispatch("/media/song?v=1", {
      headers: { range: "bytes=1-3" },
    })!;
    assertEquals(ranged.status, 206);
    assertEquals(await ranged.text(), "bcd");
    network = new Response("downloaded");
    assertEquals(
      await (await dispatch("/media/next?v=1")!).text(),
      "downloaded",
    );
    assertEquals(
      await cache.match("https://od.test/media/next?v=1").then((response) =>
        response!.text()
      ),
      "downloaded",
    );
    network = new Response("missing", { status: 404 });
    assertEquals((await dispatch("/media/absent?v=1")!).status, 404);
    assertEquals(
      await cache.match("https://od.test/media/absent?v=1"),
      undefined,
    );
    assertEquals(fetched.includes("https://od.test/media/song?v=1"), false);
  });
});
