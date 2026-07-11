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
import { runScenarioBrowser } from "./scenario-runner.ts";
import type { RunScenarioResult, ScenarioDocument } from "./scenario-types.ts";

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
  hydrate_settings(bytes: Uint8Array): void;
  frame(): number;
  abi_drawcmd_stride(): number;
  abi_rect_stride(): number;
  abi_rect_stride_floats(): number;
  abi_glyph_stride(): number;
  abi_glyph_stride_floats(): number;
  abi_program_rect(): number;
  abi_program_text(): number;
  debug_snapshot_json(): string;
  debug_draw_hash(): string;
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
  harnessEnabled: boolean;
  syntheticNow: number;
};

const SETTINGS_STORAGE_KEY = "od.settings";

type EngineGlobals = typeof globalThis & {
  host_leave_game?: () => void;
  host_persist_settings?: (ptr: number, len: number) => void;
  host_set_text_capture?: (
    active: number,
    x: number,
    y: number,
    w: number,
    h: number,
    maxLen: number,
  ) => void;
};

let leaveGameHandler: () => void = () => {};
let persistSettingsHandler: (ptr: number, len: number) => void = () => {};
let setTextCaptureHandler: (
  active: number,
  x: number,
  y: number,
  w: number,
  h: number,
  maxLen: number,
) => void = () => {};

const engineGlobals = globalThis as EngineGlobals;
engineGlobals.host_leave_game = () => leaveGameHandler();
engineGlobals.host_persist_settings = (ptr: number, len: number) =>
  persistSettingsHandler(ptr, len);
engineGlobals.host_set_text_capture = (
  active: number,
  x: number,
  y: number,
  w: number,
  h: number,
  maxLen: number,
) => setTextCaptureHandler(active, x, y, w, h, maxLen);

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function loadPersistedSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    return raw ? base64ToBytes(raw) : new Uint8Array();
  } catch {
    return new Uint8Array();
  }
}

function savePersistedSettings(bytes: Uint8Array) {
  try {
    globalThis.localStorage?.setItem(
      SETTINGS_STORAGE_KEY,
      bytesToBase64(bytes),
    );
  } catch {
    // localStorage is best-effort only.
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
    harnessEnabled: false,
    syntheticNow: 0,
  };
  rederiveViews(runtime);
  return runtime;
}

function renderFrame(runtime: EngineRuntime, now: number) {
  const { gl, canvas } = runtime;
  syncCanvasSize(gl, canvas);
  runtime.inputCapture.beginFrame(now);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.11, 0.11, 0.13, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const drawCount = runtime.engine.frame();
  if (runtime.wasm.memory.buffer !== runtime.bufferRef) {
    rederiveViews(runtime);
  }

  for (let i = 0; i < drawCount; i++) {
    const cmd = readDrawCmd(runtime.drawlist, i);
    uploadAndDraw(runtime, cmd, now);
  }
}

function readSnapshot(runtime: EngineRuntime) {
  return JSON.parse(runtime.engine.debug_snapshot_json()) as Record<
    string,
    unknown
  >;
}

type EngineCheckpoint = {
  name: string;
  ordinal: number;
  frame: number;
  drawHash: string;
  snapshot: Record<string, unknown>;
  screenshot?: string;
};

type EngineBundle = {
  manifest: {
    version: number;
    checkpointCount: number;
    screenshotCount: number;
  };
  checkpoints: EngineCheckpoint[];
  screenshots: { name: string; dataUrl: string }[];
};

type EngineHarness = {
  version: 3;
  input: {
    keyDown(code: string, modifiers?: number): Promise<void>;
    keyUp(code: string, modifiers?: number): Promise<void>;
    press(code: string, modifiers?: number): Promise<void>;
    typeText(text: string): Promise<void>;
    paste(text: string): Promise<void>;
    blur(): Promise<void>;
    focus(): Promise<void>;
  };
  stepFrame(n?: number): Promise<void>;
  /** Reserved — requires wasm world surface. Throws until implemented. */
  stepSimTick(n?: number): Promise<void>;
  snapshot(): Record<string, unknown>;
  captureCheckpoint(
    name: string,
    options?: { screenshot?: boolean },
  ): Promise<EngineCheckpoint>;
  exportBundle(): EngineBundle;
  /** Author path — intent/semantic Scenario document. */
  runScenario(scenario: ScenarioDocument): Promise<RunScenarioResult>;
  /**
   * Proof path — WorldReplay. Explicitly unimplemented until wasm world
   * surface exists (throws; never silent no-op).
   */
  importReplay(worldReplay: unknown): Promise<never>;
};

type EngineGlobalHarness = typeof globalThis & {
  __openDwarfEngineHarness?: EngineHarness;
};

function captureGlScreenshot(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
): string {
  const width = canvas.width;
  const height = canvas.height;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const flipped = new Uint8ClampedArray(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * rowBytes;
    const dst = y * rowBytes;
    flipped.set(pixels.subarray(src, src + rowBytes), dst);
  }
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d canvas unavailable for screenshot encode");
  }
  ctx.putImageData(new ImageData(flipped, width, height), 0, 0);
  return exportCanvas.toDataURL("image/png");
}

function installHarness(
  runtime: EngineRuntime,
  canvas: HTMLCanvasElement,
): EngineHarness {
  const checkpoints: EngineCheckpoint[] = [];

  const keyForCode = (code: string) => {
    if (code.startsWith("Key")) {
      return code.slice(3).toLowerCase();
    }
    if (code.startsWith("Digit")) {
      return code.slice(5);
    }
    switch (code) {
      case "Space":
        return " ";
      case "Slash":
        return "/";
      case "Enter":
        return "Enter";
      case "Escape":
        return "Escape";
      case "Backspace":
        return "Backspace";
      case "Delete":
        return "Delete";
      case "ArrowLeft":
        return "ArrowLeft";
      case "ArrowRight":
        return "ArrowRight";
      case "Home":
        return "Home";
      case "End":
        return "End";
      default:
        return code;
    }
  };

  const dispatchKey = (type: "keydown" | "keyup", code: string, modifiers: number) => {
    const key = keyForCode(code);
    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key,
      code,
      ctrlKey: (modifiers & ABI.INPUT_MODIFIER_CTRL) !== 0,
      altKey: (modifiers & ABI.INPUT_MODIFIER_ALT) !== 0,
      shiftKey: (modifiers & ABI.INPUT_MODIFIER_SHIFT) !== 0,
      metaKey: (modifiers & ABI.INPUT_MODIFIER_META) !== 0,
    });
    try {
      Object.defineProperty(event, "code", { get: () => code });
      Object.defineProperty(event, "key", { get: () => key });
    } catch {
      // Best-effort; browser support varies for synthetic KeyboardEvent fields.
    }
    runtime.inputCapture.setArena(runtime.input);
    window.dispatchEvent(event);
  };

  const buildSnapshot = () => {
    const snapshot = readSnapshot(runtime);
    const snapshotInput = (snapshot.input as Record<string, unknown>) ?? {};
    const snapshotRender = (snapshot.render as Record<string, unknown>) ?? {};
    const frame = (snapshot.frame as Record<string, unknown>) ?? {};
    if (typeof frame.drawHash !== "string") {
      frame.drawHash = runtime.engine.debug_draw_hash();
    }
    return {
      version: 3,
      ...snapshot,
      frame,
      input: {
        ...snapshotInput,
        canvasFocused: document.activeElement === canvas,
        textCaptureActive: runtime.inputCapture.isCaptureActive(),
        hiddenInputFocused: runtime.inputCapture.isHiddenInputFocused(),
      },
      render: {
        ...snapshotRender,
        framebufferWidth: canvas.width,
        framebufferHeight: canvas.height,
      },
    };
  };

  const input = {
    keyDown: async (code: string, modifiers = 0) => {
      dispatchKey("keydown", code, modifiers);
    },
    keyUp: async (code: string, modifiers = 0) => {
      dispatchKey("keyup", code, modifiers);
    },
    press: async (code: string, modifiers = 0) => {
      await input.keyDown(code, modifiers);
      await input.keyUp(code, modifiers);
    },
    typeText: async (text: string) => {
      const inputEl = document.querySelector<HTMLInputElement>("#od-text-capture");
      if (!inputEl) {
        throw new Error("hidden text input is unavailable");
      }
      for (const ch of text) {
        const ev = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: ch,
          inputType: "insertText",
        });
        inputEl.dispatchEvent(ev);
      }
    },
    paste: async (text: string) => {
      const inputEl = document.querySelector<HTMLInputElement>("#od-text-capture");
      if (!inputEl) {
        throw new Error("hidden text input is unavailable");
      }
      const ev = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertFromPaste",
      });
      inputEl.dispatchEvent(ev);
    },
    blur: async () => {
      const inputEl = document.querySelector<HTMLInputElement>("#od-text-capture");
      inputEl?.blur();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    focus: async () => {
      if (runtime.inputCapture.isCaptureActive()) {
        const inputEl = document.querySelector<HTMLInputElement>("#od-text-capture");
        inputEl?.focus();
      } else {
        canvas.focus();
      }
    },
  };

  return {
    version: 3,
    input,
    stepFrame: async (n = 1) => {
      for (let index = 0; index < n; index++) {
        runtime.syntheticNow += 16;
        renderFrame(runtime, runtime.syntheticNow);
      }
    },
    stepSimTick: async (_n = 1) => {
      throw new Error(
        "stepSimTick: unimplemented — requires wasm world surface (Stage B stub)",
      );
    },
    snapshot: () => buildSnapshot(),
    captureCheckpoint: async (name, options = {}) => {
      runtime.syntheticNow += 16;
      renderFrame(runtime, runtime.syntheticNow);
      const snapshot = buildSnapshot();
      const frame = snapshot.frame as Record<string, unknown>;
      const drawHash = String(frame.drawHash ?? runtime.engine.debug_draw_hash());
      const checkpoint: EngineCheckpoint = {
        name,
        ordinal: checkpoints.length,
        frame: Number(frame.number ?? 0),
        drawHash,
        snapshot,
      };
      if (options.screenshot) {
        checkpoint.screenshot = captureGlScreenshot(runtime.gl, canvas);
      }
      checkpoints.push(checkpoint);
      return checkpoint;
    },
    exportBundle: () => {
      const screenshots = checkpoints
        .filter((checkpoint) => typeof checkpoint.screenshot === "string")
        .map((checkpoint) => ({
          name: checkpoint.name,
          dataUrl: checkpoint.screenshot!,
        }));
      return {
        manifest: {
          version: 3,
          checkpointCount: checkpoints.length,
          screenshotCount: screenshots.length,
        },
        checkpoints: checkpoints.map(({ screenshot: _screenshot, ...rest }) => rest),
        screenshots,
      };
    },
    runScenario: async (scenario: ScenarioDocument) => {
      return await runScenarioBrowser(
        {
          input,
          stepFrame: async (n = 1) => {
            for (let index = 0; index < n; index++) {
              runtime.syntheticNow += 16;
              renderFrame(runtime, runtime.syntheticNow);
            }
          },
          snapshot: () => buildSnapshot(),
          captureCheckpoint: async (name) => {
            runtime.syntheticNow += 16;
            renderFrame(runtime, runtime.syntheticNow);
            const snapshot = buildSnapshot();
            const frame = snapshot.frame as Record<string, unknown>;
            const drawHash = String(
              frame.drawHash ?? runtime.engine.debug_draw_hash(),
            );
            const checkpoint: EngineCheckpoint = {
              name,
              ordinal: checkpoints.length,
              frame: Number(frame.number ?? 0),
              drawHash,
              snapshot,
            };
            checkpoints.push(checkpoint);
            return checkpoint;
          },
        },
        scenario,
      );
    },
    importReplay: async (_worldReplay: unknown): Promise<never> => {
      throw new Error(
        "importReplay: unimplemented — requires wasm world surface (Stage B stub; not a silent no-op)",
      );
    },
  };
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
  options: { harness?: boolean } = {},
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
  // Harness mode pins Settings::default(); ignore localStorage so goldens
  // cannot flake on a previous session's ui_scale.
  if (!options.harness) {
    engine.hydrate_settings(loadPersistedSettings());
  }
  const runtime = createRuntime(gl, canvas, resources, wasm, engine);
  runtime.harnessEnabled = Boolean(options.harness);
  if (runtime.harnessEnabled) {
    runtime.inputCapture.setHarnessPinned(true);
  }

  let stopped = false;
  let rafId = 0;

  leaveGameHandler = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    globalThis.cancelAnimationFrame(rafId);
    runtime.inputCapture.dispose();
  };
  persistSettingsHandler = (_ptr: number, _len: number) => {
    const bytes = new Uint8Array(runtime.wasm.memory.buffer, _ptr, _len);
    savePersistedSettings(bytes);
  };
  setTextCaptureHandler = (active, x, y, w, h, maxLen) => {
    runtime.inputCapture.setTextCapture(
      active !== 0,
      x,
      y,
      w,
      h,
      maxLen,
    );
  };

  const frame = (now: number) => {
    if (stopped) {
      return;
    }
    renderFrame(runtime, now);
    if (!runtime.harnessEnabled) {
      rafId = globalThis.requestAnimationFrame(frame);
    }
  };

  if (!runtime.harnessEnabled) {
    rafId = globalThis.requestAnimationFrame(frame);
  }

  if (runtime.harnessEnabled) {
    const harness = installHarness(runtime, canvas);
    (globalThis as EngineGlobalHarness).__openDwarfEngineHarness = harness;
  } else {
    delete (globalThis as EngineGlobalHarness).__openDwarfEngineHarness;
  }

  return () => {
    stopped = true;
    globalThis.cancelAnimationFrame(rafId);
    runtime.inputCapture.dispose();
    leaveGameHandler = () => {};
    persistSettingsHandler = () => {};
    setTextCaptureHandler = () => {};
    delete (globalThis as EngineGlobalHarness).__openDwarfEngineHarness;
  };
}

export async function startEngineClient(
  canvas: HTMLCanvasElement,
  errorOverlay?: HTMLElement | null,
  options: { harness?: boolean } = {},
) {
  try {
    const stopRender = await startEngineRenderLoop(canvas, options);
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
