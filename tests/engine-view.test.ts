import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  engineKeyDown,
  engineKeyUp,
  enginePress,
  engineResetWorld,
  engineSnapshot,
  engineStepSimTick,
  engineTypeText,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";

async function submitSlash(page: Page, command: string) {
  await enginePress(page, "Slash");
  await stepEngineFrame(page, 1);
  await engineTypeText(page, command.slice(1));
  await stepEngineFrame(page, 1);
  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);
}

test("engine LocalWorldView handles viewZ, zoom, slash modes, and camera behavior", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");
  await stepEngineFrame(page, 1);

  const boot = await engineSnapshot(page);
  expect(boot.localWorldView.viewMode).toBe("entity");
  expect(boot.localWorldView.camera.zoom).toBe(1);

  await enginePress(page, "KeyR");
  await stepEngineFrame(page, 1);
  let snapshot = await engineSnapshot(page);
  expect(snapshot.localWorldView.viewZ).toBe(boot.localWorldView.viewZ + 1);
  expect(snapshot.viewGlobals.sim[1]).toBe(snapshot.localWorldView.viewZ);

  await enginePress(page, "KeyV");
  await stepEngineFrame(page, 1);
  snapshot = await engineSnapshot(page);
  expect(snapshot.localWorldView.viewZ).toBe(boot.localWorldView.viewZ);

  await enginePress(page, "KeyM");
  await stepEngineFrame(page, 1);
  snapshot = await engineSnapshot(page);
  expect(snapshot.localWorldView.camera.zoom).toBe(1.5);
  expect(snapshot.viewGlobals.camera[2]).toBe(1.5);

  await submitSlash(page, "/master");
  snapshot = await engineSnapshot(page);
  expect(snapshot.localWorldView.viewMode).toBe("master");
  expect(snapshot.session.chatMessages).not.toContain("/master");

  const masterBefore = snapshot;
  await engineKeyDown(page, "KeyL");
  await stepEngineFrame(page, 4);
  await engineKeyUp(page, "KeyL");
  snapshot = await engineSnapshot(page);
  expect(snapshot.localWorldView.camera.x).toBeGreaterThan(
    masterBefore.localWorldView.camera.x,
  );
  expect(snapshot.world.primaryEntity?.position).toEqual(
    masterBefore.world.primaryEntity?.position,
  );

  await submitSlash(page, "/entity");
  snapshot = await engineSnapshot(page);
  expect(snapshot.localWorldView.viewMode).toBe("entity");
  expect(snapshot.session.chatMessages).not.toContain("/entity");

  const entityBefore = snapshot;
  await engineKeyDown(page, "KeyS");
  let moved = false;
  for (let i = 0; i < 24; i++) {
    await engineStepSimTick(page, 1);
    snapshot = await engineSnapshot(page);
    if (
      snapshot.world.primaryEntity?.position.x !==
        entityBefore.world.primaryEntity?.position.x ||
      snapshot.world.primaryEntity?.position.y !==
        entityBefore.world.primaryEntity?.position.y
    ) {
      moved = true;
      break;
    }
  }
  await engineKeyUp(page, "KeyS");
  expect(moved).toBe(true);
  expect(snapshot.localWorldView.camera.x).not.toBe(
    entityBefore.localWorldView.camera.x,
  );
});

test("engine play world streams a viewport window plus entity safety chunks", async ({ page }) => {
  await page.goto("/engine?harness=1");
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");
  await engineResetWorld(page, "play");
  await stepEngineFrame(page, 1);

  const snapshot = await engineSnapshot(page);
  const totalChunks = snapshot.world.worldChunks.x *
    snapshot.world.worldChunks.y *
    snapshot.world.worldChunks.z;
  expect(totalChunks).toBeGreaterThan(1);
  expect(snapshot.world.loadedChunkCount).toBeGreaterThanOrEqual(9);
  expect(snapshot.world.loadedChunkCount).toBeLessThan(totalChunks);
  expect(snapshot.localWorldView.streamingChunks.length).toBe(
    snapshot.world.loadedChunkCount,
  );
});
