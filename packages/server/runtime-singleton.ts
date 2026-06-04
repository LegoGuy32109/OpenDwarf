/**
 * Lazy, process-wide ModRuntime for the Fresh app.
 *
 * Fresh is request-driven, so we initialize the runtime on first access
 * and reuse it for the lifetime of the process. Mods are loaded from
 * `MODS_DIR` (default: `./examples/mods`) so the example mod ships
 * "loaded" out of the box.
 */

import { createModRuntime, type ModRuntime } from "./mod-runtime.ts";
import { loadAndRegister, type LoadResult } from "./mod-loader.ts";

let _runtime: ModRuntime | null = null;
let _initPromise: Promise<{ runtime: ModRuntime; load: LoadResult }> | null =
  null;
let _loadResult: LoadResult = { loaded: [], skipped: [] };

export function getRuntime(): Promise<ModRuntime> {
  return ensureInit().then((r) => r.runtime);
}

export function getLoadResult(): LoadResult {
  return _loadResult;
}

function ensureInit() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const runtime = createModRuntime();
    const dir = Deno.env.get("OPENDWARF_MODS_DIR") ?? "./examples/mods";
    const load = await loadAndRegister(runtime, { dir }).catch(
      (e): LoadResult => ({
        loaded: [],
        skipped: [{ path: dir, reason: String(e) }],
      }),
    );
    await runtime.start();
    _runtime = runtime;
    _loadResult = load;
    return { runtime, load };
  })();
  return _initPromise;
}

export function _resetForTests() {
  _runtime = null;
  _initPromise = null;
  _loadResult = { loaded: [], skipped: [] };
}
