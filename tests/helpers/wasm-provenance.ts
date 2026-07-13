import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Page, Response } from "@playwright/test";

export type EngineWasmBuildMetadata = {
  schemaVersion: number;
  profile: "debug" | "release";
  wasm: { file: string; sha256: string };
  transforms: Record<string, unknown>;
  tools: Record<string, string | null>;
};

const GENERATED_METADATA = "engine/generated/od_wasm.build.json";
const WASM_URL_SUFFIX = "/engine/generated/od_wasm_bg.wasm";

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readEngineWasmBuildMetadata() {
  return JSON.parse(
    await readFile(GENERATED_METADATA, "utf8"),
  ) as EngineWasmBuildMetadata;
}

/** Captures the module response actually consumed while loading `/engine`. */
export function captureEngineWasmResponse(page: Page) {
  let response: Response | undefined;
  const listener = (candidate: Response) => {
    if (candidate.url().includes(WASM_URL_SUFFIX)) response = candidate;
  };
  page.on("response", listener);
  return async () => {
    page.off("response", listener);
    if (!response) {
      throw new Error(
        `did not observe engine wasm response (${WASM_URL_SUFFIX})`,
      );
    }
    return { url: response.url(), sha256: sha256(await response.body()) };
  };
}

export async function expectServedEngineWasm(page: Page) {
  const metadata = await readEngineWasmBuildMetadata();
  const finish = captureEngineWasmResponse(page);
  await page.goto("/engine?harness=1");
  await page.waitForFunction(
    () =>
      !!(globalThis as typeof globalThis & {
        __openDwarfEngineHarness?: unknown;
      }).__openDwarfEngineHarness,
  );
  const served = await finish();
  if (served.sha256 !== metadata.wasm.sha256) {
    throw new Error(
      `served wasm hash ${served.sha256} does not match ${metadata.wasm.sha256}`,
    );
  }
  return { metadata, served };
}
