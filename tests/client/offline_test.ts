import { assertEquals } from "@std/assert";
import { isOffline, registerWorker } from "../../src/client/offline.js";

Deno.test("the browser says offline only when onLine is false", () => {
  assertEquals(isOffline({ onLine: false }), true);
  assertEquals(isOffline({ onLine: true }), false);
  assertEquals(isOffline({}), false);
  assertEquals(isOffline(undefined), false);
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
