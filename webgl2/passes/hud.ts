/// <reference lib="dom" />

import { TILE_SIZE_PX } from "../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import type { Pass } from "../gpu-types.ts";
import { UI_RECT_STRIDE_FLOATS, writeUiRectInstance } from "../ui-rect.ts";
import { drawUiTextLines, uiTextLineHeight, uiTextWidth } from "../ui-text.ts";

const HUD_BG_TINT: [number, number, number] = [0.06, 0.08, 0.12];
const HUD_TEXT_TINT: [number, number, number] = [1.0, 0.86, 0.56];

function drawRect(
  ctx: FrameContext,
  x: number,
  y: number,
  w: number,
  h: number,
  tint: [number, number, number],
  alpha: number,
) {
  const canvasSize = {
    width: ctx.frame.viewport.fbWidth,
    height: ctx.frame.viewport.fbHeight,
  };
  const program = ctx.programs.uiRect;
  ctx.gl.bindVertexArray(program.vao);
  ctx.gl.useProgram(program.handle);
  program.setGlobals({ x: 0, y: 0, zoom: 1 }, 1, canvasSize, ctx.frame.simTick);
  writeUiRectInstance(ctx.scratch, 0, x, y, w, h, tint, alpha);
  flushInstanceBatch(
    ctx.gl,
    ctx.instanceBuffer,
    ctx.scratch,
    1,
    UI_RECT_STRIDE_FLOATS,
    ctx.batchStats,
  );
}

function drawText(
  ctx: FrameContext,
  text: string,
  x: number,
  y: number,
  tint: [number, number, number],
  alpha: number,
  scale: number,
) {
  if (!ctx.ui.fontAtlas) {
    return;
  }
  drawUiTextLines(
    {
      gl: ctx.gl,
      program: ctx.programs.uiText,
      fontAtlas: ctx.ui.fontAtlas,
      scratch: ctx.scratch,
      maxInstances: ctx.maxInstances,
      flushPass: (count) =>
        flushInstanceBatch(
          ctx.gl,
          ctx.instanceBuffer,
          ctx.scratch,
          count,
          12,
          ctx.batchStats,
        ),
      canvasSize: {
        width: ctx.frame.viewport.fbWidth,
        height: ctx.frame.viewport.fbHeight,
      },
      simTick: ctx.frame.simTick,
    },
    text,
    x,
    y,
    tint,
    alpha,
    scale,
  );
}

export const HudPass: Pass<FrameContext> = {
  name: "hud",
  program: "uiText",
  state: { blend: "alpha" },
  draw(ctx) {
    const fontAtlas = ctx.ui.fontAtlas;
    if (!fontAtlas || !ctx.ui.uiOverlayVisible) {
      return;
    }

    const canvasWidth = ctx.frame.viewport.fbWidth;
    const scale = 1;
    const lineHeight = uiTextLineHeight(fontAtlas, scale);
    const fps = ctx.ui.fpsHistory.length > 0
      ? Math.round(
        ctx.ui.fpsHistory.reduce((sum, value) => sum + value, 0) /
          ctx.ui.fpsHistory.length,
      )
      : 0;
    const world = ctx.frame.world;
    const statusLines = [
      `fps: ${fps}  sim: ${ctx.ui.simTpsDisplay}tps`,
      `mode: ${ctx.policy.viewMode}  z: ${ctx.frame.viewZ}  zoom: ${
        ctx.frame.camera.zoom.toFixed(2)
      }`,
      `cam x: ${(ctx.frame.camera.x / TILE_SIZE_PX).toFixed(1)} y: ${
        (ctx.frame.camera.y / TILE_SIZE_PX).toFixed(1)
      }  frame: ${ctx.frame.frameNumber}`,
      `visible: ${world.visible.size}  memory: ${world.memory.size}`,
    ];

    const padX = 14;
    const padY = 12;
    const panelW = Math.min(
      Math.max(
        ...statusLines.map((line) => uiTextWidth(fontAtlas, line, scale)),
      ) + padX * 2,
      canvasWidth - 28,
    );
    const panelH = statusLines.length * lineHeight + padY * 2;
    drawRect(ctx, 14, 14, panelW, panelH, HUD_BG_TINT, 0.58);

    for (let i = 0; i < statusLines.length; i++) {
      drawText(
        ctx,
        statusLines[i],
        14 + padX,
        14 + padY + i * lineHeight,
        HUD_TEXT_TINT,
        0.95,
        scale,
      );
    }
  },
};
