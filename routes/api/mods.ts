import { getLoadResult, getRuntime } from "../../packages/server/runtime-singleton.ts";

export const handler = {
  async GET(_req: Request) {
    const runtime = await getRuntime();
    const mods = runtime.loadedMods();
    const load = getLoadResult();
    return Response.json({
      mods,
      load,
      tick: runtime.state().tick,
    });
  },
};
