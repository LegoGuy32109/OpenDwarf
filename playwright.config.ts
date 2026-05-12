const FAST_LAUNCH = {
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    // CPU software rasteriser — deterministic frame timing via stepTick
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-partial-raster",
    "--force-color-profile=srgb",
  ],
};

const VISUAL_LAUNCH = {
  executablePath: "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    // ANGLE Vulkan backend — drives the GTX 1660 directly, no display needed.
    "--use-angle=vulkan",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "--disable-gpu-sandbox",
    "--force-color-profile=srgb",
  ],
};

export default {
  testDir: "./tests",
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
  projects: [
    {
      name: "fast",
      testMatch: /.*\.test\.ts/,
      testIgnore: "**/unit/**",
      use: {
        baseURL: "http://127.0.0.1:8000",
        browserName: "chromium",
        headless: true,
        viewport: { width: 640, height: 360 },
        deviceScaleFactor: 2,
        video: { mode: "on", size: { width: 640, height: 360 } },
        screenshot: "on",
        launchOptions: FAST_LAUNCH,
      },
    },
    {
      name: "visual",
      testMatch: /.*\.visual\.ts/,
      use: {
        baseURL: "http://127.0.0.1:8000",
        browserName: "chromium",
        headless: true,
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        video: "off",
        screenshot: "on",
        launchOptions: VISUAL_LAUNCH,
      },
    },
  ],
};
