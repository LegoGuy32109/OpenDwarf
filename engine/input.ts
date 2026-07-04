/// <reference lib="dom" />

import { ABI } from "../lib/engine/abi.generated.ts";

type InputBuffer = DataView<ArrayBufferLike>;

const CODE_TO_KEYCODE: Record<string, number> = Object.freeze({
  Enter: ABI.KEYCODE_ENTER,
  Escape: ABI.KEYCODE_ESCAPE,
  Space: ABI.KEYCODE_SPACE,
  KeyI: ABI.KEYCODE_KEYI,
  KeyJ: ABI.KEYCODE_KEYJ,
  KeyK: ABI.KEYCODE_KEYK,
  KeyL: ABI.KEYCODE_KEYL,
  KeyQ: ABI.KEYCODE_KEYQ,
  KeyE: ABI.KEYCODE_KEYE,
  KeyS: ABI.KEYCODE_KEYS,
  KeyD: ABI.KEYCODE_KEYD,
  KeyF: ABI.KEYCODE_KEYF,
});

function modifiersFrom(event: KeyboardEvent): number {
  return (event.shiftKey ? ABI.INPUT_MODIFIER_SHIFT : 0) |
    (event.ctrlKey ? ABI.INPUT_MODIFIER_CTRL : 0) |
    (event.altKey ? ABI.INPUT_MODIFIER_ALT : 0) |
    (event.metaKey ? ABI.INPUT_MODIFIER_META : 0);
}

function writeSampled(
  input: InputBuffer,
  canvas: HTMLCanvasElement,
  focused: boolean,
) {
  if (input.byteLength === 0) {
    return;
  }
  const dpr = globalThis.devicePixelRatio || 1;
  input.setUint32(ABI.INPUT_SAMPLE_FRAMEBUFFER_W_OFFSET, canvas.width, true);
  input.setUint32(ABI.INPUT_SAMPLE_FRAMEBUFFER_H_OFFSET, canvas.height, true);
  input.setFloat32(ABI.INPUT_SAMPLE_DPR_OFFSET, dpr, true);
  input.setFloat32(ABI.INPUT_SAMPLE_POINTER_X_OFFSET, 0, true);
  input.setFloat32(ABI.INPUT_SAMPLE_POINTER_Y_OFFSET, 0, true);
  input.setUint32(ABI.INPUT_SAMPLE_BUTTONS_OFFSET, 0, true);
  input.setUint32(
    ABI.INPUT_SAMPLE_WINDOW_FOCUSED_OFFSET,
    focused ? 1 : 0,
    true,
  );
}

function appendEvent(
  input: InputBuffer,
  kind: number,
  code: number,
  modifiers: number,
  value = 0,
) {
  if (input.byteLength === 0) {
    return;
  }
  const count = input.getUint32(ABI.INPUT_QUEUE_HEADER_COUNT_OFFSET, true);
  if (count >= ABI.INPUT_QUEUE_CAPACITY) {
    input.setUint32(ABI.INPUT_QUEUE_HEADER_OVERFLOW_OFFSET, 1, true);
    return;
  }
  const base = ABI.INPUT_ARENA_EVENTS_OFFSET +
    count * ABI.INPUT_EVENT_SIZE_BYTES;
  input.setUint8(base + ABI.INPUT_EVENT_KIND_OFFSET, kind);
  input.setUint8(base + ABI.INPUT_EVENT_MODIFIERS_OFFSET, modifiers);
  input.setUint16(base + ABI.INPUT_EVENT_CODE_OFFSET, code, true);
  input.setUint32(base + ABI.INPUT_EVENT_VALUE_OFFSET, value >>> 0, true);
  input.setUint32(ABI.INPUT_QUEUE_HEADER_COUNT_OFFSET, count + 1, true);
}

export class InputCapture {
  private input: InputBuffer = new DataView(new ArrayBuffer(0));
  private lastFrameNow = 0;
  private readonly onKeyDown = (event: KeyboardEvent) => {
    const code = CODE_TO_KEYCODE[event.code];
    if (!code) {
      return;
    }
    event.preventDefault();
    appendEvent(
      this.input,
      ABI.INPUT_KIND_KEY_DOWN,
      code,
      modifiersFrom(event),
    );
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    const code = CODE_TO_KEYCODE[event.code];
    if (!code) {
      return;
    }
    event.preventDefault();
    appendEvent(this.input, ABI.INPUT_KIND_KEY_UP, code, modifiersFrom(event));
  };

  private readonly onBlur = () => {
    writeSampled(this.input, this.canvas, false);
    appendEvent(this.input, ABI.INPUT_KIND_BLUR, 0, 0);
  };

  private readonly onFocus = () => {
    writeSampled(this.input, this.canvas, true);
  };

  private readonly onResize = () => {
    writeSampled(this.input, this.canvas, document.hasFocus());
  };

  private readonly onPointerDown = () => {
    this.canvas.focus();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    globalThis.addEventListener("keydown", this.onKeyDown, { passive: false });
    globalThis.addEventListener("keyup", this.onKeyUp, { passive: false });
    globalThis.addEventListener("blur", this.onBlur);
    globalThis.addEventListener("focus", this.onFocus);
    globalThis.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onResize);
    canvas.addEventListener("pointerdown", this.onPointerDown);
  }

  setArena(input: DataView) {
    this.input = input;
    writeSampled(this.input, this.canvas, document.hasFocus());
  }

  beginFrame(now: number) {
    if (this.input.byteLength === 0) {
      return;
    }
    const dt = this.lastFrameNow === 0
      ? 16.0
      : Math.max(0, now - this.lastFrameNow);
    this.lastFrameNow = now;
    writeSampled(this.input, this.canvas, document.hasFocus());
    this.input.setFloat32(ABI.INPUT_SAMPLE_DT_MS_OFFSET, dt, true);
  }

  clearQueue() {
    if (this.input.byteLength === 0) {
      return;
    }
    this.input.setUint32(ABI.INPUT_QUEUE_HEADER_COUNT_OFFSET, 0, true);
    this.input.setUint32(ABI.INPUT_QUEUE_HEADER_OVERFLOW_OFFSET, 0, true);
  }

  dispose() {
    globalThis.removeEventListener("keydown", this.onKeyDown);
    globalThis.removeEventListener("keyup", this.onKeyUp);
    globalThis.removeEventListener("blur", this.onBlur);
    globalThis.removeEventListener("focus", this.onFocus);
    globalThis.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onResize);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }
}
