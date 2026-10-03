import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createApp } from "../../src/server/app.ts";
import { createAdminApi } from "../../src/server/admin-api.ts";
import { createBuilds } from "../../src/server/builds.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const TOKEN = "owner-secret-token";
const COMMIT = "a".repeat(40);

function shell() {
  const store = createMemoryStore();
  const builds = createBuilds({ store, localBuild: true });
  const app = createApp(
    builds,
    createAdminApi({ store, builds, ownerToken: TOKEN }),
  );
  return { store, get: (path: string) => app(new Request(`http://t${path}`)) };
}

Deno.test("the shell serves the admin dashboard's page and files", async () => {
  const { get } = shell();
  const types: Record<string, string> = {
    "/admin": "text/html",
    "/admin/": "text/html",
    "/admin/admin.js": "text/javascript",
    "/admin/admin.css": "text/css",
  };
  for (const [path, type] of Object.entries(types)) {
    const response = await get(path);
    assertEquals(response.status, 200, path);
    assertStringIncludes(response.headers.get("content-type")!, type);
    await response.body?.cancel();
  }
  assertEquals((await get("/admin/other.js")).status, 404);
  assertEquals((await get("/admin/../deno.json")).status, 404);
});

Deno.test("the dashboard page holds no credential and no write call", async () => {
  const { get } = shell();
  for (const path of ["/admin", "/admin/admin.js"]) {
    const text = await (await get(path)).text();
    assert(!text.includes(TOKEN), path);
    for (
      const word of [
        "authorization",
        "Bearer",
        "OD_OWNER_TOKEN",
        "POST",
        "PUT",
        "DELETE",
        "<form",
        "<input",
      ]
    ) {
      assert(!text.includes(word), `${path} has ${word}`);
    }
  }
});

Deno.test("shell deploys are a public read, newest first, and empty before the first", async () => {
  const { store, get } = shell();
  assertEquals(await (await get("/api/v1/shell-deploys")).json(), {
    deploys: [],
  });
  await store.recordShellDeploy({ commit: COMMIT, denoRevision: "rev1" });
  await store.recordShellDeploy({
    commit: "b".repeat(40),
    denoRevision: "rev2",
    note: "second",
  });
  const { deploys } = await (await get("/api/v1/shell-deploys")).json();
  assertEquals(
    deploys.map((deploy: { denoRevision: string }) => deploy.denoRevision),
    ["rev2", "rev1"],
  );
});

Deno.test("the shell deploys route refuses writes without the owner token", async () => {
  const { get } = shell();
  const response = await get("/api/v1/shell-deploys");
  assertEquals(response.status, 200);
  const app = createApp(
    createBuilds({ store: createMemoryStore() }),
  );
  const post = await app(
    new Request("http://t/api/v1/shell-deploys", { method: "POST" }),
  );
  assertEquals(post.status, 404);
  await post.body?.cancel();
});
