import { expect, test } from "@playwright/test";

import {
  engineKeyDown,
  engineKeyUp,
  enginePress,
  engineResetWorld,
  engineSnapshot,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";
import { expectServedEngineWasm } from "./helpers/wasm-provenance.ts";

// Stage 1 deliberately changes every value here to 1 after its narrow-read
// conversion. Keeping one table makes that contract explicit.
const STAGE_0_SNAPSHOT_CALLS = {
  idle: 4,
  tick: 7,
  movementTick: 7,
  cameraOnly: 4,
  chat: 4,
} as const;

async function frameSnapshotWithCount(
  page: Parameters<typeof engineSnapshot>[0],
  expected: number,
) {
  const snapshot = await engineSnapshot(page);
  expect(snapshot.worldRender.snapshotCallsLastFrame).toBe(expected);
  return snapshot;
}

test.describe.configure({ mode: "serial" });

test("Stage 0 hot-path snapshot counts cover deterministic frame paths", async ({ page }) => {
  const provenance = await expectServedEngineWasm(page);
  expect(provenance.metadata.profile).toBe("debug");
  expect(provenance.served.sha256).toBe(provenance.metadata.wasm.sha256);
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  const idle = await frameSnapshotWithCount(
    page,
    STAGE_0_SNAPSHOT_CALLS.idle,
  );
  expect(idle.world.tick).toBe(0);

  // 3 × 16 ms leaves the 50 ms fixed-tick accumulator below threshold; the
  // fourth frame is exactly the single deterministic tick frame.
  await engineResetWorld(page, "default");
  const tickBefore = await engineSnapshot(page);
  await stepEngineFrame(page, 3);
  await stepEngineFrame(page, 1);
  const tick = await frameSnapshotWithCount(page, STAGE_0_SNAPSHOT_CALLS.tick);
  expect(tick.world.tick).toBe(tickBefore.world.tick + 1);

  await engineResetWorld(page, "default");
  const movementBefore = await engineSnapshot(page);
  await enginePress(page, "KeyS");
  await stepEngineFrame(page, 3);
  await stepEngineFrame(page, 1);
  const movement = await frameSnapshotWithCount(
    page,
    STAGE_0_SNAPSHOT_CALLS.movementTick,
  );
  expect(movement.world.tick).toBe(movementBefore.world.tick + 1);
  expect(movement.world.primaryEntity?.movement).not.toBeNull();

  await engineResetWorld(page, "default");
  const cameraBefore = await engineSnapshot(page);
  await engineKeyDown(page, "KeyI");
  await stepEngineFrame(page, 1);
  await engineKeyUp(page, "KeyI");
  const camera = await frameSnapshotWithCount(
    page,
    STAGE_0_SNAPSHOT_CALLS.cameraOnly,
  );
  expect(camera.world.tick).toBe(cameraBefore.world.tick);
  expect(camera.localWorldView.lookOffset.y).toBeLessThan(
    cameraBefore.localWorldView.lookOffset.y,
  );
  expect(camera.localWorldView.camera.y).toBeLessThan(
    cameraBefore.localWorldView.camera.y,
  );

  await engineResetWorld(page, "default");
  const chatBefore = await engineSnapshot(page);
  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);
  const chat = await frameSnapshotWithCount(page, STAGE_0_SNAPSHOT_CALLS.chat);
  expect(chat.world.tick).toBe(chatBefore.world.tick);
  expect(chat.session.uiMode).toBe("chat");

  console.log(
    `engine debug provenance: profile=${provenance.metadata.profile} metadata=${provenance.metadata.wasm.sha256} served=${provenance.served.sha256}`,
  );
  console.log(
    `Stage 0 snapshot calls: idle=${STAGE_0_SNAPSHOT_CALLS.idle} tick=${STAGE_0_SNAPSHOT_CALLS.tick} movement=${STAGE_0_SNAPSHOT_CALLS.movementTick} camera=${STAGE_0_SNAPSHOT_CALLS.cameraOnly} chat=${STAGE_0_SNAPSHOT_CALLS.chat}`,
  );
});
