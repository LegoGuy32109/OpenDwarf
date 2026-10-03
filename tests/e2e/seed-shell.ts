// A shell for e2e specs that need seeded history: two commit labels, a branch label, two promotions, stubbed branches and pull requests, a shell deploy, and
// the local build, on the port in the first argument. It uses the in-memory store and the local relay.
import { createApp } from "../../src/server/app.ts";
import { createAdminApi } from "../../src/server/admin-api.ts";
import { createBuilds } from "../../src/server/builds.ts";
import { createRelay } from "../../src/server/relay.ts";
import { createLocalProvider } from "../../src/server/signaling.ts";
import { createMemoryStore } from "../../src/server/store.ts";

const ALPHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const BRAVO = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";

const encoder = new TextEncoder();
/** One pkt-line: four hex digits of length, then the payload. */
const pkt = (text: string) =>
  `${(text.length + 4).toString(16).padStart(4, "0")}${text}`;
const sha = (digit: string) => digit.repeat(40);
const LONG_BRANCH =
  "feature-long-running-experiment-with-a-very-long-branch-name";

/** The stubbed branches of GitHub, with their heads, for the build index. */
const BRANCHES: Record<string, string> = {
  "client-first-deno": BRAVO,
  "t62-build-index": sha("1"),
  [LONG_BRANCH]: sha("2"),
  "mining-feel": sha("3"),
  "evidence": sha("4"),
};
const PULLS = [
  {
    number: 71,
    title: "Admin dashboard indexes every branch build automatically",
    html_url: "https://github.com/LegoGuy32109/OpenDwarf/pull/71",
    head: {
      ref: "t62-build-index",
      repo: { full_name: "LegoGuy32109/OpenDwarf" },
    },
  },
  {
    number: 72,
    title: "A pull request from a fork is not listed",
    html_url: "https://github.com/LegoGuy32109/OpenDwarf/pull/72",
    head: { ref: "mining-feel", repo: { full_name: "someone/OpenDwarf" } },
  },
];

/** GitHub, stubbed: the refs advertisement and the open pull requests. Nothing here leaves the machine. */
const stubGithub = ((input: Request | URL | string) => {
  const url = String(input);
  if (url.includes("/info/refs")) {
    const lines = Object.entries(BRANCHES).map(([name, commit]) =>
      pkt(`${commit} refs/heads/${name}\n`)
    );
    return Promise.resolve(
      new Response(
        encoder.encode(
          pkt("# service=git-upload-pack\n") + "0000" +
            pkt(`${BRAVO} HEAD\0multi_ack\n`) +
            lines.join("") + "0000",
        ),
      ),
    );
  }
  if (url.includes("/pulls?")) return Promise.resolve(Response.json(PULLS));
  return Promise.resolve(new Response("{}", { status: 404 }));
}) as typeof fetch;

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
  await store.setLabel({
    name: "mining-demo",
    kind: "branch",
    target: "mining-feel",
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
// Without `--seed` the shell has no branches, so the index shows its empty state.
const emptyGithub = (() =>
  Promise.resolve(
    new Response(
      encoder.encode(pkt("# service=git-upload-pack\n") + "0000" + "0000"),
    ),
  )) as typeof fetch;
const builds = createBuilds({
  store,
  localBuild: true,
  fetch: seeded ? stubGithub : emptyGithub,
});
const relay = createRelay();
Deno.serve(
  { port: Number(Deno.args[0]) },
  createApp(
    builds,
    createAdminApi({ store, builds, ownerToken: "e2e-owner-token" }),
    { relay, provider: createLocalProvider(relay), secret: "e2e-secret" },
  ),
);
