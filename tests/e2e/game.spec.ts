import { expect, test } from "@playwright/test";
import {
  chatDraft,
  clickUi,
  expectChat,
  hasUi,
  ready,
  say,
  sessionStats,
  stickDirection,
  tapKeys,
  tapUi,
  uiRect,
  uiState,
} from "./ui.ts";

test("standard gamepad moves the player and handles buttons", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      connected: true,
      id: "Test Switch controller",
      index: 0,
      mapping: "standard",
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [pad],
    });
    (globalThis as unknown as { __testPad: typeof pad }).__testPad = pad;
  });
  await page.goto("/?harness=1&gamepad-debug=1");
  await ready(page);
  await expect(page.locator("#live-status")).toContainText(
    "Test Switch controller",
  );
  await page.locator("#world").click();
  await page.evaluate(() => {
    (globalThis as unknown as { __testPad: { axes: number[] } }).__testPad
      .axes[0] = 1;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(7);
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { axes: number[]; buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.axes[0] = 0;
    pad.axes[2] = 1;
    pad.buttons[7].pressed = true;
  });
  await expect.poll(() =>
    page.evaluate(() => {
      const scene = (globalThis as unknown as {
        __od: {
          scene: { aim: { x: number; y: number }; zoomTarget: number };
        };
      }).__od.scene;
      return scene.aim.x === 1 && scene.aim.y === 0 &&
        scene.zoomTarget > 1;
    })
  ).toBe(true);
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { axes: number[]; buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.axes[2] = 0;
    pad.buttons[7].pressed = false;
    pad.buttons[5].pressed = true;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { aim: { x: number; y: number } } };
      }).__od.scene.aim
    )
  ).toEqual({ x: 0, y: 0 });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { viewZ: number } } }).__od
        .scene.viewZ
    )
  ).toBe(1);
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.buttons[5].pressed = false;
    pad.buttons[1].pressed = true;
  });
  await expect(page.locator("#live-status")).toContainText("Buttons: 1");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
    "BODY",
  );
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.buttons[1].pressed = false;
    pad.buttons[0].pressed = true;
  });
  await expect(page.locator("#live-status")).toContainText("Buttons: 0");
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { menu: boolean } } }).__od
        .scene.menu
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.buttons[0].pressed = false;
    pad.buttons[3].pressed = true;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { menu: boolean } } }).__od
        .scene.menu
    )
  ).toBe(true);
});

test("attached Afterglow layout uses its D-pad and shoulder buttons", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = {
      axes: [0, 0, 0, 0, 0, 0],
      buttons: Array.from({ length: 14 }, () => ({ pressed: false })),
      connected: true,
      id: "Performance Designed Products Afterglow Wireless Deluxe Controller",
      index: 0,
      mapping: "",
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [pad],
    });
    (globalThis as unknown as { __testPad: typeof pad }).__testPad = pad;
  });
  await page.goto("/?harness=1&gamepad-debug=1");
  await ready(page);
  await page.locator("#world").click();
  await page.evaluate(() => {
    (globalThis as unknown as { __testPad: { axes: number[] } }).__testPad
      .axes[4] = 1;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(7);
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { axes: number[]; buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.axes[4] = 0;
    pad.buttons[5].pressed = true;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { viewZ: number } } }).__od
        .scene.viewZ
    )
  ).toBe(1);
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.buttons[5].pressed = false;
    pad.buttons[7].pressed = true;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { zoomTarget: number } } })
        .__od.scene.zoomTarget
    )
  ).toBeGreaterThan(1);
  const zoomedIn = await page.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { zoomTarget: number } } })
      .__od.scene.zoomTarget
  );
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.buttons[7].pressed = false;
    pad.buttons[6].pressed = true;
    pad.buttons[4].pressed = true;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { viewZ: number } } }).__od
        .scene.viewZ
    )
  ).toBe(0);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { zoomTarget: number } } })
        .__od.scene.zoomTarget
    )
  ).toBeLessThan(zoomedIn);
});

test("active wireless pad replaces idle USB charging pad", async ({ page }) => {
  await page.addInitScript(() => {
    const usb = {
      axes: [0, 0, 0, 0, 0, 0],
      buttons: Array.from({ length: 14 }, () => ({ pressed: false })),
      connected: true,
      id: "Afterglow Wireless Deluxe Controller (Vendor: 0e6f Product: 0186)",
      index: 0,
      mapping: "",
    };
    const wireless = {
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
      connected: true,
      id: "Wireless controller",
      index: 1,
      mapping: "standard",
    };
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [usb, wireless],
    });
    (globalThis as unknown as { __wirelessPad: typeof wireless })
      .__wirelessPad = wireless;
  });
  await page.goto("/?harness=1&gamepad-debug=1");
  await ready(page);
  await page.locator("#world").click();
  await page.evaluate(() => {
    (globalThis as unknown as { __wirelessPad: { axes: number[] } })
      .__wirelessPad.axes[0] = 1;
  });
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(7);
  await expect(page.locator("#live-status")).toContainText(
    "Wireless controller",
  );
});

test("Escape closes the chat bar without opening the game menu", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("t");
  await expectChat(page, true);
  await page.keyboard.type("draft");
  await expect.poll(() => chatDraft(page)).toBe("draft");
  await page.keyboard.press("Escape");
  const ui = await page.evaluate(() => {
    const scene = (globalThis as unknown as {
      __od: { scene: { menu: boolean; chatOpen: boolean; chatDraft: string } };
    }).__od.scene;
    return {
      menu: scene.menu,
      chatOpen: scene.chatOpen,
      chatDraft: scene.chatDraft,
    };
  });
  expect(ui).toEqual({ menu: false, chatOpen: false, chatDraft: "" });
});

test("F3 toggles live host diagnostics", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("F3");
  await expect.poll(() => hasUi(page, "panel:diagnostics")).toBe(true);
  await expect.poll(async () => (await uiState(page)).diagnostics).toContain(
    "Join failures",
  );
  await page.keyboard.press("F3");
  await expect.poll(() => hasUi(page, "panel:diagnostics")).toBe(false);
});

test("local world renders, moves, names and chats", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  const before = await page.evaluate(() =>
    (globalThis as unknown as {
      __od: { scene: { world: { players: { self: { x: number } } } } };
    }).__od.scene.world.players.self.x
  );
  await page.keyboard.down("f");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(before);
  await page.keyboard.up("f");
  await say(page, "/nick Josh Hale");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { name: string } } } } };
      }).__od.scene.world.players.self.name
    )
  ).toBe("Josh Hale");
  await page.keyboard.press("t");
  await page.keyboard.type("hello");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { typing: boolean } } } } };
      }).__od.scene.world.players.self.typing
    )
  ).toBe(true);
  await page.keyboard.press("Enter");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { message: string } } } } };
      }).__od.scene.world.players.self.message
    )
  ).toBe("hello");
  await page.keyboard.press("Escape");
  await expect(page).toHaveScreenshot("desktop-menu.png", {
    maxDiffPixelRatio: 0.02,
  });
  await clickUi(page, "btn:settings");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { menuPage: string } } }).__od
        .scene.menuPage
    )
  ).toBe("settings");
  await clickUi(page, "btn:scale-up");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { uiScale: number } } }).__od
        .scene.uiScale
    )
  ).toBe(1.25);
});

test("phone controls fit safe area and move", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/?harness=1");
  await ready(page);
  await uiRect(page, "stick:move");
  await expect(page).toHaveScreenshot("phone-world.png", {
    maxDiffPixelRatio: 0.02,
  });
  const rect = await uiRect(page, "stick:move");
  const box = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect.poll(() => stickDirection(page, "move")).toBe("center");
  await page.mouse.move(box!.x + box!.width / 2 + 10, box!.y + box!.height / 2);
  await expect.poll(() => stickDirection(page, "move")).toBe("center");
  await page.mouse.move(
    box!.x + box!.width * 0.75,
    box!.y + box!.height * 0.25,
  );
  await expect.poll(() => stickDirection(page, "move")).toBe("1,-1");
  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height / 2);
  await expect.poll(() => stickDirection(page, "move")).toBe("1,0");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(7);
  await page.mouse.up();
  await expect.poll(() => stickDirection(page, "move")).toBe("center");
  await clickUi(page, "btn:chat");
  await expectChat(page, true);
  await tapKeys(page, "hello phone");
  // The game draws its own keyboard, so nothing takes focus and no system keyboard opens.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
    "BODY",
  );
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { typing: boolean } } } } };
      }).__od.scene.world.players.self.typing
    )
  ).toBe(true);
  for (let i = 0; i < "hello phone".length; i++) {
    await tapUi(page, "key:backspace");
  }
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { typing: boolean } } } } };
      }).__od.scene.world.players.self.typing
    )
  ).toBe(false);
  await tapUi(page, "key:close");
  const landscape = await context.newPage();
  await landscape.setViewportSize({ width: 844, height: 390 });
  await landscape.goto("/?harness=1");
  await ready(landscape);
  for (const id of ["stick:move", "stick:look"]) {
    const rect = await uiRect(landscape, id);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.h).toBeLessThanOrEqual(390);
  }
  await expect(landscape).toHaveScreenshot("phone-landscape.png", {
    maxDiffPixelRatio: 0.02,
  });
  await context.close();
});

test("view commands, layer keys and held zoom work in the rendered world", async ({ page }) => {
  await page.goto("/?harness=1&seed=snapshot");
  await ready(page);
  const scene = () =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: {
          scene: {
            viewMode: string;
            viewZ: number;
            zoom: number;
            zoomTarget: number;
          };
        };
      }).__od.scene
    );
  await say(page, "/master");
  await expect.poll(async () => (await scene()).viewMode).toBe("master");
  for (let i = 0; i < 10; i++) await page.keyboard.press("r");
  await expect.poll(async () => (await scene()).viewZ).toBe(7);
  await page.evaluate(() => {
    (globalThis as unknown as { __od: { scene: { camera: { y: number } } } })
      .__od.scene.camera.y = 750;
  });
  await expect(page).toHaveScreenshot("master-upper-staircase.png", {
    maxDiffPixelRatio: 0.02,
  });
  for (let i = 0; i < 10; i++) await page.keyboard.press("v");
  await expect.poll(async () => (await scene()).viewZ).toBe(0);
  const before = (await scene()).zoom;
  await page.keyboard.down("n");
  await expect.poll(async () => (await scene()).zoomTarget).toBeGreaterThan(
    before + 0.1,
  );
  await page.keyboard.up("n");
  const after = await scene();
  expect(after.zoom).toBeGreaterThan(before);
  expect(after.zoom).toBeLessThan(after.zoomTarget);
  await say(page, "/entity");
  await expect.poll(async () => (await scene()).viewMode).toBe("entity");
});

test("entity look selects an octant without panning the camera", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  const scene = () =>
    page.evaluate(() => {
      const { aim, camera } = (globalThis as unknown as {
        __od: {
          scene: {
            aim: { x: number; y: number };
            camera: { x: number; y: number };
          };
        };
      }).__od.scene;
      return { aim: { ...aim }, camera: { ...camera } };
    });
  await expect.poll(async () => (await scene()).aim).toEqual({ x: 0, y: 0 });
  await page.keyboard.down("i");
  await page.keyboard.down("l");
  await expect.poll(async () => (await scene()).aim).toEqual({ x: 1, y: -1 });
  const before = (await scene()).camera;
  await page.waitForTimeout(200);
  const after = (await scene()).camera;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  await page.keyboard.up("l");
  await expect.poll(async () => (await scene()).aim).toEqual({ x: 0, y: -1 });
  await page.keyboard.up("i");
  await expect.poll(async () => (await scene()).aim).toEqual({ x: 0, y: 0 });
});

test("Ctrl+R keeps browser refresh available and leaves the view level", async ({ page }) => {
  await page.goto("/?harness=1");
  await ready(page);
  await page.keyboard.press("r");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { viewZ: number } } }).__od
        .scene.viewZ
    )
  ).toBe(1);
  await page.evaluate(() => {
    document.addEventListener("keydown", (event) => {
      if (event.code === "KeyR" && event.ctrlKey) {
        (globalThis as unknown as { __ctrlRPrevented: boolean })
          .__ctrlRPrevented = event.defaultPrevented;
      }
    });
  });
  await page.keyboard.press("Control+r");
  expect(
    await page.evaluate(() =>
      (globalThis as unknown as { __ctrlRPrevented: boolean }).__ctrlRPrevented
    ),
  ).toBe(false);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { viewZ: number } } }).__od
        .scene.viewZ
    )
  ).toBe(1);
});

test("two-finger drag changes layer and pinch smoothly changes zoom", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/?harness=1");
  await ready(page);
  const cdp = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number; id: number }[],
  ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await page.evaluate(() => {
    (globalThis as unknown as { __od: { scene: { viewZ: number } } }).__od.scene
      .viewZ = 3;
  });
  await touch("touchStart", [{ x: 140, y: 300, id: 1 }, {
    x: 240,
    y: 300,
    id: 2,
  }]);
  await touch("touchMove", [{ x: 140, y: 400, id: 1 }, {
    x: 240,
    y: 400,
    id: 2,
  }]);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { viewZ: number; touchGesture: boolean } };
      }).__od.scene.viewZ
    )
  ).toBe(1);
  await touch("touchEnd", []);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { touchGesture: boolean } } })
        .__od.scene.touchGesture
    )
  ).toBe(false);
  await touch("touchStart", [{ x: 140, y: 300, id: 3 }, {
    x: 240,
    y: 300,
    id: 4,
  }]);
  await touch("touchMove", [{ x: 100, y: 300, id: 3 }, {
    x: 280,
    y: 300,
    id: 4,
  }]);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { zoomTarget: number } } })
        .__od.scene.zoomTarget
    )
  ).toBeGreaterThan(1.5);
  await touch("touchEnd", []);
  await context.close();
});

test("joining player connects over WebRTC and moves in the host world", async ({ browser }) => {
  const visitor = await browser.newPage();
  const admin = await browser.newPage();
  await visitor.goto("/?harness=1");
  await ready(visitor);
  const session = await visitor.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await admin.goto("/host?harness=1");
  await ready(admin);
  await expect.poll(() => hasUi(admin, `btn:session:${session}`), {
    timeout: 10_000,
  }).toBe(true);
  await clickUi(admin, `btn:session:${session}`);
  await expect.poll(
    () =>
      admin.evaluate(() =>
        (globalThis as unknown as { __od: { scene: { localId: string } } })
          .__od.scene.localId
      ),
    { timeout: 15_000 },
  ).toMatch(/^peer-/);
  const guestId = await admin.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  await expect.poll(() =>
    visitor.evaluate(() =>
      Object.keys(
        (globalThis as unknown as {
          __od: { scene: { world: { players: object } } };
        }).__od.scene.world.players,
      )
    )
  ).toContain(guestId);
  await expect.poll(() => sessionStats(admin), {
    timeout: 12_000,
  }).toMatch(/RTT median \d+ ms/);
  await expect.poll(() => sessionStats(admin), {
    timeout: 12_000,
  }).toMatch(/route (host|srflx|relay)\/(host|srflx|relay)/);
  await admin.keyboard.down("f");
  await expect.poll(() =>
    visitor.evaluate((id) =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: Record<string, { x: number }> } } };
      }).__od.scene.world.players[id]?.x ?? -1, guestId), { timeout: 12_000 })
    .toBeGreaterThan(8);
  await admin.keyboard.up("f");
  await visitor.close();
  await expect.poll(
    () =>
      admin.evaluate(() =>
        (globalThis as unknown as { __od: { scene: { status: string } } })
          .__od.scene.status
      ),
    { timeout: 8_000 },
  ).toBe("Visitor left. World ended.");
  await admin.close();
});
