import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

test("the hearing log opens by touch beside the move stick and lists chat and system lines", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const phone = await context.newPage();
  const guest = await browser.newPage();
  try {
    await phone.goto("/?harness=1");
    await expect(phone.locator("#loading")).toBeHidden();
    const session = await phone.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { sessionId: string } };
      }).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await expect(guest.locator("#loading")).toBeHidden();
    await expect(guest.locator("#display-status")).toBeHidden();
    await expect.poll(() =>
      guest.evaluate(() =>
        (globalThis as unknown as {
          __od: { scene: { status: string } };
        }).__od.scene.status
      )
    ).toBe("Visitor world");
    await guest.evaluate(() =>
      (globalThis as unknown as {
        __od: { send: (m: Record<string, unknown>) => boolean };
      }).__od.send({ type: "nick", name: "Ada" })
    );
    await guest.evaluate(() =>
      (globalThis as unknown as {
        __od: { send: (m: Record<string, unknown>) => boolean };
      }).__od.send({ type: "message", text: "hello dwarf" })
    );
    await phone.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { systemLine: (text: string) => void } };
      }).__od.scene.systemLine("You picked up 3 coal")
    );
    await expect(phone.locator("#hearing-log")).toBeHidden();
    await phone.locator("#log-button").tap();
    const log = phone.locator("#hearing-log");
    await expect(log).toBeVisible();
    await expect(log.locator("li.system")).toContainText([
      "A visitor joined",
      "A visitor is now Ada",
      "You picked up 3 coal",
    ]);
    await expect(log.locator("li.chat")).toHaveText("Ada: hello dwarf");
    const logBox = await log.boundingBox();
    const stick = await phone.locator("[data-stick=move]").boundingBox();
    expect(logBox!.y + logBox!.height).toBeLessThan(stick!.y);
    await expect(phone.locator("[data-stick=move]")).toBeInViewport();
    await evidenceShot(phone, "hearing-log-phone");
    await phone.locator("#log-close").tap();
    await expect(log).toBeHidden();
    await guest.evaluate(() =>
      (globalThis as unknown as {
        __od: { send: (m: Record<string, unknown>) => boolean };
      }).__od.send({ type: "message", text: "second" })
    );
    await phone.locator("#log-button").tap();
    await expect(log.locator("li.chat")).toHaveText([
      "Ada: hello dwarf",
      "Ada: second",
    ]);
    // The guest hears the host-sent system lines too.
    await guest.keyboard.press("Backquote");
    await expect(guest.locator("#hearing-log")).toBeVisible();
    await expect(guest.locator("#hearing-log li.system")).toContainText([
      "A visitor is now Ada",
    ]);
    await guest.keyboard.press("Backquote");
    await expect(guest.locator("#hearing-log")).toBeHidden();
  } finally {
    await guest.close();
    await context.close();
  }
});

test("the backquote key toggles the log and Escape closes it before the menu", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
  await page.keyboard.press("Backquote");
  await expect(page.locator("#hearing-log")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#hearing-log")).toBeHidden();
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { menu: boolean } } }).__od
        .scene.menu
    ),
  ).toBe(false);
  await page.keyboard.press("Backquote");
  await expect(page.locator("#hearing-log")).toBeVisible();
  await page.keyboard.press("Backquote");
  await expect(page.locator("#hearing-log")).toBeHidden();
});
