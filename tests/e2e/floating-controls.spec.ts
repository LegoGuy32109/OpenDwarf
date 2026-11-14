import { expect, test } from "./fixtures.ts";
import { openWorld, readWorld } from "./world.ts";
import { hasUi, ready, tapUi, uiRect } from "./ui.ts";
import { waitFrames } from "./time.ts";
import { evidenceShot } from "./evidence.ts";

test.describe("floating touch regions", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (
    const screen of [
      { name: "portrait", width: 390, height: 844 },
      { name: "landscape", width: 844, height: 390 },
    ]
  ) {
    test(`thumb origin and priority controls in ${screen.name}`, async ({ page, context }) => {
      await page.setViewportSize(screen);
      await openWorld(page, "/?harness=1");
      await ready(page);
      const cdp = await context.newCDPSession(page);
      const zone = await uiRect(page, "stick:move");
      const stick = () =>
        readWorld(page, (w) => ({ ...w.ui.state.sticks.move }));
      expect((await stick()).active).toBe(false);
      for (const [fx, fy] of [[0.15, 0.15], [0.85, 0.20], [0.50, 0.55]]) {
        const start = {
          id: 1,
          x: zone.x + zone.w * fx,
          y: zone.y + zone.h * fy,
        };
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [start],
        });
        await waitFrames(page);
        expect(await stick()).toMatchObject({
          active: true,
          dir: "center",
        });
        const travel = Math.min(screen.width - start.x - 10, start.y - 10);
        const moved = { ...start, x: start.x + travel, y: start.y - travel };
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [moved],
        });
        await waitFrames(page);
        const state = await stick();
        expect(state.dir).toBe("1,-1");
        expect(state.originX).toBeCloseTo(start.x);
        expect(state.originY).toBeCloseTo(start.y);
        const radius = await readWorld(
          page,
          (w) => w.ui.layout().byId.get("stick:move")!.r!,
        );
        expect(Math.hypot(state.x, state.y)).toBeCloseTo(radius * 0.6);
        await evidenceShot(page, `floating-${screen.name}-${fx}`);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        });
        await waitFrames(page);
        expect((await stick()).active).toBe(false);
      }
      await tapUi(page, "btn:chat");
      expect(await hasUi(page, "key:send")).toBe(true);
      expect((await stick()).active).toBe(false);
      await tapUi(page, "key:close");
      await tapUi(page, "btn:bag");
      expect(await hasUi(page, "panel:bag")).toBe(true);
      expect((await stick()).active).toBe(false);
      await tapUi(page, "btn:bag-close");
      const action = await uiRect(page, "btn:interact");
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 2, x: action.x + 2, y: action.y + 2 }],
      });
      await waitFrames(page);
      expect(await readWorld(page, (w) => w.scene.actionGesture.down)).toBe(
        true,
      );
      expect(await hasUi(page, "action:well")).toBe(false);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchCancel",
        touchPoints: [],
      });
      await waitFrames(page);
      expect(await readWorld(page, (w) => w.scene.actionGesture.down)).toBe(
        false,
      );
      await cdp.detach();
    });
  }
});
