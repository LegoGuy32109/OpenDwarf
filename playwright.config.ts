export default {
  testDir: "./tests",
  testIgnore: "**/unit/**",
  outputDir: "./exports/playwright-results",
  reporter: [["html", {
    outputFolder: "exports/playwright-report",
    open: "never",
  }]],
  webServer: {
    command: "deno run -A dev.ts",
    url: "http://127.0.0.1:8000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    video: { mode: "on", size: { width: 1280, height: 720 } },
    screenshot: "on",
    launchOptions: {
      executablePath: "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    },
  },
};
