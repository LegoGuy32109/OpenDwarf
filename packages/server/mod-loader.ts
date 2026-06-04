/**
 * @opendwarf/server/mod-loader — discover and dynamically import mods
 * from a directory. Each subdirectory containing a `mod.ts` (or `mod.js`)
 * is treated as one mod; the default export must be a `Mod` from
 * `createMod()`.
 *
 * Example layout:
 *   mods/
 *     welcome/mod.ts        ← discovered
 *     trader/mod.ts         ← discovered
 *     trader/internal.ts    ← ignored (not named mod.ts)
 */

import type { Mod } from "@opendwarf/sdk";
import type { ModRuntime } from "./mod-runtime.ts";
import { loadWasmMod } from "./wasm-host.ts";

export interface LoaderOptions {
  /** Directory containing mod folders. Resolved relative to cwd. */
  dir: string;
  /** File names to look for inside each subdirectory. */
  entrypoints?: string[];
}

export interface LoadResult {
  loaded: Array<{ name: string; path: string }>;
  skipped: Array<{ path: string; reason: string }>;
}

export async function loadMods(opts: LoaderOptions): Promise<Mod[]> {
  const dir = opts.dir;
  const entrypoints = opts.entrypoints ?? ["mod.ts", "mod.js"];
  const mods: Mod[] = [];

  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(dir);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }

  for await (const entry of entries) {
    // .wasm files are Rust-authored mods, loaded via the wasm host.
    if (entry.isFile && entry.name.endsWith(".wasm")) {
      mods.push(await loadWasmMod(`${dir}/${entry.name}`));
      continue;
    }

    if (!entry.isDirectory) continue;

    // A subdirectory containing a `mod.wasm` is also a wasm mod.
    const wasmPath = `${dir}/${entry.name}/mod.wasm`;
    try {
      await Deno.stat(wasmPath);
      mods.push(await loadWasmMod(wasmPath));
      continue;
    } catch { /* fall through to TS lookup */ }

    for (const file of entrypoints) {
      const path = `${dir}/${entry.name}/${file}`;
      try {
        await Deno.stat(path);
      } catch {
        continue;
      }
      const url = new URL(path, `file://${Deno.cwd()}/`);
      const mod = await import(url.href);
      const exported = mod.default;
      if (isMod(exported)) {
        mods.push(exported);
      } else {
        throw new Error(
          `${path}: default export is not a Mod (use createMod() from @opendwarf/sdk)`,
        );
      }
      break;
    }
  }

  return mods;
}

export async function loadAndRegister(
  runtime: ModRuntime,
  opts: LoaderOptions,
): Promise<LoadResult> {
  const mods = await loadMods(opts);
  const loaded: LoadResult["loaded"] = [];
  const skipped: LoadResult["skipped"] = [];
  for (const mod of mods) {
    const result = runtime.register(mod);
    if (result.ok) {
      loaded.push({ name: mod.manifest.name, path: opts.dir });
    } else {
      skipped.push({
        path: mod.manifest.name,
        reason: result.reason ?? "unknown",
      });
    }
  }
  return { loaded, skipped };
}

function isMod(v: unknown): v is Mod {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __brand?: string }).__brand === "OpenDwarfMod" &&
    "manifest" in v &&
    "definition" in v
  );
}
