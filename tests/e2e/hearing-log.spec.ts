import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { displayStatus, hasUi, logLines, ready, tapUi, uiRect } from "./ui.ts";

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
    await ready(phone);
    const session = await phone.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { sessionId: string } };
      }).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await ready(guest);
    expect(await displayStatus(guest)).toBe("");
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
    expect(await hasUi(phone, "panel:log")).toBe(false);
    await tapUi(phone, "btn:log");
    await expect.poll(() => hasUi(phone, "panel:log")).toBe(true);
    await expect.poll(async () => (await logLines(phone)).sort()).toEqual([
      "A visitor is now Ada",
      "A visitor joined",
      "Ada: hello dwarf",
      "You picked up 3 coal",
    ]);
    const logBox = await uiRect(phone, "panel:log");
    const stick = await uiRect(phone, "stick:move");
    expect(logBox.y + logBox.h).toBeLessThan(stick.y);
    await evidenceShot(phone, "hearing-log-phone");
    await tapUi(phone, "btn:log-close");
    await expect.poll(() => hasUi(phone, "panel:log")).toBe(false);
    await guest.evaluate(() =>
      (globalThis as unknown as {
        __od: { send: (m: Record<string, unknown>) => boolean };
      }).__od.send({ type: "message", text: "second" })
    );
    await tapUi(phone, "btn:log");
    await expect.poll(async () =>
      (await logLines(phone)).filter((line) => line.startsWith("Ada:"))
    ).toEqual(["Ada: hello dwarf", "Ada: second"]);
    // The guest hears the host-sent system lines too.
    await guest.keyboard.press("Backquote");
    await expect.poll(() => hasUi(guest, "panel:log")).toBe(true);
    await expect.poll(() => logLines(guest)).toContain("A visitor is now Ada");
    await guest.keyboard.press("Backquote");
    await expect.poll(() => hasUi(guest, "panel:log")).toBe(false);
  } finally {
    await guest.close();
    await context.close();
  }
});

test("the backquote key toggles the log and Escape closes it before the menu", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("Backquote");
  await expect.poll(() => hasUi(page, "panel:log")).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => hasUi(page, "panel:log")).toBe(false);
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { menu: boolean } } }).__od
        .scene.menu
    ),
  ).toBe(false);
  await page.keyboard.press("Backquote");
  await expect.poll(() => hasUi(page, "panel:log")).toBe(true);
  await page.keyboard.press("Backquote");
  await expect.poll(() => hasUi(page, "panel:log")).toBe(false);
});
