import { expect, test } from "@playwright/test";
import {
  captureCheckpoint,
  loadFlow,
  stepTick,
  waitForEvent,
  waitForHarness,
} from "./helpers/harness.ts";
import { flow } from "./flows/webgl-step1-single-rock.ts";

test("webgl parity-ish — ESDF moves player through world while camera follows", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const origin = await captureCheckpoint(page, "player_origin");
  expect.soft(origin, "origin checkpoint").not.toBeNull();

  await page.keyboard.down("KeyE");
  await page.waitForTimeout(1_000);
  await page.keyboard.up("KeyE");
  await stepTick(page, 4);

  const moved = await captureCheckpoint(page, "player_moved");
  expect.soft(moved, "moved checkpoint").not.toBeNull();
  expect.soft(moved?.player, "player moved").not.toEqual(origin?.player);
  expect.soft(moved?.camera, "camera followed player").not.toEqual(
    origin?.camera,
  );
  expect.soft(moved?.visibleTileCount, "entity fov visible").toBeGreaterThan(0);
  expect.soft(moved?.drawOrderLabels, "fog layer emitted").toContain("fog");
});

test("webgl parity-ish — slash command toggles view mode", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  await page.keyboard.type("/");
  await page.keyboard.type("master");
  await page.keyboard.press("Enter");
  await stepTick(page, 4);

  const cp = await captureCheckpoint(page, "slash_master");
  expect.soft(cp, "slash checkpoint").not.toBeNull();
  expect.soft(cp?.viewMode, "view mode switched").toBe("master");
  expect.soft(cp?.uiMode, "chat closed").toBe("world");
  expect.soft(cp?.chatBuffer, "chat buffer cleared").toBe("");
});

test("webgl parity-ish — chat typing suppresses game controls", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const origin = await captureCheckpoint(page, "typing_origin");
  expect.soft(origin, "origin checkpoint").not.toBeNull();

  await page.keyboard.press("KeyT");
  await page.keyboard.type("rvesdfijkl");
  await page.keyboard.press("Escape");
  await stepTick(page, 4);

  const cp = await captureCheckpoint(page, "typing_suppressed");
  expect.soft(cp, "typing checkpoint").not.toBeNull();
  expect.soft(cp?.camera, "camera unchanged while typing").toEqual(
    origin?.camera,
  );
  expect.soft(cp?.player, "player unchanged while typing").toEqual(
    origin?.player,
  );
  expect.soft(cp?.uiMode, "chat closed after escape").toBe("world");
});

test("webgl parity-ish — R/V inspects z without moving player", async ({ page }) => {
  await page.goto("/webgl");
  await waitForHarness(page);
  await loadFlow(page, flow);
  await waitForEvent(page, "texture_loaded");
  await stepTick(page, 4);

  const origin = await captureCheckpoint(page, "z_origin");
  expect.soft(origin, "origin checkpoint").not.toBeNull();

  await page.keyboard.press("KeyR");
  await page.keyboard.press("KeyR");
  await page.keyboard.press("KeyV");
  await stepTick(page, 4);

  const inspected = await captureCheckpoint(page, "z_inspected");
  expect.soft(inspected, "z checkpoint").not.toBeNull();
  expect.soft(inspected?.player, "player z unchanged by inspection").toEqual(
    origin?.player,
  );
});
