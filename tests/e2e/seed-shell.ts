// A shell for e2e specs that need seeded history: two labels, two promotions, a shell deploy, and
// the local build, on the port in the first argument. It uses the in-memory store and the local relay.
import { createApp } from "../../src/server/app.ts";
import { createAdminApi } from "../../src/server/admin-api.ts";
import { createBuilds } from "../../src/server/builds.ts";
import { createRelay } from "../../src/server/relay.ts";
import { createLocalProvider } from "../../src/server/signaling.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const ALPHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const BRAVO = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";

const seeded = Deno.args.includes("--seed");
const store = createMemoryStore();
if (seeded) {
  await store.setLabel({
    name: "seeded-chunk-gen",
    kind: "commit",
    target: ALPHA,
  });
  await store.setLabel({
    name: "admin-dashboard",
    kind: "commit",
    target: BRAVO,
  });
  await store.promote({
    commit: ALPHA,
    label: "seeded-chunk-gen",
    note: "first demo build",
  });
  await store.promote({
    commit: BRAVO,
    label: "admin-dashboard",
    note: "adds the dashboard",
  });
  await store.recordShellDeploy({
    commit: ALPHA,
    denoRevision: "opendwarf-4k2m9",
    note: "Signal through Xirsys",
  });
}
const builds = createBuilds({ store, localBuild: true });
const relay = createRelay();
Deno.serve(
  { port: Number(Deno.args[0]) },
  createApp(
    builds,
    createAdminApi({ store, builds, ownerToken: "e2e-owner-token" }),
    { relay, provider: createLocalProvider(relay), secret: "e2e-secret" },
  ),
);
