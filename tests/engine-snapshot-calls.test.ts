import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  engineKeyDown,
  engineKeyUp,
  enginePress,
  engineResetWorld,
  engineSnapshot,
  engineTypeText,
  stepEngineFrame,
  waitForEngineHarness,
} from "./helpers/engine-harness.ts";
import { expectServedEngineWasm } from "./helpers/wasm-provenance.ts";

// Stage 4: the renderer consumes only the projected ClientView, so every
// frame path performs zero WorldSim::snapshot() calls (authorized update of
// the Stage 0/1 matrix: 4/7/... -> 1 -> 0).
const STAGE_4_SNAPSHOT_CALLS = {
  idle: 0,
  tick: 0,
  movementTick: 0,
  cameraOnly: 0,
  zoom: 0,
  viewZ: 0,
  resize: 0,
  masterEntity: 0,
  chat: 0,
  shell: 0,
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

test("Stage 4 hot-path snapshot counts are zero on every frame path", async ({ page }) => {
  const provenance = await expectServedEngineWasm(page);
  const expectedProfile = process.env.ENGINE_EXPECTED_PROFILE;
  if (expectedProfile) {
    expect(provenance.metadata.profile).toBe(expectedProfile);
  } else {
    expect(["debug", "release"]).toContain(provenance.metadata.profile);
  }
  expect(provenance.served.sha256).toBe(provenance.metadata.wasm.sha256);
  await waitForEngineHarness(page);
  await page.focus("#engine-canvas");

  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  const idle = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.idle,
  );
  expect(idle.world.tick).toBe(0);

  // 3 × 16 ms leaves the 50 ms fixed-tick accumulator below threshold; the
  // fourth frame is exactly the single deterministic tick frame.
  await engineResetWorld(page, "default");
  const tickBefore = await engineSnapshot(page);
  await stepEngineFrame(page, 3);
  await stepEngineFrame(page, 1);
  const tick = await frameSnapshotWithCount(page, STAGE_4_SNAPSHOT_CALLS.tick);
  expect(tick.world.tick).toBe(tickBefore.world.tick + 1);

  await engineResetWorld(page, "default");
  const movementBefore = await engineSnapshot(page);
  await enginePress(page, "KeyS");
  await stepEngineFrame(page, 3);
  await stepEngineFrame(page, 1);
  const movement = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.movementTick,
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
    STAGE_4_SNAPSHOT_CALLS.cameraOnly,
  );
  expect(camera.world.tick).toBe(cameraBefore.world.tick);
  expect(camera.localWorldView.lookOffset.y).toBeLessThan(
    cameraBefore.localWorldView.lookOffset.y,
  );
  expect(camera.localWorldView.camera.y).toBeLessThan(
    cameraBefore.localWorldView.camera.y,
  );

  // Zoom-only frame: zoom steps while the world tick stays put.
  await engineResetWorld(page, "default");
  const zoomBefore = await engineSnapshot(page);
  await enginePress(page, "KeyM");
  await stepEngineFrame(page, 1);
  const zoom = await frameSnapshotWithCount(page, STAGE_4_SNAPSHOT_CALLS.zoom);
  expect(zoom.world.tick).toBe(zoomBefore.world.tick);
  expect(zoom.localWorldView.camera.zoom).toBeGreaterThan(
    zoomBefore.localWorldView.camera.zoom,
  );

  // View-z frame: the z slice moves while the world tick stays put.
  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  const viewZBefore = await engineSnapshot(page);
  await enginePress(page, "KeyR");
  await stepEngineFrame(page, 1);
  const viewZ = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.viewZ,
  );
  expect(viewZ.world.tick).toBe(viewZBefore.world.tick);
  expect(viewZ.localWorldView.viewZ).toBe(
    viewZBefore.localWorldView.viewZ + 1,
  );

  // Resize frame: the framebuffer changes while residency/hash stay local.
  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  const resizeBefore = await engineSnapshot(page);
  await page.setViewportSize({ width: 900, height: 600 });
  await expect
    .poll(async () => {
      await stepEngineFrame(page, 1);
      const current = await engineSnapshot(page);
      return current.render.framebufferWidth;
    })
    .not.toBe(resizeBefore.render.framebufferWidth);
  const resize = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.resize,
  );
  expect(resize.render.framebufferWidth).not.toBe(
    resizeBefore.render.framebufferWidth,
  );
  expect(resize.world.loadedChunkCount).toBe(
    resizeBefore.world.loadedChunkCount,
  );

  // Master/entity switch frames: the view mode flips both ways.
  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Slash");
  await stepEngineFrame(page, 1);
  await engineTypeText(page, "master");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);
  await stepEngineFrame(page, 1);
  const master = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.masterEntity,
  );
  expect(master.localWorldView.viewMode).toBe("master");
  await enginePress(page, "Slash");
  await stepEngineFrame(page, 1);
  await engineTypeText(page, "entity");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Enter");
  await stepEngineFrame(page, 1);
  await stepEngineFrame(page, 1);
  const entity = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.masterEntity,
  );
  expect(entity.localWorldView.viewMode).toBe("entity");

  await engineResetWorld(page, "default");
  const chatBefore = await engineSnapshot(page);
  await enginePress(page, "KeyT");
  await stepEngineFrame(page, 1);
  const chat = await frameSnapshotWithCount(page, STAGE_4_SNAPSHOT_CALLS.chat);
  expect(chat.world.tick).toBe(chatBefore.world.tick);
  expect(chat.session.uiMode).toBe("chat");

  // Shell frame: the session shell opens over the world.
  await engineResetWorld(page, "default");
  await stepEngineFrame(page, 1);
  await enginePress(page, "Escape");
  await stepEngineFrame(page, 1);
  const shell = await frameSnapshotWithCount(
    page,
    STAGE_4_SNAPSHOT_CALLS.shell,
  );
  expect(shell.shell.open).toBe(true);
  await enginePress(page, "Escape");
  await stepEngineFrame(page, 1);

  console.log(
    `engine debug provenance: profile=${provenance.metadata.profile} metadata=${provenance.metadata.wasm.sha256} served=${provenance.served.sha256}`,
  );
  console.log(
    `Stage 4 snapshot calls: idle=${idle.worldRender.snapshotCallsLastFrame} tick=${tick.worldRender.snapshotCallsLastFrame} movement=${movement.worldRender.snapshotCallsLastFrame} camera=${camera.worldRender.snapshotCallsLastFrame} zoom=${zoom.worldRender.snapshotCallsLastFrame} viewZ=${viewZ.worldRender.snapshotCallsLastFrame} resize=${resize.worldRender.snapshotCallsLastFrame} master/entity=${master.worldRender.snapshotCallsLastFrame}/${entity.worldRender.snapshotCallsLastFrame} chat=${chat.worldRender.snapshotCallsLastFrame} shell=${shell.worldRender.snapshotCallsLastFrame}`,
  );

  const reportPath = process.env.ENGINE_SNAPSHOT_REPORT_PATH;
  if (reportPath) {
    const report = {
      schemaVersion: 1,
      stage: Number(process.env.ENGINE_REPORT_STAGE ?? "4"),
      artifact: {
        profile: provenance.metadata.profile,
        metadataSha256: provenance.metadata.wasm.sha256,
        servedSha256: provenance.served.sha256,
      },
      snapshotCalls: {
        idle: idle.worldRender.snapshotCallsLastFrame,
        tick: tick.worldRender.snapshotCallsLastFrame,
        movement: movement.worldRender.snapshotCallsLastFrame,
        camera: camera.worldRender.snapshotCallsLastFrame,
        zoom: zoom.worldRender.snapshotCallsLastFrame,
        viewZ: viewZ.worldRender.snapshotCallsLastFrame,
        resize: resize.worldRender.snapshotCallsLastFrame,
        master: master.worldRender.snapshotCallsLastFrame,
        entity: entity.worldRender.snapshotCallsLastFrame,
        chat: chat.worldRender.snapshotCallsLastFrame,
        shell: shell.worldRender.snapshotCallsLastFrame,
      },
      pathState: {
        idleTick: idle.world.tick,
        tickDelta: tick.world.tick - tickBefore.world.tick,
        movementTickDelta: movement.world.tick - movementBefore.world.tick,
        movementActive: movement.world.primaryEntity?.movement != null,
        cameraTickDelta: camera.world.tick - cameraBefore.world.tick,
        cameraMoved:
          camera.localWorldView.camera.y < cameraBefore.localWorldView.camera.y,
        zoomChanged: zoom.localWorldView.camera.zoom !==
          zoomBefore.localWorldView.camera.zoom,
        viewZDelta: viewZ.localWorldView.viewZ -
          viewZBefore.localWorldView.viewZ,
        framebufferChanged: resize.render.framebufferWidth !==
          resizeBefore.render.framebufferWidth,
        masterMode: master.localWorldView.viewMode,
        entityMode: entity.localWorldView.viewMode,
        chatTickDelta: chat.world.tick - chatBefore.world.tick,
        chatMode: chat.session.uiMode,
        shellOpen: shell.shell.open,
      },
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
});
