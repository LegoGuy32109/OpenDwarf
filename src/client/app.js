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
import { roomSpawnTile } from "../shared/spawn-room.js";
import { createRenderer } from "./render.js";
import { createContext } from "./context.js";
import { createInput } from "./input.js";
import { startLoop } from "./loop.js";
import { exposeHarness } from "./harness.js";
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

export async function startApp() {
  const ctx = createContext();
  const { scene, canvas } = ctx;
  bindSafeArea(ctx);
  if (!ctx.isAdmin) {
    scene.world = scene.layout === "room"
      ? (await import("../shared/spawn-room.js")).createSpawnRoomWorld()
      : (await import("../shared/authored-terrain.js")).createAuthoredWorld(
        new URL(location.href).searchParams.get("world") === "32" ? 32 : 16,
      );
  }
  enableLocomotion(
    addPlayer(
      scene.world,
      "self",
      scene.layout === "room" && !ctx.isAdmin ? roomSpawnTile(0) : undefined,
    ),
  );
  const input = createInput(ctx);
  input.bind();
  const renderer = ctx.isSynthetic ? null : await createRenderer(canvas);
  const finishLoading = () => {
    scene.loading = null;
    canvas.dataset.ready = "true";
  };
  if (renderer) {
    renderer.ready.then(finishLoading).catch((error) => {
      scene.loading = "Cannot load the game. Reload to try again.";
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
  startLoop(ctx, renderer, input);
  exposeHarness(ctx);
  // After the first frame is on its way: the worker never delays the game.
  void registerWorker(build);
}
