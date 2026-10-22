import { assertEquals } from "@std/assert";
import { isOffline, registerWorker } from "../../src/client/offline.js";
import { withGlobals } from "../support/globals.ts";

Deno.test("resource capture survives timing-buffer eviction and clears on a skipped worker", async () => {
  let entries = [{ name: "https://od.test/js/early.js" }];
  let record:
    | ((list: { getEntries(): { name: string }[] }) => void)
    | undefined;
  let disconnected = 0;
  class Observer {
    static supportedEntryTypes = ["resource"];
    constructor(callback: typeof record) {
      record = callback;
    }
    observe() {}
    takeRecords() {
      return [];
    }
    disconnect() {
      disconnected++;
    }
  }
  const posted: { files: string[] }[] = [];
  const serviceWorker = {
    register: () =>
      Promise.resolve({
        active: {
          postMessage: (data: { files: string[] }, ports: MessagePort[]) => {
            posted.push(data);
            ports[0].postMessage({ ok: true });
            ports[0].close();
          },
        },
      } as unknown as ServiceWorkerRegistration),
  };
  await withGlobals({
    document: { baseURI: "https://od.test/", querySelector: () => ({}) },
    location: new URL("https://od.test/"),
    performance: { getEntriesByType: () => entries },
    PerformanceObserver: Observer,
  }, async () => {
    const fresh = await import("../../src/client/offline.js?resources");
    record!({
      getEntries: () => [{ name: "https://od.test/assets/last.png" }],
    });
    entries = [];
    assertEquals(
      await fresh.registerWorker({ base: "/" }, { search: "", serviceWorker }),
      true,
    );
    assertEquals(posted[0].files, [
      "https://od.test/js/early.js",
      "https://od.test/assets/last.png",
    ]);
    assertEquals(disconnected, 1);
    const skipped = await import(
      "../../src/client/offline.js?resources-skipped"
    );
    record!({
      getEntries: () => [{ name: "https://od.test/assets/discard.png" }],
    });
    assertEquals(
      await skipped.registerWorker({ base: "/" }, {
        search: "?sw=0",
        serviceWorker,
      }),
      false,
    );
    assertEquals(disconnected, 2);
    assertEquals(
      await skipped.registerWorker({ base: "/" }, {
        search: "",
        serviceWorker,
      }),
      true,
    );
    assertEquals(posted[1].files, []);
  });
});

Deno.test("an unsupported resource observer cannot break module startup", async () => {
  await withGlobals({
    document: {},
    PerformanceObserver: class {
      static supportedEntryTypes = ["resource"];
      constructor() {
        throw new Error("unsupported observer");
      }
    },
  }, async () => {
    const fresh = await import(
      "../../src/client/offline.js?unsupported-observer"
    );
    assertEquals(
      await fresh.registerWorker({ base: "/" }, { search: "?sw=0" }),
      false,
    );
  });
});

Deno.test("first-visit caching waits for the new worker and completed world assets", async () => {
  let ready = false;
  let observe: (() => void) | undefined;
  let disconnected = false;
  const posted: unknown[] = [];
  class Worker extends EventTarget {
    state = "installing";
    postMessage(message: unknown, ports: MessagePort[]) {
      posted.push(message);
      ports[0].postMessage({ ok: true });
      ports[0].close();
    }
  }
  const worker = new Worker();
  const page = "https://od.test/b/demo/?seed=offline";
  await withGlobals({
    document: {
      baseURI: "https://od.test/",
      documentElement: {},
      querySelector: () => ready ? {} : null,
    },
    location: { href: page },
    performance: {
      getEntriesByType: () => [{ name: "https://od.test/assets/floor.png" }],
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        observe = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  }, async () => {
    const pending = registerWorker({ base: "/b/demo/" }, {
      search: "",
      serviceWorker: {
        register: () =>
          Promise.resolve({
            active: { postMessage: () => posted.push("old worker") },
            installing: worker,
          } as unknown as ServiceWorkerRegistration),
      },
    });
    await Promise.resolve();
    assertEquals(posted, []);
    worker.state = "activated";
    worker.dispatchEvent(new Event("statechange"));
    await Promise.resolve();
    assertEquals(posted, [], "assets have not completed yet");
    ready = true;
    observe!();
    assertEquals(await pending, true);
    assertEquals(disconnected, true);
    assertEquals(posted, [{
      type: "cache-build",
      page,
      base: "https://od.test/",
      files: ["https://od.test/assets/floor.png"],
    }]);
  });
});

Deno.test("the browser says offline only when onLine is false", () => {
  assertEquals(isOffline({ onLine: false }), true);
  assertEquals(isOffline({ onLine: true }), false);
  assertEquals(isOffline({}), false);
  assertEquals(isOffline(undefined), false);
});

Deno.test("failed or missing cache acknowledgments fail quietly", async () => {
  for (const reply of [false, "missing"] as const) {
    let cleared = false;
    await withGlobals({
      document: { baseURI: "https://od.test/", querySelector: () => ({}) },
      location: { href: "https://od.test/" },
      performance: { getEntriesByType: () => [] },
      ...(reply === "missing"
        ? {
          setTimeout: (callback: () => void) => {
            queueMicrotask(callback);
            return 1;
          },
          clearTimeout: () => {
            cleared = true;
          },
        }
        : {}),
    }, async () => {
      assertEquals(
        await registerWorker({ base: "/" }, {
          search: "",
          serviceWorker: {
            register: () =>
              Promise.resolve({
                active: {
                  postMessage: (_message: unknown, ports: MessagePort[]) => {
                    if (reply !== "missing") {
                      ports[0].postMessage({ ok: reply });
                    }
                    ports[0].close();
                  },
                },
              } as unknown as ServiceWorkerRegistration),
          },
        }),
        false,
      );
      if (reply === "missing") assertEquals(cleared, true);
    });
  }
});

Deno.test("a build registers its worker at its own base", async () => {
  const calls: unknown[][] = [];
  const serviceWorker = {
    register: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({} as ServiceWorkerRegistration);
    },
  };
  assertEquals(
    await registerWorker({ base: "/b/test/" }, { search: "", serviceWorker }),
    true,
  );
  assertEquals(calls, [["/b/test/sw.js", { scope: "/b/test/" }]]);
});

Deno.test("a bare preview entry enters its worker scope without losing query or hash", async () => {
  const page = new URL("https://od.test/b/demo?seed=one#view");
  const state = { test: true };
  const calls: unknown[] = [];
  await withGlobals({
    location: page,
    history: {
      state,
      replaceState: (...args: unknown[]) => calls.push(args),
    },
  }, async () => {
    assertEquals(
      await registerWorker({ base: "/b/demo/" }, {
        search: page.search,
        serviceWorker: {
          register: () => Promise.resolve({} as ServiceWorkerRegistration),
        },
      }),
      true,
    );
    assertEquals(calls, [[state, "", "https://od.test/b/demo/?seed=one#view"]]);
  });
});

Deno.test("?sw=0, no support, or a failed register means no worker", async () => {
  const serviceWorker = {
    register: () => Promise.reject(new Error("blocked")),
  };
  assertEquals(
    await registerWorker({ base: "/" }, { search: "?sw=0", serviceWorker }),
    false,
  );
  assertEquals(await registerWorker({ base: "/" }, { search: "" }), false);
  assertEquals(
    await registerWorker({ base: "/" }, { search: "", serviceWorker }),
    false,
  );
});
