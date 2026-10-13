import type { Page } from "@playwright/test";

/** A benchmark guest has joined when the host assigned its participant ID. */
export async function joinedParticipant(page: Page): Promise<string> {
  await page.waitForFunction(
    () =>
      (globalThis as unknown as { __od: { scene: { localId: string } } })
        .__od.scene.localId.startsWith("peer-"),
    { timeout: 20_000 },
  );
  return page.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
}
