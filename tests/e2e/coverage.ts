import type { Browser, BrowserContext, Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import process from "node:process";

/** Collect V8 profiles before pages close, including pages a test creates directly. */
export function captureBrowserCoverage(
  browser: Browser,
  directory: string,
  origin: string,
) {
  const pages = new Set<Page>();
  const root = pathToFileURL(`${process.cwd()}/`);
  const originalContext = browser.newContext;

  async function save(page: Page) {
    if (!pages.delete(page) || page.isClosed()) return;
    const profiles = await page.coverage.stopJSCoverage();
    const result = profiles.flatMap((profile) => {
      if (
        !profile.url.startsWith(`${origin}/src/`) &&
        !profile.url.startsWith(`${origin}/js/`)
      ) return [];
      const pathname = new URL(profile.url).pathname;
      if (!pathname.endsWith(".js")) return [];
      const local = pathname.startsWith("/js/")
        ? `public${pathname}`
        : pathname.slice(1);
      return [{ ...profile, url: new URL(local, root).href }];
    });
    await mkdir(directory, { recursive: true });
    await writeFile(
      `${directory}/${crypto.randomUUID()}.json`,
      JSON.stringify({ result }),
    );
  }

  async function watch(page: Page) {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    pages.add(page);
    const close = page.close;
    page.close = async (options) => {
      await save(page);
      return close.call(page, options);
    };
    return page;
  }

  function watchContext(context: BrowserContext) {
    const newPage = context.newPage, close = context.close;
    context.newPage = async () => watch(await newPage.call(context));
    context.close = async (options) => {
      for (const page of context.pages()) await save(page);
      return close.call(context, options);
    };
    return context;
  }

  browser.newContext = async (options) =>
    watchContext(await originalContext.call(browser, options));
  return async () => {
    browser.newContext = originalContext;
    for (const page of pages) await save(page);
  };
}
