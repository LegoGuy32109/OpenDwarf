import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import process from "node:process";

// Parallel worktrees set PORT so each runs specs against its own server.
const port = process.env.PORT ?? "8000";

const xirsysPort = Number(port) + 1;
const realXirsys = Boolean(
  process.env.XIRSYS_IDENT && process.env.XIRSYS_SECRET &&
    process.env.XIRSYS_CHANNEL,
);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  // Specs wait in world ticks, so load slows them but does not fail them: four
  // workers run the full suite in about 3.5 minutes on a 12-core machine. CI
  // runners have two cores, so each runs one worker on its shard.
  // E2E_WORKERS=n overrides either.
  workers: Number(process.env.E2E_WORKERS ?? (process.env.CI ? 1 : 4)),
  // Specs wait on world ticks (tests/e2e/time.ts), so these limits only catch a
  // hang. They are generous because a loaded machine runs ticks slowly; a
  // passing spec does not wait for them.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: "exports/playwright-results",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}-{projectName}{ext}",
  webServer: [
    {
      command: "deno task start",
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: true,
      timeout: 30_000,
      // The shell serves the working tree only as the local build, and the
      // local relay carries signaling, so specs need no internet.
      // Media comes from a small fixture folder (ADR 0007): two short tones
      // and an index entry whose file is missing.
      env: {
        OD_LOCAL_BUILD: "1",
        SIGNALING: "local",
        OD_MEDIA_DIR: "tests/e2e/fixtures/media",
      },
    },
    // A second shell talks to real Xirsys, only when its credentials are set.
    ...(realXirsys
      ? [{
        command: "deno task start",
        url: `http://127.0.0.1:${xirsysPort}`,
        reuseExistingServer: true,
        timeout: 30_000,
        env: { OD_LOCAL_BUILD: "1", PORT: String(xirsysPort) },
      }]
      : []),
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // A worker answers its page's requests itself, where `page.route` cannot see them, so specs
    // run without one. offline.spec.ts turns it on (ADR 0007).
    serviceWorkers: "block" as const,
    // EVIDENCE=1 records a video of every test for publish-evidence.ts.
    video: process.env.EVIDENCE ? "on" : "off",
    launchOptions: {
      executablePath: existsSync("/usr/bin/chromium")
        ? "/usr/bin/chromium"
        : undefined,
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [{ name: "chromium" }],
});
