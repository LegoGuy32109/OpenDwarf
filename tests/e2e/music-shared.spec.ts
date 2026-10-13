import { openWorld, readWorld } from "./world.ts";
import { expect, test } from "./fixtures.ts";
import { type Page } from "@playwright/test";
import { evidenceShot } from "./evidence.ts";
import { ready } from "./ui.ts";
const state = (page: Page) =>
  readWorld(page, (__world) => __world.music.state());
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
  await openWorld(host, "/?harness=1&music=1");
  await ready(host);
  // The fixture lists A, B and a missing track; 0 never picks the missing one first.
  await readWorld(host, (__world) => __world.music.setRandom(() => 0));
  await host.mouse.click(640, 400);
  return host;
}
/** Open a guest that joins the host's world, with Music on. */
async function openGuest(
  browser: import("@playwright/test").Browser,
  host: Page,
) {
  const session = await readWorld(host, (__world) => __world.scene.sessionId);
  const guest = await browser.newPage();
  await openWorld(guest, `/join/${session}?harness=1&music=1`);
  await ready(guest);
  await guest.mouse.click(640, 400);
  return guest;
}
test("the guest plays the host's track, and a host track change reaches it", async ({ browser }) => {
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
  }).toBe(true);
});
