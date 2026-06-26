/// <reference lib="dom" />

import { TILE_SIZE_PX } from "../../lib/webgl-chunk-gen.ts";
import type { FrameContext } from "../frame-context.ts";
import { flushInstanceBatch } from "../instance-batch.ts";
import type { Pass } from "../gpu-types.ts";
import { UI_RECT_STRIDE_FLOATS, writeUiRectInstance } from "../ui-rect.ts";
import { drawUiTextLines, uiTextLineHeight, uiTextWidth } from "../ui-text.ts";

const CHAT_BUBBLE_VISIBLE_TICKS = Math.round(5.0 * 60);
const CHAT_BUBBLE_FADE_IN_TICKS = Math.round(0.2 * 60);
const CHAT_BUBBLE_FADE_OUT_TICKS = Math.round(0.4 * 60);

const CHAT_BAR_TINT: [number, number, number] = [0.1725, 0.1725, 0.1725];
const BUBBLE_TINT: [number, number, number] = [0.1, 0.1, 0.1];
const BUBBLE_TEXT_TINT: [number, number, number] = [1, 1, 1];
const CHAT_TEXT_TINT: [number, number, number] = [0.98, 0.95, 0.88];

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

export const ChatPass: Pass<FrameContext> = {
  name: "chat",
  program: "uiText",
  state: { blend: "alpha" },
  draw(ctx) {
    const fontAtlas = ctx.ui.fontAtlas;
    if (!fontAtlas) {
      return;
    }

    const canvasWidth = ctx.frame.viewport.fbWidth;
    const canvasHeight = ctx.frame.viewport.fbHeight;
    const chatScale = 1.2;
    const vgaLineH = uiTextLineHeight(fontAtlas, chatScale);
    const vgaW = (text: string) => uiTextWidth(fontAtlas, text, chatScale);
    const vgaPad = 0;
    if (ctx.ui.uiMode === "chat") {
      const barText = `${ctx.ui.chatBuffer}_`;
      const barW = Math.min(vgaW(barText) + vgaPad * 2, canvasWidth - 40);
      const barH = vgaLineH + vgaPad * 2;
      const barX = 20;
      const barY = canvasHeight - barH - 18;
      drawRect(ctx, barX, barY, barW, barH, CHAT_BAR_TINT, 0.65);
      drawText(
        ctx,
        barText,
        barX + vgaPad,
        barY + vgaPad,
        CHAT_TEXT_TINT,
        1,
        chatScale,
      );
    }

    const liveBubbles = ctx.ui.chatBubbles
      .map((bubble) => ({ ...bubble, age: ctx.frame.simTick - bubble.tick }))
      .filter((bubble) =>
        bubble.age <= CHAT_BUBBLE_FADE_IN_TICKS + CHAT_BUBBLE_VISIBLE_TICKS +
            CHAT_BUBBLE_FADE_OUT_TICKS
      )
      .sort((a, b) => b.tick - a.tick);

    let bubbleOffsetY = 30;
    for (const bubble of liveBubbles) {
      const fadeOutStart = CHAT_BUBBLE_FADE_IN_TICKS +
        CHAT_BUBBLE_VISIBLE_TICKS;
      const alpha = bubble.age < CHAT_BUBBLE_FADE_IN_TICKS
        ? bubble.age / CHAT_BUBBLE_FADE_IN_TICKS
        : bubble.age > fadeOutStart
        ? 1 - (bubble.age - fadeOutStart) / CHAT_BUBBLE_FADE_OUT_TICKS
        : 1;
      const msgW = Math.min(vgaW(bubble.message), canvasWidth - 32);
      const bubbleW = msgW + vgaPad * 2;
      const bubbleH = vgaLineH + vgaPad;
      const [targetX, targetY] = [
        (bubble.target.x + 0.5) * TILE_SIZE_PX - ctx.frame.camera.x +
        canvasWidth * 0.5,
        (bubble.target.y + 0.5) * TILE_SIZE_PX - ctx.frame.camera.y +
        canvasHeight * 0.5,
      ];
      const bubbleX = Math.max(
        8,
        Math.min(targetX - bubbleW * 0.5, canvasWidth - bubbleW - 8),
      );
      const bubbleY = Math.max(8, targetY - bubbleOffsetY - bubbleH);
      drawRect(
        ctx,
        bubbleX,
        bubbleY,
        bubbleW,
        bubbleH,
        BUBBLE_TINT,
        0.55 * alpha,
      );
      drawText(
        ctx,
        bubble.message,
        bubbleX + vgaPad,
        bubbleY + vgaPad,
        BUBBLE_TEXT_TINT,
        alpha,
        chatScale,
      );
      bubbleOffsetY += bubbleH;
    }
  },
};
