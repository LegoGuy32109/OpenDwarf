import { expect, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type Od = {
  scene: {
    sessionId: string;
    chatFeed: { id: string; typing?: boolean }[];
  };
  openChat: () => void;
  wireDebug: () => { state: unknown } | null;
};

test("other players see the typing bubble while a player types", async ({ page, context }) => {
  await page.goto("/?harness=1");
  await ready(page);
  const session = await page.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.scene.sessionId
  );
  const guest = await context.newPage();
  await guest.goto(`/join/${session}?harness=1`);
  await guest.waitForFunction(() =>
    Boolean((globalThis as unknown as { __od: Od }).__od.wireDebug()?.state)
  );
  const typingRecords = () =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: Od }).__od.scene.chatFeed.filter((
        record,
      ) => record.typing).length
    );

  await guest.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.openChat()
  );
  await guest.keyboard.type("hello");
  await expect.poll(typingRecords).toBe(1);
  await page.waitForTimeout(1500);
  await evidenceShot(page, "typing-bubble");

  for (let i = 0; i < "hello".length; i++) {
    await guest.keyboard.press("Backspace");
  }
  await expect.poll(typingRecords).toBe(0);

  await guest.keyboard.type("again");
  await expect.poll(typingRecords).toBe(1);
  await guest.keyboard.press("Enter");
  await expect.poll(typingRecords).toBe(0);
  await guest.close();
});
