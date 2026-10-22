import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
test("other players see the thought icon while a player types", async ({ page, context }) => {
  await openWorld(page, "/?harness=1");
  await ready(page);
  const session = await readWorld(page, (__world) => __world.scene.sessionId);
  const guest = await context.newPage();
  await openWorld(guest, `/join/${session}?harness=1`);
  await ready(guest);
  await expect.poll(() =>
    readWorld(guest, (__world) => Boolean(__world.wireDebug()?.state))
  ).toBeTruthy();
  const typingRecords = () =>
    readWorld(
      page,
      (__world) =>
        __world.scene.chatFeed.filter((record) => record.typing).length,
    );
  await readWorld(guest, (__world) => __world.openChat());
  await guest.keyboard.type("hello");
  await expect.poll(typingRecords).toBe(1);
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
