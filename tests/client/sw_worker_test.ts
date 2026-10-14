import { assertEquals, assertRejects } from "@std/assert";
import { createFakeCache } from "./media_fakes.ts";
import { withGlobals } from "../support/globals.ts";

type WorkerEvent = {
  request: Request;
  waitUntil: (work: Promise<unknown>) => void;
  respondWith: (response: Promise<Response>) => void;
};
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
