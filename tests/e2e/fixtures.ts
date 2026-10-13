// One entry point for browser assertions and fixtures.
import { test as base } from "@playwright/test";
import process from "node:process";
import { captureBrowserCoverage } from "./coverage.ts";
export { expect } from "@playwright/test";

export const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [async ({ browser, baseURL }, use) => {
    const directory = process.env.FALLOW_BROWSER_COVERAGE;
    if (!directory) return use();
    const finish = captureBrowserCoverage(
      browser,
      directory,
      new URL(baseURL!).origin,
    );
    try {
      await use();
    } finally {
      await finish();
    }
  }, { auto: true }],
});
