import type { Page } from "@playwright/test";
import process from "node:process";

/**
 * With EVIDENCE=1, save a screenshot to exports/evidence for publishing. It
 * first lets panel and camera easing settle, so specs need no sleep before it.
 */
export async function evidenceShot(page: Page, name: string) {
  if (!process.env.EVIDENCE) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: `exports/evidence/${name}.png` });
}
