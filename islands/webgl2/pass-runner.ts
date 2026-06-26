/// <reference lib="dom" />

import type { FrameContext } from "./frame-context.ts";
import type { BlendMode, Pass } from "./gpu-types.ts";

function applyBlend(gl: WebGL2RenderingContext, blend: BlendMode) {
  if (blend === "alpha") {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return;
  }
  gl.disable(gl.BLEND);
}

export function runPasses(ctx: FrameContext, passes: Pass<FrameContext>[]) {
  for (const pass of passes) {
    if (!pass.enabled || pass.enabled(ctx)) {
      pass.prepare?.(ctx);
    }
  }

  let currentBlend: BlendMode | null = null;
  for (const pass of passes) {
    if (pass.enabled && !pass.enabled(ctx)) {
      continue;
    }
    const desired = pass.state?.blend ?? "off";
    if (desired !== currentBlend) {
      applyBlend(ctx.gl, desired);
      currentBlend = desired;
    }
    const program = ctx.programs[pass.program];
    ctx.gl.bindVertexArray(program.vao);
    ctx.gl.useProgram(program.handle);
    program.setGlobals(
      ctx.frame.camera,
      ctx.frame.camera.zoom,
      {
        width: ctx.frame.viewport.fbWidth,
        height: ctx.frame.viewport.fbHeight,
      },
      ctx.frame.simTick,
    );
    pass.draw(ctx);
  }
}
