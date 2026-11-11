import { expect, test } from "./fixtures.ts";
import { openWorld, readWorld } from "./world.ts";
import { evidenceShot } from "./evidence.ts";
import { expectChat, ready } from "./ui.ts";
import { waitFor } from "./time.ts";
import { messagePieces } from "../../src/shared/message-pieces.js";
import { speechTicks } from "../../src/shared/world.js";

test("long chat plays as ordered bubbles and stays one hearing-log line", async ({ browser, page }) => {
  const host = page;
  const guest = await browser.newPage();
  try {
    await openWorld(host, "/?harness=1");
    await ready(host);
    const session = await readWorld(host, (__world) => __world.scene.sessionId);
    await openWorld(guest, `/join/${session}?harness=1`);
    await ready(guest);
    await waitFor(
      guest,
      async () =>
        (await readWorld(guest, (__world) => __world.scene.localId))
          .startsWith("peer-"),
      { maxTicks: 200, message: "guest to join the host" },
    );

    await host.keyboard.press("t");
    await host.keyboard.type("x".repeat(205));
    await waitFor(
      host,
      async () =>
        await readWorld(
          host,
          (__world) => __world.scene.chatDraft.length === 205,
        ),
      { maxTicks: 100, message: "chat draft to reach 205 characters" },
    );
    const draftCount = await readWorld(
      host,
      (__world) =>
        __world.ui.layout().elements
          .find((element) => element.id === "chatbar")?.count,
    );
    expect(draftCount).toBe(205);
    await evidenceShot(host, "message-pieces-character-count");
    await host.keyboard.press("Escape");
    await expectChat(host, false);

    const text =
      "Found some iron beneath the mountain, and brought enough for everyone at the camp.";
    const pieces = messagePieces(text);
    await host.keyboard.press("t");
    await expectChat(host, true);
    await host.keyboard.type(text);
    await host.keyboard.press("Enter");
    await expectChat(host, false);
    await waitFor(
      host,
      async () =>
        await readWorld(
          host,
          (__world) =>
            __world.scene.world.players.self.messages?.some((bubble) =>
              bubble.group !== undefined
            ) ?? false,
        ),
      { maxTicks: 100, message: "host to queue the split message" },
    );
    for (const [part, expected] of pieces.entries()) {
      await waitFor(
        guest,
        async () =>
          await readWorld(
            guest,
            (__world, part) =>
              __world.scene.chatFeed.some((record) =>
                record.id === "self" &&
                record.bubbles?.some((bubble) => bubble.part === part)
              ),
            part,
          ),
        { maxTicks: 400, message: `guest to hear piece ${part}` },
      );
      const bubbleText = await readWorld(
        guest,
        (__world, part) =>
          __world.scene.chatFeed.find((record) => record.id === "self")
            ?.bubbles?.find((bubble) => bubble.part === part)?.text,
        part,
      );
      expect(bubbleText).toBe(expected);
      const startTick = await readWorld(
        guest,
        (__world, part) =>
          __world.scene.chatFeed.find((record) => record.id === "self")
            ?.bubbles?.find((bubble) => bubble.part === part)?.startTick,
        part,
      );
      expect(startTick).toBeDefined();
      const endTick = startTick! + speechTicks(expected, "self");
      await waitFor(
        host,
        async () =>
          await readWorld(
            host,
            (__world, endTick) => __world.scene.world.tick >= endTick,
            endTick,
          ),
        { maxTicks: 1000, message: `piece ${part} to finish speaking` },
      );
    }
    await waitFor(
      guest,
      async () =>
        await readWorld(
          guest,
          (__world, text) =>
            __world.scene.hearingLog.lines.some((line) =>
              line.kind === "chat" && line.text === text
            ),
          text,
        ),
      { maxTicks: 50, message: "hearing log to complete the split message" },
    );
    const matchingLines = await readWorld(
      guest,
      (__world, text) =>
        __world.scene.hearingLog.lines
          .filter((line) => line.kind === "chat" && line.text === text).length,
      text,
    );
    expect(matchingLines).toBe(1);
  } finally {
    await guest.close();
  }
});
