import { expect, test } from "@playwright/test";

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
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("#display-status")).toContainText(
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
  await expect(page.locator("#display-status")).toContainText("Buttons: 1");
  await expect(page.locator("#chat-input")).not.toBeFocused();
  await page.evaluate(() => {
    const pad = (globalThis as unknown as {
      __testPad: { buttons: { pressed: boolean }[] };
    }).__testPad;
    pad.buttons[1].pressed = false;
    pad.buttons[0].pressed = true;
  });
  await expect(page.locator("#display-status")).toContainText("Buttons: 0");
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
  await expect(page.locator("#loading")).toBeHidden();
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
  await expect(page.locator("#loading")).toBeHidden();
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
  await expect(page.locator("#display-status")).toContainText(
    "Wireless controller",
  );
});

test("Escape closes the chat bar without opening the game menu", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
  await page.keyboard.press("t");
  await page.locator("#chat-input").fill("draft");
  await page.locator("#chat-input").press("Escape");
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
  await expect(page.locator("#loading")).toBeHidden();
  await page.keyboard.press("F3");
  await expect(page.locator("#diagnostics")).toBeVisible();
  await expect(page.locator("#diagnostics")).toContainText("Join failures");
  await page.keyboard.press("F3");
  await expect(page.locator("#diagnostics")).toBeHidden();
});

test("local world renders, moves, names and chats", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
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
  await page.keyboard.press("t");
  await page.locator("#chat-input").fill("/nick Josh Hale");
  await page.locator("#chat-input").press("Enter");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { name: string } } } } };
      }).__od.scene.world.players.self.name
    )
  ).toBe("Josh Hale");
  await page.keyboard.press("t");
  await page.locator("#chat-input").fill("hello");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { typing: boolean } } } } };
      }).__od.scene.world.players.self.typing
    )
  ).toBe(true);
  await page.locator("#chat-input").press("Enter");
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
  await page.mouse.click(640, 334);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { menuPage: string } } }).__od
        .scene.menuPage
    )
  ).toBe("settings");
  await page.mouse.click(696, 350);
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
  await expect(page.locator("#loading")).toBeHidden();
  await expect(page.locator("[data-stick=move]")).toBeVisible();
  await expect(page).toHaveScreenshot("phone-world.png", {
    maxDiffPixelRatio: 0.02,
  });
  const box = await page.locator("[data-stick=move]").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(page.locator("[data-stick=move]")).toHaveAttribute(
    "data-direction",
    "center",
  );
  await page.mouse.move(box!.x + box!.width / 2 + 10, box!.y + box!.height / 2);
  await expect(page.locator("[data-stick=move]")).toHaveAttribute(
    "data-direction",
    "center",
  );
  await page.mouse.move(
    box!.x + box!.width * 0.75,
    box!.y + box!.height * 0.25,
  );
  await expect(page.locator("[data-stick=move]")).toHaveAttribute(
    "data-direction",
    "1,-1",
  );
  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height / 2);
  await expect(page.locator("[data-stick=move]")).toHaveAttribute(
    "data-direction",
    "1,0",
  );
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(7);
  await page.mouse.up();
  await expect(page.locator("[data-stick=move]")).toHaveAttribute(
    "data-direction",
    "center",
  );
  await page.locator("#chat-button").click();
  await expect(page.locator("#chat-input")).toBeFocused();
  await page.locator("#chat-input").fill("hello phone");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { typing: boolean } } } } };
      }).__od.scene.world.players.self.typing
    )
  ).toBe(true);
  await page.locator("#chat-input").fill("");
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { typing: boolean } } } } };
      }).__od.scene.world.players.self.typing
    )
  ).toBe(false);
  await page.locator("#chat-input").press("Escape");
  const landscape = await context.newPage();
  await landscape.setViewportSize({ width: 844, height: 390 });
  await landscape.goto("/?harness=1");
  await expect(landscape.locator("#loading")).toBeHidden();
  await expect(landscape.locator("[data-stick=move]")).toBeInViewport();
  await expect(landscape.locator("[data-stick=camera]")).toBeInViewport();
  await expect(landscape).toHaveScreenshot("phone-landscape.png", {
    maxDiffPixelRatio: 0.02,
  });
  await context.close();
});

test("view commands, layer keys and held zoom work in the rendered world", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
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
  await page.keyboard.press("/");
  await page.locator("#chat-input").fill("/master");
  await page.locator("#chat-input").press("Enter");
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
  await page.keyboard.press("/");
  await page.locator("#chat-input").fill("/entity");
  await page.locator("#chat-input").press("Enter");
  await expect.poll(async () => (await scene()).viewMode).toBe("entity");
});

test("entity look selects an octant without panning the camera", async ({ page }) => {
  await page.goto("/?harness=1");
  await expect(page.locator("#loading")).toBeHidden();
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
  await expect(page.locator("#loading")).toBeHidden();
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
  await expect(page.locator("#loading")).toBeHidden();
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
  await expect(visitor.locator("#loading")).toBeHidden();
  const session = await visitor.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await admin.goto("/admin?harness=1");
  await expect(admin.locator("#loading")).toBeHidden();
  await expect(admin.locator('[data-transport="sse"]')).toHaveCount(0);
  const join = admin.locator(
    `[data-session-id="${session}"][data-transport="webrtc"]`,
  );
  await expect(join).toBeVisible();
  await join.click();
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
  await expect.poll(() => admin.locator("#net-stats").textContent(), {
    timeout: 12_000,
  }).toMatch(/RTT median \d+ ms/);
  await expect.poll(() => admin.locator("#net-stats").textContent(), {
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

test("opt-in phone test drops and rejoins the same player", async ({ browser }) => {
  const host = await browser.newPage();
  const phone = await browser.newPage();
  await host.goto("/?harness=1");
  await expect(host.locator("#loading")).toBeHidden();
  const session = await host.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await phone.goto(`/phone-test?harness=1&session=${session}`);
  const code = await phone.locator("#phone-test-code").textContent();
  expect(code).toMatch(/^[a-f0-9]{32}$/);
  await expect.poll(() =>
    phone.evaluate(() =>
      (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
        .scene.localId
    )
  ).toMatch(/^peer-/);
  const guestId = await phone.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
      .scene.localId
  );
  await expect.poll(() => phone.locator("#phone-test-status").textContent(), {
    timeout: 8_000,
  }).toMatch(/route (host|srflx|relay)\/(host|srflx|relay).*RTT median \d+ ms/);
  await phone.keyboard.press("/");
  await phone.locator("#chat-input").fill("/nick RejoinTest");
  await phone.keyboard.press("Enter");
  await expect.poll(() =>
    host.evaluate((id) =>
      (globalThis as unknown as {
        __od: {
          scene: { world: { players: Record<string, { name: string }> } };
        };
      }).__od.scene.world.players[id]?.name, guestId)
  ).toBe("RejoinTest");
  const command = await phone.request.post(`/api/phone-test/${code}/command`, {
    data: { kind: "drop" },
  });
  expect(command.ok()).toBeTruthy();
  const commandId = (await command.json()).command.id;
  await expect.poll(async () => {
    const response = await phone.request.get(`/api/phone-test/${code}/state`);
    const state = await response.json();
    return state.command?.id === commandId && state.result?.dropped === true;
  }).toBe(true);
  await expect.poll(
    () =>
      phone.evaluate(() =>
        (globalThis as unknown as { __od: { scene: { status: string } } }).__od
          .scene.status
      ),
    { timeout: 20_000 },
  ).toBe("Visitor world");
  await expect.poll(() =>
    host.evaluate((id) =>
      (globalThis as unknown as {
        __od: {
          scene: { world: { players: Record<string, { name: string }> } };
        };
      }).__od.scene.world.players[id]?.name, guestId)
  ).toBe("RejoinTest");
  const longDrop = await phone.request.post(`/api/phone-test/${code}/command`, {
    data: { kind: "drop", data: "6500" },
  });
  expect(longDrop.ok()).toBeTruthy();
  await expect.poll(() =>
    host.evaluate((id) =>
      (globalThis as unknown as {
        __od: {
          scene: { world: { players: Record<string, { name: string }> } };
        };
      }).__od.scene.world.players[id]?.name, guestId), { timeout: 8_000 })
    .toBeUndefined();
  await expect.poll(() =>
    host.evaluate((id) =>
      (globalThis as unknown as {
        __od: {
          scene: { world: { players: Record<string, { name: string }> } };
        };
      }).__od.scene.world.players[id]?.name, guestId), { timeout: 12_000 })
    .toBe("RejoinTest");
  await phone.close();
  await host.close();
});

test("phone test keeps its code when switching to forced relay", async ({ page }) => {
  await page.goto("/phone-test?harness=1");
  const code = await page.locator("#phone-test-code").textContent();
  expect(code).toMatch(/^[a-f0-9]{32}$/);
  await expect.poll(async () =>
    (await page.request.get(`/api/phone-test/${code}/state`)).status()
  ).toBe(200);
  const command = await page.request.post(`/api/phone-test/${code}/command`, {
    data: { kind: "relay", data: "1" },
  });
  expect(command.ok()).toBeTruthy();
  await expect(page).toHaveURL(/relay=1/);
  await expect(page.locator("#phone-test-code")).toHaveText(code!);
  await expect.poll(() => page.url()).toContain("relay=1");
});
