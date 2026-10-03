import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";

type Hooks = {
  __vv: EventTarget & { height: number; offsetTop: number };
  __od: { scene: { chatOpen: boolean; chatLift: number } };
};

test.use({
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

test("chat bar disables suggestions and rides above a simulated keyboard", async ({ page }) => {
  // Safari shrinks only the visual viewport; fake that with a stand-in.
  await page.addInitScript(() => {
    const vv = Object.assign(new EventTarget(), {
      height: innerHeight,
      offsetTop: 0,
    });
    Object.defineProperty(globalThis, "visualViewport", { value: vv });
    (globalThis as unknown as Hooks).__vv = vv;
  });
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();

  const input = page.locator("#chat-input");
  await expect(input).toHaveAttribute("autocorrect", "off");
  await expect(input).toHaveAttribute("autocapitalize", "off");
  await expect(input).toHaveAttribute("autocomplete", "off");
  await expect(input).toHaveAttribute("spellcheck", "false");

  await page.locator("#chat-button").tap();
  await input.fill("hello from the keyboard");
  const bottom = () =>
    input.evaluate((el) =>
      globalThis.innerHeight - el.getBoundingClientRect().bottom
    );
  const before = await bottom();
  await evidenceShot(page, "chat-open-before-keyboard");

  await page.evaluate(() => {
    const vv = (globalThis as unknown as Hooks).__vv;
    vv.height = innerHeight - 300;
    vv.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => bottom()).toBeCloseTo(before + 300, 0);
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as Hooks).__od.scene.chatLift
    ),
  ).toBe(300);
  await evidenceShot(page, "chat-open-after-keyboard");

  await page.evaluate(() => {
    const vv = (globalThis as unknown as Hooks).__vv;
    vv.height = innerHeight;
    vv.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => bottom()).toBeCloseTo(before, 0);
});
