import { expect, test } from "@playwright/test";

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
  const box = await page.locator("[data-stick=move]").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height / 2);
  await expect.poll(() =>
    page.evaluate(() =>
      (globalThis as unknown as {
        __od: { scene: { world: { players: { self: { x: number } } } } };
      }).__od.scene.world.players.self.x
    )
  ).toBeGreaterThan(7);
  await page.mouse.up();
  await expect(page).toHaveScreenshot("phone-world.png", {
    maxDiffPixelRatio: 0.02,
  });
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

for (const transport of ["webrtc", "sse"] as const) {
  test(`admin joins over ${transport} and sees movement`, async ({ browser }) => {
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
    const join = admin.locator(
      `[data-session-id="${session}"][data-transport="${transport}"]`,
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
    ).toBe("admin");
    await expect.poll(() =>
      visitor.evaluate(() =>
        Object.keys(
          (globalThis as unknown as {
            __od: { scene: { world: { players: object } } };
          }).__od.scene.world.players,
        )
      )
    ).toContain("admin");
    await admin.keyboard.down("f");
    await expect.poll(() =>
      visitor.evaluate(() =>
        (globalThis as unknown as {
          __od: { scene: { world: { players: { admin: { x: number } } } } };
        }).__od.scene.world.players.admin.x
      )
    ).toBeGreaterThan(8);
    const samples = await admin.evaluate(() =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const until = performance.now() + 1200;
        const sample = () => {
          const world = (globalThis as unknown as {
            __od: {
              scene: {
                world: {
                  tick: number;
                  players: {
                    admin: {
                      x: number;
                      move: null | {
                        startPosition: { x: number };
                        target: { x: number };
                        startTick: number;
                        durationTicks: number;
                      };
                    };
                  };
                };
              };
            };
          }).__od.scene.world;
          const player = world.players.admin;
          const move = player?.move;
          const progress = move
            ? Math.max(
              0,
              Math.min(1, (world.tick - move.startTick) / move.durationTicks),
            )
            : 0;
          values.push(
            move
              ? move.startPosition.x +
                (move.target.x - move.startPosition.x) * progress
              : player.x,
          );
          if (performance.now() < until) requestAnimationFrame(sample);
          else resolve(values);
        };
        requestAnimationFrame(sample);
      })
    );
    expect(
      Math.min(
        ...samples.slice(1).map((value, index) => value - samples[index]),
      ),
    ).toBeGreaterThan(-0.05);
    await admin.keyboard.up("f");
    await expect.poll(() => admin.locator("#net-stats").textContent(), {
      timeout: 8_000,
    }).toMatch(/RTT median \d+ ms/);
    if (transport === "webrtc") {
      await expect.poll(() => admin.locator("#net-stats").textContent(), {
        timeout: 8_000,
      }).toMatch(/route (host|srflx|relay)\/(host|srflx|relay)/);
    }
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
}
