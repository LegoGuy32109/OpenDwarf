import { expect, test } from "@playwright/test";

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
  await admin.keyboard.down("f");
  await expect.poll(() =>
    visitor.evaluate((id) =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: Record<string, { x: number }> } } };
      }).__od.scene.world.players[id]?.x, guestId)
  ).toBeGreaterThan(8);
  await admin.keyboard.up("f");
  await expect.poll(() => admin.locator("#net-stats").textContent(), {
    timeout: 8_000,
  }).toMatch(/RTT median \d+ ms/);
  await expect.poll(() => admin.locator("#net-stats").textContent(), {
    timeout: 8_000,
  }).toMatch(/route (host|srflx|relay)\/(host|srflx|relay)/);
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

test("TURN relay join reports a relay candidate", async ({ browser }) => {
  test.skip(
    Deno.env.get("OD_TEST_RELAY") !== "1",
    "requires local TURN credentials",
  );
  const visitor = await browser.newPage();
  const admin = await browser.newPage();
  await visitor.goto("/?harness=1");
  await expect(visitor.locator("#loading")).toBeHidden();
  const session = await visitor.evaluate(() =>
    (globalThis as unknown as { __od: { scene: { sessionId: string } } }).__od
      .scene.sessionId
  );
  await admin.goto("/admin?harness=1&relay=1");
  await expect(admin.locator("#loading")).toBeHidden();
  await admin.locator(`[data-session-id="${session}"]`).click();
  await expect.poll(
    () =>
      admin.evaluate(() =>
        (globalThis as unknown as { __od: { scene: { localId: string } } }).__od
          .scene.localId
      ),
    { timeout: 30_000 },
  ).toMatch(/^peer-/);
  await expect.poll(() => admin.locator("#net-stats").textContent(), {
    timeout: 15_000,
  }).toMatch(/route relay\/relay/);
  await expect.poll(() => admin.locator("#net-stats").textContent(), {
    timeout: 15_000,
  }).toMatch(/RTT median \d+ ms/);
  await visitor.close();
  await admin.close();
});
