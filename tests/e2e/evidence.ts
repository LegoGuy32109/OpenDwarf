import type { Page } from "@playwright/test";
import process from "node:process";

/** With EVIDENCE=1, save a screenshot to exports/evidence for publishing. */
export async function evidenceShot(page: Page, name: string) {
  if (!process.env.EVIDENCE) return;
  await page.screenshot({ path: `exports/evidence/${name}.png` });
}
