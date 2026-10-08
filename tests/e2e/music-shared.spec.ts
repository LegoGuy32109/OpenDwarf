import { expect, type Page, test } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";

type MusicState = {
  status: string;
  role: string;
  track: string | null;
  cue: string | null;
  offset: number;
  level: string;
};
type Odd = {
  __od: {
    music: { state(): MusicState; setRandom(source: () => number): void };
    scene: { sessionId: string };
  };
};

const state = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Odd).__od.music.state());

/** Open a host that plays the fixture media, with the given Music setting. */
async function openHost(
  browser: import("@playwright/test").Browser,
  level: string,
) {
  const host = await browser.newPage();
  await host.addInitScript(
    (value) => localStorage.setItem("open-dwarf-music", value),
    level,
  );
  await host.goto("/?harness=1&music=1");
  await ready(host);
  // The fixture lists A, B and a missing track; 0 never picks the missing one first.
  await host.evaluate(() =>
    (globalThis as unknown as Odd).__od.music.setRandom(() => 0)
  );
  await host.mouse.click(640, 400);
  return host;
}

/** Open a guest that joins the host's world, with Music on. */
async function openGuest(
  browser: import("@playwright/test").Browser,
  host: Page,
) {
  const session = await host.evaluate(() =>
    (globalThis as unknown as Odd).__od.scene.sessionId
  );
  const guest = await browser.newPage();
  await guest.goto(`/join/${session}?harness=1&music=1`);
  await ready(guest);
  await guest.mouse.click(640, 400);
  return guest;
}

test("the guest plays the host's track, and a host track change reaches it", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await openHost(browser, "50");
  await expect.poll(async () => (await state(host)).track).not.toBeNull();
  const guest = await openGuest(browser, host);
  await expect.poll(async () => (await state(guest)).role).toBe("cued");
  await expect.poll(async () => {
    const [h, g] = [await state(host), await state(guest)];
    return g.track !== null && g.track === h.track;
  }).toBe(true);
  await evidenceShot(guest, "music-shared-guest");

  // The fixture tracks last 4 s and the next starts 3 s early: the host changes track soon.
  const first = (await state(guest)).track;
  await expect.poll(async () => {
    const [h, g] = [await state(host), await state(guest)];
    return g.track !== null && g.track !== first && g.track === h.track;
  }, { timeout: 15_000 }).toBe(true);
});

test("a guest that joins later starts at a later offset", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await openHost(browser, "50");
  await expect.poll(async () => (await state(host)).track).not.toBeNull();
  await host.waitForTimeout(500);
  const guest = await openGuest(browser, host);
  // The cue sent on join names the track the host is partway through.
  let joined: MusicState | null = null;
  await expect.poll(async () => {
    const current = await state(guest);
    if (current.role === "cued" && current.track !== null) joined ??= current;
    return joined !== null;
  }).toBe(true);
  expect(joined!.offset).toBeGreaterThan(0);
  expect((await state(host)).offset).toBe(0);
});

test("a host with Music Off still conducts, and plays nothing itself", async ({ browser }) => {
  test.setTimeout(90_000);
  const downloads: string[] = [];
  const host = await openHost(browser, "off");
  host.on("request", (request) => {
    if (request.url().includes("/media/music/")) downloads.push(request.url());
  });
  await expect.poll(async () => (await state(host)).cue).not.toBeNull();
  const guest = await openGuest(browser, host);
  await expect.poll(async () => (await state(guest)).track).not.toBeNull();
  expect((await state(host)).track).toBeNull();
  expect(downloads).toEqual([]);
  const first = (await state(guest)).track;
  await expect.poll(async () => (await state(guest)).track, {
    timeout: 15_000,
  }).not.toBe(first);
});

test("a guest with Music Off downloads nothing", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await openHost(browser, "50");
  await expect.poll(async () => (await state(host)).track).not.toBeNull();
  const session = await host.evaluate(() =>
    (globalThis as unknown as Odd).__od.scene.sessionId
  );
  const guest = await browser.newPage();
  await guest.addInitScript(() =>
    localStorage.setItem("open-dwarf-music", "off")
  );
  const downloads: string[] = [];
  guest.on("request", (request) => {
    if (request.url().includes("/media/music/")) downloads.push(request.url());
  });
  await guest.goto(`/join/${session}?harness=1&music=1`);
  await ready(guest);
  await guest.mouse.click(640, 400);
  await expect.poll(async () => (await state(guest)).role).toBe("cued");
  await guest.waitForTimeout(1500);
  expect((await state(guest)).track).toBeNull();
  expect(downloads).toEqual([]);
});
