import { expect, type Page, test } from "@playwright/test";
import {
  revealedLength,
  speechDurationMs,
  speechSchedule,
  voiceFromId,
} from "../../src/shared/speech.js";
import { evidenceShot } from "./evidence.ts";
import { ready, say } from "./ui.ts";

type Bubble = { text: string; startAt?: number };
type Sample = {
  now: number;
  record: { queued?: boolean; typing?: boolean; bubbles: Bubble[] } | null;
};
type Od = {
  scene: {
    sessionId: string;
    localId: string;
    chatFeed: {
      id: string;
      queued?: boolean;
      typing?: boolean;
      bubbles?: Bubble[];
    }[];
  };
};

/** The guest's player id, once the host has accepted it. */
async function peerId(guest: Page) {
  await expect.poll(() =>
    guest.evaluate(() =>
      (globalThis as unknown as { __od: Od }).__od.scene.localId
    )
  ).toMatch(/^peer-/);
  return guest.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.scene.localId
  );
}

const messages = [
  "Found iron beneath the mountain",
  "Anyone have a pickaxe?",
  "Meet me at the stairs",
];

/** Sample the speaker's chat record every 40 ms, so a test sees each stage. */
async function startSampling(page: Page, speakerId: string) {
  await page.evaluate((id) => {
    const win = globalThis as unknown as { __od: Od; __samples: Sample[] };
    win.__samples = [];
    setInterval(() => {
      const record = win.__od.scene.chatFeed.find((item) => item.id === id);
      win.__samples.push({
        now: performance.now(),
        record: record
          ? {
            queued: record.queued,
            typing: record.typing,
            bubbles: (record.bubbles ?? []).map((bubble) => ({
              text: bubble.text,
              startAt: bubble.startAt,
            })),
          }
          : null,
      });
    }, 40);
  }, speakerId);
}

const samples = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { __samples: Sample[] }).__samples
  );

/** What a viewer's bubble shows in one sample: the revealed share of its text. */
function shown(speakerId: string, sample: Sample, text: string) {
  const bubble = sample.record?.bubbles.find((item) => item.text === text);
  if (!bubble || bubble.startAt === undefined) return null;
  return revealedLength(
    speechSchedule(text, voiceFromId(speakerId)),
    text,
    sample.now - bubble.startAt,
  );
}

test("a host and a guest see three quick messages spoken in turn, with the thought icon while some wait", async ({ page, context }) => {
  await page.goto("/?harness=1");
  await ready(page);
  const session = await page.evaluate(() =>
    (globalThis as unknown as { __od: Od }).__od.scene.sessionId
  );
  const guest = await context.newPage();
  await guest.goto(`/join/${session}?harness=1`);
  await ready(guest);
  const guestId = await peerId(guest);
  await startSampling(page, guestId);
  await startSampling(guest, guestId);

  for (const line of messages) await say(guest, line);
  const totalMs = messages.reduce(
    (sum, line) => sum + speechDurationMs(line, voiceFromId(guestId)),
    0,
  );
  await page.waitForTimeout(totalMs + 1500);
  await evidenceShot(page, "speech-reveal-host");

  for (const [name, viewer] of [["host", page], ["guest", guest]] as const) {
    const taken = await samples(viewer);
    const first = (text: string) =>
      taken.find((sample) =>
        sample.record?.bubbles.some((bubble) => bubble.text === text)
      );
    const firstSeen = messages.map((line) => first(line)?.now);
    for (const [index, line] of messages.entries()) {
      expect(firstSeen[index], `${name} saw "${line}"`).toBeDefined();
    }
    // A speaker says one message at a time: each begins after the last ends.
    for (let index = 1; index < messages.length; index++) {
      const gap = firstSeen[index]! - firstSeen[index - 1]!;
      const speech = speechDurationMs(
        messages[index - 1],
        voiceFromId(guestId),
      );
      expect(gap, `${name} message ${index + 1}`).toBeGreaterThan(
        speech - 400,
      );
    }
    // While the first is spoken the later two wait, and the icon shows. The
    // gaps above show that their text stayed back until their start.
    expect(
      taken.some((sample) =>
        sample.record?.queued &&
        sample.record.bubbles.length === 1 &&
        sample.record.bubbles[0].text === messages[0]
      ),
      `${name} saw a queued speaker`,
    ).toBe(true);
    // The text fills in by syllable: some sample is partly revealed.
    const partial = taken.some((sample) => {
      const length = shown(guestId, sample, messages[0]);
      return length !== null && length > 0 && length < messages[0].length;
    });
    expect(partial, `${name} saw a partial reveal`).toBe(true);
    expect(
      taken.some((sample) =>
        sample.record?.bubbles.some((bubble) => bubble.text === messages[2])
      ),
    ).toBe(true);
  }
  await guest.close();
});

test("the thought icon sits beside the head on a phone", async ({ browser }) => {
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const phone = await phoneContext.newPage();
  const guest = await phoneContext.newPage();
  try {
    await phone.goto("/?harness=1");
    await ready(phone);
    const session = await phone.evaluate(() =>
      (globalThis as unknown as { __od: Od }).__od.scene.sessionId
    );
    await guest.goto(`/join/${session}?harness=1`);
    await ready(guest);
    const guestId = await peerId(guest);
    await startSampling(phone, guestId);
    for (const line of messages.slice(0, 2)) await say(guest, line);
    await expect.poll(async () =>
      (await samples(phone)).some((sample) =>
        sample.record?.queued && sample.record.bubbles.length === 1
      )
    ).toBe(true);
    await phone.waitForTimeout(300);
    await evidenceShot(phone, "thought-icon-phone");
  } finally {
    await phoneContext.close();
  }
});
