// A separate Deno server keeps the real shell modules out of Playwright's CJS loader.
import { createApp } from "../../src/server/app.ts";
import { createBuilds } from "../../src/server/builds.ts";
import { loadingPage } from "../../src/server/loading-page.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const store = createMemoryStore();
const commit = "a".repeat(40);
await store.promote({ commit, label: "test" });
let release!: () => void;
const held = new Promise<void>((resolve) => release = resolve);
const local = Deno.args.includes("--bootstrap-local");
const builds = createBuilds({
  localBuild: local,
  store: {
    ...store,
    getMain: async () => {
      await held;
      return store.getMain();
    },
  },
  fetch: () =>
    Promise.resolve(
      new Response(
        `<!doctype html><html><head><base href="/"></head><body><h1 id="selected">Selected build ready</h1><script>document.documentElement.dataset.executed="true";</script></body></html>`,
      ),
    ),
});
// Exercise the remote document handoff with local game assets and a real worker.
if (local) builds.loading = () => loadingPage();
const app = createApp(builds);
Deno.serve({
  port: 0,
  onListen: ({ port }) => console.log(JSON.stringify({ port })),
}, (request) => {
  if (new URL(request.url).pathname === "/test/release") {
    release();
    return new Response("ok");
  }
  return app(request);
});
