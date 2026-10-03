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
  workers: 1,
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
      env: { OD_LOCAL_BUILD: "1", SIGNALING: "local" },
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
