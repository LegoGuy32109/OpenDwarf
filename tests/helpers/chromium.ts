import { existsSync } from "node:fs";

const gpu = existsSync("/dev/dri/renderD128");

export const chromiumLaunchArgs = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  "--enable-webgl",
  "--ignore-gpu-blocklist",
  "--force-color-profile=srgb",
  ...(gpu
    ? [
      "--use-angle=vulkan",
      "--enable-gpu-rasterization",
      "--disable-gpu-sandbox",
    ]
    : [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-partial-raster",
    ]),
];
