import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

export type EngineSnapshot = {
  version: number;
  frame: {
    number: number;
    drawCount: number;
    droppedRects: number;
    droppedGlyphs: number;
    droppedDrawCmds: number;
    drawHash?: string;
  };
  shell: {
    open: boolean;
    page: "root" | "settings";
  };
  session: {
    uiMode: "world" | "chat";
    chatDraft: string;
    chatCaret: number;
    chatMessages: string[];
    hud?: string[];
  };
  input: {
    canvasFocused: boolean;
    textCaptureActive: boolean;
    hiddenInputFocused: boolean;
  };
  render: {
    framebufferWidth: number;
    framebufferHeight: number;
  };
  world: {
    tick: number;
    chunkEdge: number;
    worldChunks: { x: number; y: number; z: number };
    world_state_hash: string;
    worldStateHash: string;
    primary_entity_id: number | null;
    primaryEntityId: number | null;
    primary_entity_position: { x: number; y: number; z: number } | null;
    primaryEntity: {
      id: number;
      position: { x: number; y: number; z: number };
      movement: unknown | null;
    } | null;
    entityCount: number;
    loadedChunkCount: number;
    loadedChunks: { x: number; y: number; z: number }[];
  };
  localWorldView: {
    camera: { x: number; y: number; zoom: number };
    viewZ: number;
    viewMode: "entity" | "master";
    lookOffset: { x: number; y: number };
    fps: number;
    tps: number;
    visibleChunks: { x: number; y: number; z: number }[];
    projectedChunks: { x: number; y: number; z: number }[];
  };
  viewGlobals: {
    camera: [number, number, number, number];
    canvas: [number, number, number, number];
    sim: [number, number, number, number];
  };
  worldRender: {
    atlasQuadCount: number;
    solidQuadCount: number;
    floorQuadCount: number;
    playerQuadCount: number;
    droppedAtlasQuads: number;
    droppedSolidQuads: number;
    droppedDrawCmds: number;
    visibleTileCount: number;
    rememberedTileCount: number;
    fovDirty?: boolean;
    fovRecomputeCount?: number;
    snapshotCallsLastFrame?: number;
    droppedSimTimeMs?: number;
    worldDrawHash?: string;
  };
};

export type EngineCheckpoint = {
  name: string;
  ordinal: number;
  frame: number;
  drawHash: string;
  snapshot: EngineSnapshot;
  screenshot?: string;
};

export type EngineBundle = {
  manifest: {
    version: number;
    checkpointCount: number;
    screenshotCount: number;
  };
  checkpoints: Omit<EngineCheckpoint, "screenshot">[];
  screenshots: { name: string; dataUrl: string }[];
};

type BrowserGlobal = {
  __openDwarfEngineHarness?: {
    version: number;
    input: {
      keyDown(code: string, modifiers?: number): Promise<void>;
      keyUp(code: string, modifiers?: number): Promise<void>;
      press(code: string, modifiers?: number): Promise<void>;
      typeText(text: string): Promise<void>;
      paste(text: string): Promise<void>;
      blur(): Promise<void>;
      focus(): Promise<void>;
    };
    stepFrame(n?: number): Promise<void>;
    stepSimTick(n?: number): Promise<void>;
    snapshot(): EngineSnapshot;
    captureCheckpoint(
      name: string,
      options?: { screenshot?: boolean },
    ): Promise<EngineCheckpoint>;
    exportBundle(): EngineBundle;
    runScenario(scenario: unknown): Promise<{
      name: string;
      checkpoints: {
        name: string;
        drawHash: string;
        snapshot: EngineSnapshot;
      }[];
      finalSnapshot: EngineSnapshot;
    }>;
    importReplay(worldReplay: unknown): Promise<Record<string, unknown>>;
    resetWorld(kind?: "default" | "play"): Promise<void>;
  };
};

export const GOLDEN_ALLOWLIST_KEYS = [
  "shell.open",
  "shell.page",
  "session.uiMode",
  "session.chatDraft",
  "session.chatMessages",
  "input.textCaptureActive",
] as const;

export async function waitForEngineHarness(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => {
      const harness =
        (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness;
      return !!harness && harness.version >= 3;
    },
    { timeout },
  );
}

function harness(page: Page) {
  return page.evaluate(() => {
    const value =
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness;
    if (!value) {
      throw new Error("engine harness missing");
    }
    return true;
  });
}

export function engineSnapshot(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!
      .snapshot()
  );
}

export function enginePress(page: Page, code: string, modifiers?: number) {
  return page.evaluate(
    ([code, modifiers]) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
        .press(code, modifiers),
    [code, modifiers] as [string, number | undefined],
  );
}

export function engineKeyDown(page: Page, code: string, modifiers?: number) {
  return page.evaluate(
    ([code, modifiers]) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
        .keyDown(code, modifiers),
    [code, modifiers] as [string, number | undefined],
  );
}

export function engineKeyUp(page: Page, code: string, modifiers?: number) {
  return page.evaluate(
    ([code, modifiers]) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
        .keyUp(code, modifiers),
    [code, modifiers] as [string, number | undefined],
  );
}

export function engineTypeText(page: Page, text: string) {
  return page.evaluate(
    (text) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
        .typeText(text),
    text,
  );
}

export function enginePaste(page: Page, text: string) {
  return page.evaluate(
    (text) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
        .paste(text),
    text,
  );
}

export function engineBlur(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
      .blur()
  );
}

export function engineFocus(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!.input
      .focus()
  );
}

export function stepEngineFrame(page: Page, n = 1) {
  return page.evaluate(
    (n) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!
        .stepFrame(n),
    n,
  );
}

export function captureEngineCheckpoint(
  page: Page,
  name: string,
  options?: { screenshot?: boolean },
) {
  return page.evaluate(
    ([name, options]) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!
        .captureCheckpoint(name, options ?? undefined),
    [name, options] as [string, { screenshot?: boolean } | undefined],
  );
}

export function exportEngineBundle(page: Page) {
  return page.evaluate(() =>
    (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!
      .exportBundle()
  );
}

export function engineRunScenario(page: Page, scenario: unknown) {
  return page.evaluate(
    (scenario) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!
        .runScenario(scenario),
    scenario,
  );
}

export function engineImportReplay(page: Page, worldReplay: unknown) {
  return page.evaluate(
    async (worldReplay) => {
      const harness = (globalThis as unknown as BrowserGlobal)
        .__openDwarfEngineHarness!;
      try {
        const snapshot = await harness.importReplay(worldReplay);
        return { ok: true as const, snapshot };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    worldReplay,
  );
}

export function engineStepSimTick(page: Page, n = 1) {
  return page.evaluate(
    async (n) => {
      const harness = (globalThis as unknown as BrowserGlobal)
        .__openDwarfEngineHarness!;
      try {
        await harness.stepSimTick(n);
        return { ok: true as const };
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    n,
  );
}

export function engineResetWorld(
  page: Page,
  kind: "default" | "play" = "default",
) {
  return page.evaluate(
    (kind) =>
      (globalThis as unknown as BrowserGlobal).__openDwarfEngineHarness!
        .resetWorld(kind),
    kind,
  );
}

export function allowlistFromSnapshot(snapshot: EngineSnapshot) {
  return {
    drawHash: snapshot.frame.drawHash,
    shell: {
      open: snapshot.shell.open,
      page: snapshot.shell.page,
    },
    session: {
      uiMode: snapshot.session.uiMode,
      chatDraft: snapshot.session.chatDraft,
      chatMessages: snapshot.session.chatMessages,
    },
    input: {
      textCaptureActive: snapshot.input.textCaptureActive,
    },
  };
}

/** Stable MVP world/view/render fields (excludes fps/tps HUD and drawHash). */
export function mvpAllowlistFromSnapshot(snapshot: EngineSnapshot) {
  const hudModeLine = snapshot.session.hud?.[0] ?? "";
  return {
    world: {
      tick: snapshot.world.tick,
      world_state_hash: snapshot.world.world_state_hash,
      loadedChunkCount: snapshot.world.loadedChunkCount,
      worldChunks: snapshot.world.worldChunks,
      primaryEntity: snapshot.world.primaryEntity
        ? {
          id: snapshot.world.primaryEntity.id,
          position: snapshot.world.primaryEntity.position,
          moving: snapshot.world.primaryEntity.movement != null,
          movementTarget: snapshot.world.primaryEntity.movement
            ? (snapshot.world.primaryEntity.movement as {
              target?: { x: number; y: number; z: number };
            }).target ?? null
            : null,
        }
        : null,
    },
    localWorldView: {
      viewMode: snapshot.localWorldView.viewMode,
      viewZ: snapshot.localWorldView.viewZ,
      zoom: snapshot.localWorldView.camera.zoom,
      visibleChunkCount: snapshot.localWorldView.visibleChunks.length,
      projectedChunkCount: snapshot.localWorldView.projectedChunks.length,
    },
    worldRender: {
      floorQuadCount: snapshot.worldRender.floorQuadCount,
      playerQuadCount: snapshot.worldRender.playerQuadCount,
      atlasQuadCount: snapshot.worldRender.atlasQuadCount,
      solidQuadCount: snapshot.worldRender.solidQuadCount,
      droppedAtlasQuads: snapshot.worldRender.droppedAtlasQuads,
      droppedDrawCmds: snapshot.worldRender.droppedDrawCmds,
      visibleTileCount: snapshot.worldRender.visibleTileCount,
      rememberedTileCount: snapshot.worldRender.rememberedTileCount,
      fovDirty: snapshot.worldRender.fovDirty ?? false,
      fovRecomputeCount: snapshot.worldRender.fovRecomputeCount ?? 0,
    },
    viewGlobals: {
      zoom: snapshot.viewGlobals.camera[2],
      dpr: snapshot.viewGlobals.canvas[2],
      viewZ: snapshot.viewGlobals.sim[1],
      simTick: snapshot.viewGlobals.sim[0],
    },
    session: {
      uiMode: snapshot.session.uiMode,
      hudModeLine,
    },
  };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function writeEngineGoldenArtifacts(
  bundle: EngineBundle,
  options?: { runId?: string; copyCloud?: boolean },
) {
  const runId = options?.runId ??
    new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.join("exports", "engine-golden", runId);
  const shotDir = path.join(root, "screenshots");
  await mkdir(shotDir, { recursive: true });
  await writeFile(
    path.join(root, "manifest.json"),
    `${JSON.stringify(bundle.manifest, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "checkpoints.json"),
    `${JSON.stringify(bundle.checkpoints, null, 2)}\n`,
  );

  const ordered = bundle.screenshots;
  for (let index = 0; index < ordered.length; index++) {
    const shot = ordered[index]!;
    const filename = `${String(index + 1).padStart(2, "0")}-${shot.name}.png`;
    const bytes = dataUrlToBytes(shot.dataUrl);
    await writeFile(path.join(shotDir, filename), bytes);
  }

  if (options?.copyCloud) {
    try {
      const cloudDir = "/opt/cursor/artifacts/engine-golden";
      await mkdir(cloudDir, { recursive: true });
      for (let index = 0; index < ordered.length; index++) {
        const shot = ordered[index]!;
        const filename = `${
          String(index + 1).padStart(2, "0")
        }-${shot.name}.png`;
        await writeFile(
          path.join(cloudDir, filename),
          dataUrlToBytes(shot.dataUrl),
        );
      }
      await writeFile(
        path.join(cloudDir, "manifest.json"),
        `${JSON.stringify(bundle.manifest, null, 2)}\n`,
      );
    } catch (error) {
      console.warn(
        `Skipping Cursor artifact mirror: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return root;
}

/** Silence unused helper warning when only side imports are used. */
export async function ensureHarnessReady(page: Page) {
  await harness(page);
}
