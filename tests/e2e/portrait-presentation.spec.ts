import { expect, test } from "./fixtures.ts";
import { openWorld, readWorld } from "./world.ts";
import { hasUi, ready, tapUi, uiRect } from "./ui.ts";
import { waitFrames, waitTicks } from "./time.ts";
import { evidenceShot } from "./evidence.ts";

// Presentation fixtures supply the state owned by the parallel world/input/action
// tickets. These assertions do not claim integrated aiming or throw simulation.
test.describe("single-plane presentation", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  for (
    const screen of [
      { name: "portrait", width: 390, height: 844, safe: "47,0,34,0" },
      { name: "small", width: 320, height: 568, safe: "24,0,24,0" },
      { name: "landscape", width: 844, height: 390, safe: "0,47,21,47" },
    ]
  ) {
    test(`lower controls and planar terrain in ${screen.name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({
        width: screen.width,
        height: screen.height,
      });
      await openWorld(page, `/?harness=1&safe=${screen.safe}`);
      await ready(page);
      await readWorld(page, async (api) => {
        const { writeTile, STONE, OPEN } = await import(
          "../../src/shared/terrain.js"
        );
        const scene = api.scene;
        scene.world.planeZ = 1;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            writeTile(scene.world, x, y, 0, STONE);
            writeTile(
              scene.world,
              x,
              y,
              1,
              y === 3 || y === 15 || x === 3 || x === 23 ? STONE : OPEN,
            );
          }
        }
        api.edit({
          players: [{
            id: scene.localId,
            at: { x: 12, y: 9, z: 1 },
            inventory: [{ kind: "coin", count: 10 }],
            held: "coin",
          }],
        });
        scene.viewZ = 1;
      });
      await waitFrames(page, 4);
      expect(await hasUi(page, "stick:look")).toBe(false);
      expect(await hasUi(page, "btn:log")).toBe(false);
      const [top, right, bottom, left] = screen.safe.split(",").map(Number);
      for (
        const id of [
          "stick:move",
          "btn:chat",
          "btn:menu",
          "btn:bag",
          "btn:sprint",
          "btn:interact",
        ]
      ) {
        const r = await uiRect(page, id);
        expect(r.x, id).toBeGreaterThanOrEqual(left);
        expect(r.y, id).toBeGreaterThanOrEqual(top);
        expect(r.x + r.w, id).toBeLessThanOrEqual(screen.width - right);
        expect(r.y + r.h, id).toBeLessThanOrEqual(screen.height - bottom);
      }
      const action = await uiRect(page, "btn:interact");
      expect(action.w).toBeGreaterThanOrEqual(72);
      await evidenceShot(page, `133-${screen.name}`);
      const clip = {
        x: screen.width / 2 - 90,
        y: screen.height / 2 - 110,
        width: 32,
        height: 32,
      };
      const dynamic = await page.screenshot({ clip });
      await readWorld(page, (api) => {
        api.scene.viewMode = "master";
      });
      await waitFrames(page, 3);
      const cached = await page.screenshot({ clip });
      expect(cached.equals(dynamic), "cached and dynamic planar terrain pixels")
        .toBe(true);
      await readWorld(page, (api) => {
        api.scene.viewMode = "entity";
      });
      await waitFrames(page, 3);

      await readWorld(page, (api) => {
        Object.assign(api.scene, {
          actionGesture: {
            down: true,
            aiming: true,
            everAimed: true,
            x: 0,
            y: -1,
            originX: 0,
            originY: 0,
            knobX: 0,
            knobY: -30,
          },
        });
        api.scene.world.throws = [{
          id: "visual-throw",
          owner: api.scene.localId,
          kind: "coin",
          x: 13,
          y: 8,
          z: 1,
          dx: 1,
          dy: 0,
          remaining: 3,
        }];
      });
      await waitFrames(page);
      expect(await hasUi(page, "action:well")).toBe(false);
      await evidenceShot(page, `133-${screen.name}-aim`);
      await waitTicks(page, 8);
      await readWorld(page, (api) => {
        Object.assign(api.scene, { actionGesture: undefined });
        api.scene.world.throws = [];
      });
      await tapUi(page, "btn:bag");
      expect(await hasUi(page, "panel:bag")).toBe(true);
      await evidenceShot(page, `133-${screen.name}-bag`);
      await tapUi(page, "btn:bag-close");
      await tapUi(page, "btn:chat");
      expect(await hasUi(page, "key:send")).toBe(true);
      await evidenceShot(page, `133-${screen.name}-keyboard`);
      expect(errors).toEqual([]);
    });
  }
});
