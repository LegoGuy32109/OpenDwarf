/// <reference lib="dom" />

import { ABI } from "../lib/engine/abi.generated.ts";
import { assertNoGlError } from "../webgl2/gl-errors.ts";
import { bootWebGl2Renderer } from "../webgl2/gpu-init.ts";
import { syncCanvasSize } from "../webgl2/canvas.ts";
import { compilePrograms } from "../webgl2/programs/index.ts";
import { TEXTURE_UNITS, uploadWhiteTo } from "../webgl2/texture-units.ts";
import { loadUiFontAtlas } from "../webgl2/ui-text.ts";
import initEngine, { UiEngine } from "../engine/generated/od_wasm.js";
import { InputCapture } from "./input.ts";

type EngineWasmExports = {
  memory: WebAssembly.Memory;
};

type EngineHandle = {
  rect_ptr(): number;
  rect_capacity(): number;
  glyph_ptr(): number;
  glyph_capacity(): number;
  drawlist_ptr(): number;
  drawlist_capacity(): number;
  input_ptr(): number;
  input_capacity(): number;
  frame(): number;
  abi_drawcmd_stride(): number;
  abi_rect_stride(): number;
  abi_rect_stride_floats(): number;
  abi_glyph_stride(): number;
  abi_glyph_stride_floats(): number;
  abi_program_rect(): number;
  abi_program_text(): number;
};

type EngineRuntime = {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  resources: ReturnType<typeof compilePrograms>;
  wasm: EngineWasmExports;
  engine: EngineHandle;
  // Snapshot of memory.buffer taken when the views below were derived. wasm
  // memory growth detaches the old ArrayBuffer and swaps in a new one, so this
  // is how we detect that the views are stale (see the grow-guard in frame()).
  bufferRef: ArrayBuffer;
  rects: Float32Array;
  glyphs: Float32Array;
  drawlist: DataView;
  input: DataView;
  inputCapture: InputCapture;
};

type DrawCmdView = {
  program: number;
  instanceOffset: number;
  instanceCount: number;
  scissorX: number;
  scissorY: number;
  scissorW: number;
  scissorH: number;
};

function setErrorOverlay(
  overlay: HTMLElement | null,
  message: string | null,
) {
  if (!overlay) {
    return;
  }
  if (message) {
    overlay.textContent = message;
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  } else {
    overlay.textContent = "";
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }
}

function readDrawCmd(drawlist: DataView, index: number): DrawCmdView {
  const base = index * ABI.DRAWCMD_SIZE_BYTES;
  return {
    program: drawlist.getUint32(base + ABI.DRAWCMD_PROGRAM_OFFSET, true),
    instanceOffset: drawlist.getUint32(
      base + ABI.DRAWCMD_INSTANCE_OFFSET_OFFSET,
      true,
    ),
    instanceCount: drawlist.getUint32(
      base + ABI.DRAWCMD_INSTANCE_COUNT_OFFSET,
      true,
    ),
    scissorX: drawlist.getInt32(base + ABI.DRAWCMD_SCISSOR_X_OFFSET, true),
    scissorY: drawlist.getInt32(base + ABI.DRAWCMD_SCISSOR_Y_OFFSET, true),
    scissorW: drawlist.getInt32(base + ABI.DRAWCMD_SCISSOR_W_OFFSET, true),
    scissorH: drawlist.getInt32(base + ABI.DRAWCMD_SCISSOR_H_OFFSET, true),
  };
}

function rederiveViews(runtime: EngineRuntime) {
  const { memory } = runtime.wasm;
  const engine = runtime.engine;
  runtime.bufferRef = memory.buffer;
  runtime.rects = new Float32Array(
    memory.buffer,
    engine.rect_ptr(),
    engine.rect_capacity() * ABI.RECT_INSTANCE_STRIDE_FLOATS,
  );
  runtime.glyphs = new Float32Array(
    memory.buffer,
    engine.glyph_ptr(),
    engine.glyph_capacity() * ABI.GLYPH_INSTANCE_STRIDE_FLOATS,
  );
  runtime.drawlist = new DataView(
    memory.buffer,
    engine.drawlist_ptr(),
    engine.drawlist_capacity() * ABI.DRAWCMD_SIZE_BYTES,
  );
  runtime.input = new DataView(
    memory.buffer,
    engine.input_ptr(),
    engine.input_capacity(),
  );
  runtime.inputCapture.setArena(runtime.input);
}

function createRuntime(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  resources: ReturnType<typeof compilePrograms>,
  wasm: EngineWasmExports,
  engine: EngineHandle,
): EngineRuntime {
  const runtime: EngineRuntime = {
    gl,
    canvas,
    resources,
    wasm,
    engine,
    bufferRef: wasm.memory.buffer,
    rects: new Float32Array(),
    glyphs: new Float32Array(),
    drawlist: new DataView(new ArrayBuffer(0)),
    input: new DataView(new ArrayBuffer(0)),
    inputCapture: new InputCapture(canvas),
  };
  rederiveViews(runtime);
  return runtime;
}

function uploadAndDraw(runtime: EngineRuntime, cmd: DrawCmdView, now: number) {
  const { gl, resources } = runtime;
  const program = cmd.program === ABI.DRAWCMD_PROGRAM_RECT
    ? resources.programs.uiRect
    : cmd.program === ABI.DRAWCMD_PROGRAM_TEXT
    ? resources.programs.uiText
    : null;
  if (!program) {
    throw new Error(`unknown draw program ${cmd.program}`);
  }

  const source = cmd.program === ABI.DRAWCMD_PROGRAM_RECT
    ? runtime.rects
    : runtime.glyphs;
  const strideFloats = cmd.program === ABI.DRAWCMD_PROGRAM_RECT
    ? ABI.RECT_INSTANCE_STRIDE_FLOATS
    : ABI.GLYPH_INSTANCE_STRIDE_FLOATS;
  const start = cmd.instanceOffset * strideFloats;
  const end = start + cmd.instanceCount * strideFloats;

  gl.bindVertexArray(program.vao);
  gl.useProgram(program.handle);
  program.setGlobals(
    { x: 0, y: 0, zoom: 1 },
    1,
    { width: runtime.canvas.width, height: runtime.canvas.height },
    now,
  );

  if (cmd.scissorW < 0 || cmd.scissorH < 0) {
    gl.disable(gl.SCISSOR_TEST);
  } else {
    gl.enable(gl.SCISSOR_TEST);
    const y = runtime.canvas.height - (cmd.scissorY + cmd.scissorH);
    gl.scissor(cmd.scissorX, y, cmd.scissorW, cmd.scissorH);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, resources.instanceBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, source.subarray(start, end));
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cmd.instanceCount);
}

export async function startEngineRenderLoop(
  canvas: HTMLCanvasElement,
): Promise<() => void> {
  const boot = bootWebGl2Renderer(canvas);
  if (!boot) {
    throw new Error("WebGL2 is required to play the engine demo");
  }

  const { gl } = boot;
  const resources = compilePrograms(gl);
  uploadWhiteTo(gl, TEXTURE_UNITS.white, resources.whiteTexture);
  await loadUiFontAtlas(gl, resources.fontTexture);
  assertNoGlError(gl, "engine init");

  const wasm = await initEngine();
  const engine = new UiEngine();
  const runtime = createRuntime(gl, canvas, resources, wasm, engine);

  let stopped = false;
  let rafId = 0;

  const frame = (now: number) => {
    if (stopped) {
      return;
    }

    syncCanvasSize(gl, canvas);
    runtime.inputCapture.beginFrame(now);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.11, 0.11, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const drawCount = runtime.engine.frame();
    // Grow-guard: if frame() grew wasm memory, the old ArrayBuffer is detached
    // and our views point at freed memory — re-derive against the new buffer.
    if (runtime.wasm.memory.buffer !== runtime.bufferRef) {
      rederiveViews(runtime);
    }

    for (let i = 0; i < drawCount; i++) {
      const cmd = readDrawCmd(runtime.drawlist, i);
      uploadAndDraw(runtime, cmd, now);
    }

    rafId = globalThis.requestAnimationFrame(frame);
  };

  rafId = globalThis.requestAnimationFrame(frame);

  return () => {
    stopped = true;
    globalThis.cancelAnimationFrame(rafId);
    runtime.inputCapture.dispose();
  };
}

export async function startEngineClient(
  canvas: HTMLCanvasElement,
  errorOverlay?: HTMLElement | null,
) {
  try {
    const stopRender = await startEngineRenderLoop(canvas);
    setErrorOverlay(errorOverlay ?? null, null);
    return () => {
      stopRender();
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setErrorOverlay(errorOverlay ?? null, message);
    console.error(error);
    return () => {};
  }
}
