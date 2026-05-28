/// <reference lib="dom" />

import { CHUNK_EDGE_TILES, TILE_SIZE_PX } from "../../lib/webgl-chunk-gen.ts";
import {
  drawVgaTextLines,
  type VgaFontAtlas,
  vgaTextLineHeight,
  vgaTextWidth,
} from "../webgl-ui-text-vga.ts";

const CHAT_BUBBLE_VISIBLE_TICKS = Math.round(5.0 * 60);
const CHAT_BUBBLE_FADE_IN_TICKS = Math.round(0.2 * 60);
const CHAT_BUBBLE_FADE_OUT_TICKS = Math.round(0.4 * 60);

type Rgb = [number, number, number];

type SceneStateForUi = {
  camera: { x: number; y: number; zoom: number };
  player: { tileX: number; tileY: number; tileZ: number };
  uiMode: "world" | "chat";
  chatBuffer: string;
};

type LayerStateForUi = {
  floor: boolean;
  edgeShadow: boolean;
  ceilShadow: boolean;
  depthTint: boolean;
};

type ChatBubbleRecordForUi = {
  message: string;
  target: { tileX: number; tileY: number; tileZ: number };
  tick: number;
};

type RenderVgaUiArgs = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  vgaAtlas: VgaFontAtlas;
  whiteTexture: WebGLTexture | null;
  scratch: Float32Array;
  maxInstances: number;
  flushPass: (count: number) => void;
  tintLoc: WebGLUniformLocation | null;
  alphaMultiplierLoc: WebGLUniformLocation | null;
  renderModeLoc: WebGLUniformLocation | null;
  setRenderMode: (mode: number) => void;
  setTint: (r: number, g: number, b: number) => void;
  setAlpha: (alpha: number) => void;
  sceneState: SceneStateForUi;
  uiOverlayVisible: boolean;
  capability: { framebufferSize: { width: number; height: number } } | null;
  replayPreview: {
    eventCount: number;
    textureCount: number;
    screenshotCount: number;
    checkpointCount: number;
  };
  fpsHistory: number[];
  simTpsDisplay: number;
  solidChunkCount: number;
  visibleTileCount: number;
  layers: LayerStateForUi;
  viewMode: "entity" | "master";
  viewZ: number;
  frameDrawCalls: number;
  frameInstances: number;
  logs: string[];
  checkpoints: Array<{
    ordinal: number;
    name: string;
    baselineConfigured: boolean;
  }>;
  chatBubbles: ChatBubbleRecordForUi[];
  simTick: number;
  setChatBubbles: (bubbles: ChatBubbleRecordForUi[]) => void;
};

export function renderVgaUi(args: RenderVgaUiArgs) {
  const {
    gl,
    canvas,
    vgaAtlas,
    whiteTexture,
    scratch,
    maxInstances,
    flushPass,
    tintLoc,
    alphaMultiplierLoc,
    renderModeLoc,
    setRenderMode,
    setTint,
    setAlpha,
    sceneState,
    uiOverlayVisible,
    capability,
    replayPreview,
    fpsHistory,
    simTpsDisplay,
    solidChunkCount,
    visibleTileCount,
    layers,
    viewMode,
    viewZ,
    frameDrawCalls,
    frameInstances,
    logs,
    checkpoints,
    chatBubbles,
    simTick,
    setChatBubbles,
  } = args;

  const drawVga = (
    text: string,
    x: number,
    y: number,
    rgb: Rgb,
    alpha = 1,
    scale?: number,
  ) => {
    drawVgaTextLines(
      {
        gl,
        fontAtlas: vgaAtlas,
        scratch,
        maxInstances,
        flushPass,
        tintLoc,
        alphaMultiplierLoc,
        renderModeLoc,
      },
      text,
      x,
      y,
      rgb,
      alpha,
      scale,
    );
  };

  const chatScale = 2;
  const vgaLineH = vgaTextLineHeight(vgaAtlas, chatScale);
  const vgaW = (text: string) => vgaTextWidth(vgaAtlas, text, chatScale);
  const vgaPad = 6;

  if (uiOverlayVisible) {
    const avgFps = fpsHistory.length > 0
      ? Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length)
      : 0;
    const loadedTiles = solidChunkCount * CHUNK_EDGE_TILES * CHUNK_EDGE_TILES;
    const cam = sceneState.camera;
    const overlayScale = 1;
    const overlayLineH = vgaTextLineHeight(vgaAtlas, overlayScale);
    const drawVgaLines = (
      lines: string[],
      x: number,
      y: number,
      rgb: Rgb,
      alpha = 1,
    ) => {
      for (let i = 0; i < lines.length; i++) {
        drawVga(lines[i], x, y + i * overlayLineH, rgb, alpha, overlayScale);
      }
    };
    const statusLines = [
      `[1] ui:on [6] floor:${layers.floor ? "on" : "OFF"} [7] edge:${
        layers.edgeShadow ? "on" : "OFF"
      } [8] ceil:${layers.ceilShadow ? "on" : "OFF"} [9] tint:${
        layers.depthTint ? "on" : "OFF"
      }`,
      `framebuffer: ${capability?.framebufferSize.width ?? 0} x ${
        capability?.framebufferSize.height ?? 0
      }`,
      `replay:${replayPreview.eventCount} tex:${replayPreview.textureCount} shots:${replayPreview.screenshotCount} checks:${replayPreview.checkpointCount}`,
      `fps: ${avgFps}  sim: ${simTpsDisplay}tps`,
      `tiles: ${loadedTiles} loaded  ${visibleTileCount} visible`,
      `draws: ${frameDrawCalls}  instances: ${frameInstances}`,
      `cam x:${(cam.x / TILE_SIZE_PX).toFixed(1)} y:${
        (cam.y / TILE_SIZE_PX).toFixed(1)
      } z:${viewZ} zoom:${cam.zoom.toFixed(2)} mode:${viewMode}`,
    ];
    drawVgaLines(statusLines, 32, 28, [1.0, 0.86, 0.56], 0.95);

    const logLines = logs.length === 0
      ? ["waiting for resize or fullscreen..."]
      : ["EVENT LOG", ...logs.slice(0, 7)];
    const logW = Math.min(560, canvas.width - 32);
    drawVgaLines(
      logLines,
      canvas.width - logW,
      canvas.height - 202,
      [0.82, 0.9, 1.0],
      0.88,
    );

    const recentCheckpoints = checkpoints.slice(-6).reverse();
    const checkpointLines = recentCheckpoints.length === 0
      ? ["CHECKPOINTS", "no checkpoints captured yet"]
      : [
        "CHECKPOINTS",
        ...recentCheckpoints.map((entry) =>
          `${String(entry.ordinal).padStart(3, "0")} ${entry.name} ${
            entry.baselineConfigured ? "base" : "new"
          }`
        ),
      ];
    drawVgaLines(
      checkpointLines,
      32,
      canvas.height - 162,
      [0.7, 1.0, 0.82],
      0.88,
    );
  }

  const bubbleText = sceneState.uiMode === "chat"
    ? `${sceneState.chatBuffer}_`
    : "";
  if (bubbleText.length > 0 && whiteTexture) {
    const panelW = Math.min(vgaW(bubbleText) + vgaPad * 2, canvas.width - 40);
    const panelH = vgaLineH + vgaPad * 2;
    const panelY = canvas.height - panelH - 18;
    const panelX = 20;
    setRenderMode(5);
    setTint(0.1725, 0.1725, 0.1725);
    setAlpha(0.65);
    scratch[0] = panelX;
    scratch[1] = panelY;
    scratch[2] = panelW;
    scratch[3] = panelH;
    scratch[4] = 1;
    scratch[5] = 0;
    scratch[6] = 1;
    scratch[7] = 1;
    flushPass(1);
    drawVga(
      bubbleText,
      panelX + vgaPad,
      panelY + vgaPad,
      [0.98, 0.95, 0.88],
      1,
      chatScale,
    );
  }

  const playerScreenX = (sceneState.player.tileX + 0.5) * TILE_SIZE_PX -
    sceneState.camera.x + canvas.width * 0.5;
  const playerScreenY = (sceneState.player.tileY + 0.5) * TILE_SIZE_PX -
    sceneState.camera.y + canvas.height * 0.5;
  const liveBubbles = chatBubbles
    .map((bubble) => ({ ...bubble, age: simTick - bubble.tick }))
    .filter((bubble) =>
      bubble.age <= CHAT_BUBBLE_FADE_IN_TICKS + CHAT_BUBBLE_VISIBLE_TICKS +
          CHAT_BUBBLE_FADE_OUT_TICKS
    )
    .sort((a, b) => b.tick - a.tick);
  setChatBubbles(liveBubbles.map(({ age: _age, ...bubble }) => bubble));

  let bubbleOffsetY = 30;
  for (const bubble of liveBubbles) {
    const fadeOutStart = CHAT_BUBBLE_FADE_IN_TICKS + CHAT_BUBBLE_VISIBLE_TICKS;
    const alpha = bubble.age < CHAT_BUBBLE_FADE_IN_TICKS
      ? bubble.age / CHAT_BUBBLE_FADE_IN_TICKS
      : bubble.age > fadeOutStart
      ? 1 - (bubble.age - fadeOutStart) / CHAT_BUBBLE_FADE_OUT_TICKS
      : 1;
    const msgW = Math.min(vgaW(bubble.message), canvas.width - 32);
    const bubbleW = msgW + vgaPad * 2;
    const bubbleH = vgaLineH + vgaPad * 2;
    const bubbleX = Math.max(
      8,
      Math.min(playerScreenX - bubbleW * 0.5, canvas.width - bubbleW - 8),
    );
    const bubbleY = Math.max(8, playerScreenY - bubbleOffsetY - bubbleH);
    if (whiteTexture) {
      setRenderMode(5);
      setTint(0.1, 0.1, 0.1);
      setAlpha(0.55 * alpha);
      scratch[0] = bubbleX;
      scratch[1] = bubbleY;
      scratch[2] = bubbleW;
      scratch[3] = bubbleH;
      scratch[4] = 1;
      scratch[5] = 0;
      scratch[6] = 1;
      scratch[7] = 1;
      flushPass(1);
    }
    drawVga(
      bubble.message,
      bubbleX + vgaPad,
      bubbleY + vgaPad,
      [1, 1, 1],
      alpha,
      chatScale,
    );
    bubbleOffsetY += bubbleH + 8;
  }
}
