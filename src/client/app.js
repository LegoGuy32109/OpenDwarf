// @ts-check

/**
 * Startup and wiring. `startApp` builds the shared `ctx` (see `context.js`), sets
 * up the world for a host or a guest, binds the input, starts hosting or joining,
 * and starts the frame loop. The game itself lives in the modules it calls:
 * `input.js`, `interact.js`, `chat-input.js`, `panels.js`, `ui-view.js`,
 * `display.js`, `session.js`, `loop.js`, and `harness.js`.
 */

import { addPlayer } from "../shared/world.js";
import { enableLocomotion } from "../shared/locomotion.js";
import { authoredRecipe, roomRecipe } from "../shared/world-recipes.js";
import { createSimulation } from "../shared/simulation.js";
import { worldSeedFromParams } from "../shared/generation.js";
import { completeStartup, failStartup, reportStartup } from "./startup.js";
import { createRenderer } from "./render.js";
import { createContext } from "./context.js";
import { createInput } from "./input.js";
import { startLoop } from "./loop.js";
import { bindTestDriver } from "./test-driver.js";
import { createHarnessApi, exposeHarness } from "./harness.js";
import { registerWorker } from "./offline.js";
import { build } from "./build.js";
import { bindSafeArea } from "./ui-view.js";
import {
  joinSession,
  startAdminList,
  startDiagnostics,
  startHosting,
  startTelemetry,
} from "./session.js";

/** @param {{worldDefinition?:import("../shared/world-builder.js").WorldDefinition}} [startup] */
export async function startApp(startup = {}) {
  reportStartup("world");
  const ctx = createContext();
  const { scene, canvas } = ctx;
  const mediaRandom =
    /** @type {{__musicRandom?:number}} */ (globalThis).__musicRandom;
  if (
    new URL(location.href).searchParams.has("harness") &&
    typeof mediaRandom === "number"
  ) ctx.music.setRandom(() => mediaRandom);
  bindSafeArea(ctx);
  if (!ctx.isAdmin) {
    const params = new URL(location.href).searchParams;
    const setup = startup.worldDefinition ??
      (params.has("harness")
        ? /** @type {{__worldDefinition?:import('../shared/world-builder.js').WorldDefinition}} */ (globalThis)
          .__worldDefinition
        : undefined);
    const seed = worldSeedFromParams(params);
    ctx.simulation = createSimulation(
      setup ??
        (scene.layout === "room"
          ? roomRecipe(seed, { npc: !params.has("harness") })
          : authoredRecipe(params.get("world") === "32" ? 32 : 16, {
            npc: false,
            generator: true,
            seed,
          })),
    );
    scene.world = ctx.simulation.world;
    ctx.stamina = ctx.simulation.state("self").stamina;
    ctx.simulation.join("self");
  } else enableLocomotion(addPlayer(scene.world, "self"));
  const input = createInput(ctx);
  input.bind();
  reportStartup("graphics", "Setting up WebGL...");
  const renderer = ctx.isSynthetic ? null : await createRenderer(canvas, {
    onAsset: (loaded, total) =>
      reportStartup("graphics", `Textures ready: ${loaded}/${total}`),
  });
  const finishLoading = () => {
    scene.loading = null;
    reportStartup("frame");
  };
  if (renderer) {
    renderer.ready.then(finishLoading).catch((error) => {
      scene.loading = "Cannot load the game. Reload to try again.";
      failStartup(error);
      scene.telemetry?.("error", { status: "assets-failed" });
      console.error(error);
    });
  } else finishLoading();
  if (ctx.isAdmin && !ctx.joinRoute) startAdminList(ctx);
  else if (!ctx.isAdmin) startHosting(ctx, renderer);
  if (ctx.joinRoute) joinSession(ctx, ctx.joinRoute);
  if (!ctx.isAdmin) startDiagnostics(ctx);
  startTelemetry(ctx);
  ctx.music.start();
  ctx.sfx.start();
  startLoop(ctx, renderer, input, () => {
    canvas.dataset.ready = "true";
    completeStartup();
  });
  exposeHarness(ctx, renderer);
  if (new URL(location.href).searchParams.has("harness")) {
    bindTestDriver(createHarnessApi(ctx, renderer), {
      world: () => scene.world,
      isGuest: ctx.isAdmin,
      invalidate: () => {
        scene.visibility.sample = "";
      },
      publish: () => {
        ctx.host?.publish();
      },
    });
  }
  // After the first frame is on its way: the worker never delays the game.
  void registerWorker(build);
}
